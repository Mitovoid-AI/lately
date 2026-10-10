"""FETCH provider chain — all offline (saved HTML, MockTransport, fake yt-dlp)."""

from pathlib import Path

import httpx
import pytest

from app.enrich import fetch
from app.enrich.budget import BudgetExhausted
from app.enrich.fetch import (
    EmbedPageProvider,
    FetchResult,
    ScraperApiProvider,
    ThumbnailStore,
    YtDlpProvider,
    info_to_result,
    parse_embed_page,
    run_chain,
)

FIXTURE = Path(__file__).parent / "fixtures" / "embed_captioned.html"
URL = "https://www.instagram.com/reel/C8xYz12/"


def client_for(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ------------------------------------------------------------- embed page --

def test_parse_embed_page_extracts_caption_handle_thumbnail_video():
    r = parse_embed_page(FIXTURE.read_text(encoding="utf-8"))
    assert r is not None and r.source == "embed_page"
    assert r.creator_handle == "delhi.foodtrails"
    assert r.caption.startswith("Best momos in Majnu ka Tilla 🥟 laphing + jhol momos for ₹120")
    assert "Open 11am–10pm, closed Tuesdays" in r.caption
    assert "#delhifood #momos #majnukatilla" in r.caption
    assert "View all" not in r.caption and "delhi.foodtrails" not in r.caption
    assert r.thumbnail_url.startswith("https://scontent-del1-1.cdninstagram.com/v/t51.29350-15/")
    assert "&_nc_ht=" in r.thumbnail_url  # entities decoded
    assert r.video_url.startswith("https://scontent-del1-1.cdninstagram.com/o1/v/t16/")
    assert r.video_url.endswith(".mp4?efg=eyJ2ZW5jb2RlX3RhZyI6InZ0c192b2RfdXJsZ2VuIn0"
                                "&_nc_ht=scontent-del1-1.cdninstagram.com&oh=00_AYDvid")
    assert r.duration_s == pytest.approx(47.3)


def test_parse_embed_page_login_wall_is_none():
    html = "<html><body><div class='EmbedIsBroken'>This post is unavailable</div></body></html>"
    assert parse_embed_page(html) is None


async def test_embed_provider_requests_captioned_embed_url():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    r = await EmbedPageProvider(client_for(handler)).fetch("C8xYz12", URL)
    # /p/ + a desktop iframe request gets the classic server-rendered embed; the
    # /reel/ path with a mobile UA answered with an empty SPA error shell (live, 2026-10).
    assert seen == ["https://www.instagram.com/p/C8xYz12/embed/captioned/"]
    assert r.creator_handle == "delhi.foodtrails"


async def test_embed_provider_http_error_is_none():
    r = await EmbedPageProvider(client_for(lambda req: httpx.Response(429))).fetch("X", URL)
    assert r is None


# ----------------------------------------------------------------- yt-dlp --

YT_INFO = {
    "description": "3 VS Code shortcuts you need #vscode",
    "uploader_id": "dev.tips", "uploader": "Dev Tips", "channel": "dev.tips",
    "thumbnail": "https://cdn.example/thumb.jpg", "duration": 31.5,
    "formats": [
        {"format_id": "v1", "url": "https://cdn.example/v.mp4", "vcodec": "avc1", "acodec": "none"},
        {"format_id": "a1", "url": "https://cdn.example/a.m4a", "vcodec": "none",
         "acodec": "mp4a", "filesize": 400_000},
        {"format_id": "va", "url": "https://cdn.example/va.mp4", "vcodec": "avc1",
         "acodec": "mp4a", "filesize": 3_000_000},
    ],
}


def test_info_to_result_prefers_audio_only_format():
    r = info_to_result(YT_INFO)
    assert r.source == "ytdlp" and r.caption.startswith("3 VS Code")
    assert r.creator_handle == "dev.tips" and r.duration_s == 31.5
    assert r.audio_url == "https://cdn.example/a.m4a"
    assert r.video_url == "https://cdn.example/va.mp4"
    assert r.thumbnail_url == "https://cdn.example/thumb.jpg"


async def test_ytdlp_provider_uses_injected_extractor_without_download():
    calls = []

    def extractor(url):
        calls.append(url)
        return YT_INFO

    r = await YtDlpProvider(extractor=extractor).fetch("C8xYz12", URL)
    assert calls == [URL] and r.audio_url.endswith("a.m4a")


async def test_ytdlp_provider_error_is_none():
    def extractor(url):
        raise RuntimeError("login required")

    assert await YtDlpProvider(extractor=extractor).fetch("C8xYz12", URL) is None


# ---------------------------------------------------------------- scraper --

async def test_scraper_provider_maps_json_and_sends_key():
    def handler(request):
        assert request.headers["authorization"] == "Bearer sk-scrape"
        assert request.url.params["url"] == URL
        return httpx.Response(200, json={
            "caption": "Gym split", "owner": {"username": "fit.guy"},
            "display_url": "https://cdn.example/t.jpg", "video_url": "https://cdn.example/v.mp4",
            "video_duration": 20})

    p = ScraperApiProvider(client_for(handler), "https://scraper.example/v1/reel", "sk-scrape")
    r = await p.fetch("C8xYz12", URL)
    assert (r.source, r.caption, r.creator_handle) == ("scraper", "Gym split", "fit.guy")
    assert r.thumbnail_url == "https://cdn.example/t.jpg" and r.duration_s == 20


# ------------------------------------------------------------------ chain --

class Stub:
    def __init__(self, name, result=None, exc=None, budget=None):
        self.name, self.result, self.exc, self.budget, self.calls = name, result, exc, budget, 0

    async def fetch(self, shortcode, url):
        self.calls += 1
        if self.exc:
            raise self.exc
        return self.result


async def test_chain_first_success_wins():
    a = Stub("a", exc=RuntimeError("blocked"))
    b = Stub("b", result=FetchResult(source="b", caption="hi"))
    c = Stub("c", result=FetchResult(source="c", caption="no"))
    r = await run_chain([a, b, c], "SC", URL)
    assert r.source == "b" and (a.calls, b.calls, c.calls) == (1, 1, 0)


async def test_chain_skips_empty_results_and_gives_up():
    r = await run_chain([Stub("a", result=FetchResult(source="a")), Stub("b")], "SC", URL)
    assert r.source is None and r.caption is None


async def test_chain_raises_budget_exhausted():
    taken = []

    async def take(provider):
        taken.append(provider)
        return 30

    with pytest.raises(BudgetExhausted) as e:
        await run_chain([Stub("a", budget="instagram")], "SC", URL, take=take)
    assert taken == ["instagram"] and e.value.retry_after_s == 30


def test_fetch_result_meta_round_trip():
    r = FetchResult(source="ytdlp", caption="c", audio_url="https://a", duration_s=3.0)
    assert FetchResult.from_meta(r.to_meta()) == r


# -------------------------------------------------------------- thumbnail --

async def test_thumbnail_uploaded_to_storage_with_service_key():
    uploads = []

    def handler(request):
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})
        uploads.append(request)
        return httpx.Response(200, json={"Key": "thumbnails/SC1.jpg"})

    store = ThumbnailStore(client_for(handler), "https://proj.supabase.co", "service-key")
    path = await store.store("SC1", "https://cdn.example/t.jpg")
    assert path == "SC1.jpg"
    (up,) = uploads
    assert str(up.url) == "https://proj.supabase.co/storage/v1/object/thumbnails/SC1.jpg"
    assert up.method == "POST" and up.headers["x-upsert"] == "true"
    assert up.headers["authorization"] == "Bearer service-key"
    assert up.content == b"\xff\xd8jpeg"


async def test_thumbnail_without_key_keeps_remote_url():
    store = ThumbnailStore(client_for(lambda r: httpx.Response(500)), "https://p.supabase.co", "")
    assert await store.store("SC1", "https://cdn.example/t.jpg") == "https://cdn.example/t.jpg"


async def test_thumbnail_too_large_keeps_remote_url():
    def handler(request):
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=b"x" * 5000)
        raise AssertionError("must not upload")

    store = ThumbnailStore(client_for(handler), "https://p.supabase.co", "k", max_bytes=1000)
    assert await store.store("SC1", "https://cdn.example/t.jpg") == "https://cdn.example/t.jpg"


async def test_thumbnail_upload_failure_keeps_remote_url():
    def handler(request):
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=b"jpg")
        return httpx.Response(403, json={"error": "Unauthorized"})

    store = ThumbnailStore(client_for(handler), "https://p.supabase.co", "k")
    assert await store.store("SC1", "https://cdn.example/t.jpg") == "https://cdn.example/t.jpg"


async def test_download_limited_rejects_by_content_length():
    def handler(request):
        return httpx.Response(200, content=b"x" * 10, headers={"content-length": "999999"})

    assert await fetch.download_limited(client_for(handler), "https://x/y", 100) is None
