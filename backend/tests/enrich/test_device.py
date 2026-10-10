"""Device-side fetch hints: validation, the DeviceHintProvider, and the server-side
thumbnail check (PIPELINE.md §5 FETCH provider 0, §8 trust rule). All offline."""

import httpx
import pytest

from app.enrich.device import (
    DeviceHintProvider,
    is_instagram_cdn_url,
    looks_like_image,
    sanitize_hint,
)
from app.enrich.fetch import ThumbnailStore, run_chain

URL = "https://www.instagram.com/reel/C8xYz12/"
THUMB = "https://scontent-del1-1.cdninstagram.com/v/t51.29350-15/448_n.jpg?oh=1&oe=2"
VIDEO = "https://video-del1-1.xx.fbcdn.net/o1/v/t16/AQO.mp4?efg=1"
JPEG = b"\xff\xd8\xff\xe0jpegdata"


def client_for(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.parametrize("url", [
    THUMB, VIDEO,
    "https://instagram.fdel1-1.fna.fbcdn.net/v/t51/x.jpg",
    "https://cdninstagram.com/x.jpg",
    "https://SCONTENT.CDNINSTAGRAM.COM/x.jpg",
    "https://scontent.cdninstagram.com:443/x.jpg",
])
def test_cdn_urls_accepted(url):
    assert is_instagram_cdn_url(url)


@pytest.mark.parametrize("url", [
    "http://scontent.cdninstagram.com/x.jpg",          # not https
    "https://evil.com/x.jpg",
    "https://cdninstagram.com.evil.com/x.jpg",           # suffix trick
    "https://evilcdninstagram.com/x.jpg",                # no dot boundary
    "https://fbcdn.net.attacker.io/x.jpg",
    "https://user:pw@scontent.cdninstagram.com/x.jpg",   # credentials
    "https://scontent.cdninstagram.com:8443/x.jpg",      # odd port
    "https://127.0.0.1/x.jpg",
    "javascript:alert(1)",
    "",
    None,
    42,
])
def test_non_cdn_urls_rejected(url):
    assert not is_instagram_cdn_url(url)


def test_sanitize_hint_keeps_valid_fields_and_drops_bad_ones():
    h = sanitize_hint({"caption": "  Best momos  ", "creator_handle": "delhi.foodtrails",
                       "thumbnail_url": THUMB, "video_url": "https://evil.com/v.mp4",
                       "duration_s": 47.3, "extra": "ignored"})
    assert h == {"caption": "Best momos", "creator_handle": "delhi.foodtrails",
                 "thumbnail_url": THUMB, "video_url": None, "duration_s": 47.3}


@pytest.mark.parametrize(("field", "value"), [
    ("creator_handle", "has space"), ("creator_handle", "x" * 31), ("creator_handle", ""),
    ("duration_s", -1), ("duration_s", 3601), ("duration_s", "47"), ("duration_s", True),
    ("caption", "x" * 5001), ("caption", 12),
])
def test_sanitize_hint_drops_invalid_values(field, value):
    assert sanitize_hint({field: value})[field] is None


def test_looks_like_image():
    assert looks_like_image(JPEG)
    assert looks_like_image(b"\x89PNG\r\n\x1a\nxx")
    assert looks_like_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ")
    assert not looks_like_image(b"<html>login</html>")
    assert not looks_like_image(b"")


async def test_provider_maps_hint_to_device_result():
    p = DeviceHintProvider({"caption": "Best momos", "creator_handle": "delhi.foodtrails",
                            "thumbnail_url": THUMB, "video_url": VIDEO, "duration_s": 47.0,
                            "shortcode": "C8xYz12"})
    assert p.budget is None
    r = await p.fetch("C8xYz12", URL)
    assert r.source == "device" and r.caption == "Best momos"
    assert (r.thumbnail_url, r.video_url, r.duration_s) == (THUMB, VIDEO, 47.0)
    assert r.media_url == VIDEO


async def test_provider_revalidates_stored_hint():
    """A hint row edited behind the API's back still can't smuggle a foreign host."""
    p = DeviceHintProvider({"caption": None, "thumbnail_url": "https://evil.com/t.jpg"})
    assert await p.fetch("C8xYz12", URL) is None


async def test_provider_ignores_hint_for_another_shortcode():
    p = DeviceHintProvider({"caption": "x", "shortcode": "OTHER1"})
    assert await p.fetch("C8xYz12", URL) is None


async def test_chain_falls_through_when_hint_is_empty():
    class Server:
        name, budget, calls = "embed_page", None, 0

        async def fetch(self, shortcode, url):
            from app.enrich.fetch import FetchResult
            return FetchResult(source="embed_page", caption="from server")

    r = await run_chain([DeviceHintProvider({}), Server()], "C8xYz12", URL)
    assert r.source == "embed_page"


# ------------------------------------------------- verified thumbnail copy --

async def test_verified_thumbnail_downloaded_and_uploaded():
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.host.endswith("cdninstagram.com"):
            return httpx.Response(200, content=JPEG)
        return httpx.Response(200, json={"Key": "thumbnails/SC1.jpg"})

    store = ThumbnailStore(client_for(handler), "https://proj.supabase.co", "service-key")
    assert await store.store_verified("SC1", THUMB) == "SC1.jpg"
    assert [r.url.host for r in seen] == ["scontent-del1-1.cdninstagram.com", "proj.supabase.co"]
    assert seen[1].content == JPEG


async def test_verified_thumbnail_without_key_still_downloads_to_confirm():
    seen = []

    def handler(request):
        seen.append(request.url.host)
        return httpx.Response(200, content=JPEG)

    store = ThumbnailStore(client_for(handler), "https://p.supabase.co", "")
    assert await store.store_verified("SC1", THUMB) == THUMB
    assert seen == ["scontent-del1-1.cdninstagram.com"]


@pytest.mark.parametrize("response", [
    httpx.Response(404),
    httpx.Response(200, content=b"<html>not an image</html>"),
    httpx.Response(302, headers={"location": "http://169.254.169.254/latest"}),
])
async def test_unconfirmed_device_thumbnail_is_dropped(response):
    def handler(request):
        if request.url.host.endswith("cdninstagram.com"):
            return response
        raise AssertionError(f"unexpected {request.url}")

    store = ThumbnailStore(client_for(handler), "https://p.supabase.co", "k")
    assert await store.store_verified("SC1", THUMB) is None


async def test_verified_thumbnail_refuses_non_cdn_url_without_a_request():
    store = ThumbnailStore(client_for(lambda r: pytest.fail("no request")), "https://p", "k")
    assert await store.store_verified("SC1", "https://evil.com/t.jpg") is None
    assert await store.store_verified("SC1", None) is None
