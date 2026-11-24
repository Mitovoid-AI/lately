"""Worker review fixes on the enrichment side, all offline: the provider chain
skips a provider with no budget (#15) and reports a reel that is gone (#17),
STRUCTURE's image reaches thumbnails kept in our own Storage bucket (#16), and
Groq's temporary errors are marked retryable (#19)."""

import httpx
import pytest

from app.enrich.budget import BudgetExhausted
from app.enrich.fetch import (
    EmbedPageProvider,
    FetchResult,
    ReelUnavailable,
    ScraperApiProvider,
    ThumbnailStore,
    YtDlpProvider,
    run_chain,
)
from app.enrich.runtime import Runtime
from app.enrich.transcribe import GroqTranscriber, TranscribeError

URL = "https://www.instagram.com/reel/C8xYz12/"
BASE = "https://proj.supabase.co"
JPEG = b"\xff\xd8\xff\xe0" + b"7" * 32


def client_for(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class Stub:
    def __init__(self, name, result=None, exc=None, budget=None):
        self.name, self.result, self.exc, self.budget, self.calls = name, result, exc, budget, 0

    async def fetch(self, shortcode, url):
        self.calls += 1
        if self.exc:
            raise self.exc
        return self.result


def budgets(**waits):
    taken = []

    async def take(provider):
        taken.append(provider)
        return waits.get(provider, 0)

    return take, taken


# ------------------------------------------------------- budgets (#15) --

async def test_chain_skips_a_provider_without_budget_and_tries_the_next():
    take, taken = budgets(instagram=600)
    blocked = Stub("embed_page", budget="instagram", result=FetchResult(source="x", caption="no"))
    scraper = Stub("scraper", budget="scraper", result=FetchResult(source="scraper", caption="hi"))
    r = await run_chain([blocked, scraper], "SC", URL, take=take)
    assert r.source == "scraper" and (blocked.calls, scraper.calls) == (0, 1)
    assert taken == ["instagram", "scraper"]


async def test_chain_takes_no_second_token_from_a_spent_budget():
    take, taken = budgets(instagram=600)
    a, b = Stub("embed_page", budget="instagram"), Stub("ytdlp", budget="instagram")
    with pytest.raises(BudgetExhausted):
        await run_chain([a, b], "SC", URL, take=take)
    assert taken == ["instagram"] and (a.calls, b.calls) == (0, 0)


async def test_chain_waits_only_when_nothing_useful_came_back_with_the_shortest_wait():
    take, _ = budgets(instagram=3600, scraper=40)
    failing = Stub("other", budget="other", exc=RuntimeError("login wall"))
    with pytest.raises(BudgetExhausted) as e:
        await run_chain([Stub("embed_page", budget="instagram"), failing,
                         Stub("scraper", budget="scraper")], "SC", URL, take=take)
    assert (e.value.provider, e.value.retry_after_s) == ("scraper", 40)
    assert failing.calls == 1


async def test_chain_with_budget_left_gives_up_as_before():
    take, _ = budgets()
    r = await run_chain([Stub("a", budget="instagram")], "SC", URL, take=take)
    assert r.source is None and r.unavailable is False


# ---------------------------------------------------- unavailable (#17) --

async def test_chain_reports_a_reel_a_provider_found_gone():
    r = await run_chain([Stub("a", exc=ReelUnavailable("HTTP 404")), Stub("b")], "SC", URL)
    assert r.source is None and r.unavailable is True
    assert FetchResult.from_meta(r.to_meta()).unavailable is True


async def test_chain_success_after_an_unavailable_provider_wins():
    r = await run_chain([Stub("a", exc=ReelUnavailable("404")),
                         Stub("b", result=FetchResult(source="b", caption="hi"))], "SC", URL)
    assert r.source == "b" and r.unavailable is False


@pytest.mark.parametrize("status", [404, 410])
async def test_embed_page_and_scraper_404_mean_unavailable(status):
    client = client_for(lambda request: httpx.Response(status))
    with pytest.raises(ReelUnavailable):
        await EmbedPageProvider(client).fetch("SC", URL)
    with pytest.raises(ReelUnavailable):
        await ScraperApiProvider(client, "https://scraper.example/v1", "k").fetch("SC", URL)


async def test_ytdlp_404_means_unavailable_other_errors_stay_none():
    def gone(url):
        raise RuntimeError("ERROR: [Instagram] SC: HTTP Error 404: Not Found")

    def walled(url):
        raise RuntimeError("Requested content is not available, rate-limit reached or login required")

    with pytest.raises(ReelUnavailable):
        await YtDlpProvider(extractor=gone).fetch("SC", URL)
    assert await YtDlpProvider(extractor=walled).fetch("SC", URL) is None


# ------------------------------------------- own Storage thumbnails (#16) --

def test_stored_url_names_only_our_own_bucket_objects():
    store = ThumbnailStore(client_for(lambda r: httpx.Response(500)), BASE + "/", "")
    public = f"{BASE}/storage/v1/object/public/thumbnails/C8xYz12.jpg"
    assert store.stored_url("C8xYz12.jpg") == public
    assert store.stored_url(public) == public
    for other in ("https://evil.example/storage/v1/object/public/thumbnails/C8xYz12.jpg",
                  "https://scontent.cdninstagram.com/t.jpg", "db:C8xYz12", "../secret.jpg",
                  f"{BASE}/storage/v1/object/public/thumbnails/C8xYz12.jpg?x=1", None, ""):
        assert store.stored_url(other) is None, other


async def test_read_stored_gets_the_public_object_without_redirects_and_capped():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        if request.url.path.endswith("/big.jpg"):
            return httpx.Response(200, content=b"x" * 101)
        if request.url.path.endswith("/moved.jpg"):
            return httpx.Response(302, headers={"location": "http://10.0.0.1/x.jpg"})
        return httpx.Response(200, content=JPEG)

    store = ThumbnailStore(client_for(handler), BASE, "", max_bytes=100)
    assert await store.read_stored("C8xYz12.jpg") == JPEG
    assert seen == [f"{BASE}/storage/v1/object/public/thumbnails/C8xYz12.jpg"]
    assert await store.read_stored("big.jpg") is None
    assert await store.read_stored("moved.jpg") is None
    assert all("10.0.0.1" not in u for u in seen)
    assert await store.read_stored("https://evil.example/thumbnails/C8xYz12.jpg") is None


async def test_structure_image_comes_from_our_storage_bucket():
    def handler(request):
        assert request.url.host == "proj.supabase.co", f"unexpected {request.url}"
        return httpx.Response(200, content=JPEG)

    http = client_for(handler)
    rt = Runtime(http=http, fetchers=[], thumbnails=ThumbnailStore(http, BASE, "service-key"))
    image = await rt.image_data_url("C8xYz12.jpg")
    assert image is not None and image.startswith("data:image/jpeg;base64,")


# ---------------------------------------------------- Groq errors (#19) --

def groq(handler):
    return GroqTranscriber(client_for(handler), api_key="gsk_test",
                           base_url="https://api.groq.com/openai/v1")


@pytest.mark.parametrize(("status", "retryable"), [(429, True), (500, True), (503, True),
                                                   (401, False), (403, False)])
async def test_groq_http_errors_say_whether_a_retry_may_help(status, retryable):
    with pytest.raises(TranscribeError) as e:
        await groq(lambda request: httpx.Response(status)).transcribe(
            "https://scontent.cdninstagram.com/a.m4a")
    assert e.value.retryable is retryable


async def test_groq_timeout_is_retryable_and_a_bad_url_is_not():
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(TranscribeError) as e:
        await groq(timeout).transcribe("https://scontent.cdninstagram.com/a.m4a")
    assert e.value.retryable is True
    with pytest.raises(TranscribeError) as e:
        await groq(timeout).transcribe("https://evil.example/a.m4a")
    assert e.value.retryable is False
