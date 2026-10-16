"""FETCH keeps the thumbnail in Postgres when there is no service-role key, and
STRUCTURE sends that stored image to the LLM (no second CDN download)."""

import httpx
import pytest

from app.enrich.fetch import FetchResult, ThumbnailStore
from app.services import thumbnails
from app.worker.loop import run_job

from .test_enrich_stages import FakeTranscriber, StubFetcher, claim, fake_llm, save

pytestmark = pytest.mark.db

SC = "C8xYz12"
JPEG = b"\xff\xd8\xff\xe0" + b"9" * 64
MEDIA = FetchResult(source="embed_page", caption="Best momos in Majnu ka Tilla #momos",
                    creator_handle="delhi.foodtrails",
                    thumbnail_url="https://scontent.cdninstagram.com/t.jpg")


@pytest.fixture
def local_runtime(offline_enrichment, db):
    downloads = []

    def handler(request):
        if request.url.host == "scontent.cdninstagram.com":
            downloads.append(str(request.url))
            return httpx.Response(200, content=JPEG)
        raise AssertionError(f"unexpected {request.url}")

    rt = offline_enrichment
    rt.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    rt.thumbnails = ThumbnailStore(rt.http, "https://p.supabase.co", "",
                                   local=thumbnails.writer(db))
    rt.fetchers = [StubFetcher(MEDIA)]
    rt.transcriber = FakeTranscriber()
    rt.llm, rt.extra["llm_calls"] = fake_llm()
    rt.extra["downloads"] = downloads
    return rt


async def test_thumbnail_lands_in_postgres_and_feeds_structure(db, make_user, local_runtime):
    uid = await make_user()
    await save(db, uid)
    await run_job(db, await claim(db), "w1")

    path = await db.fetchval("select thumbnail_path from public.reel_content where shortcode = $1",
                             SC)
    assert path == f"db:{SC}"
    assert await thumbnails.get(db, SC) == (JPEG, "image/jpeg")
    # One CDN download (FETCH); STRUCTURE read the stored copy.
    assert local_runtime.extra["downloads"] == ["https://scontent.cdninstagram.com/t.jpg"]
    (call,) = local_runtime.extra["llm_calls"]
    image = call["messages"][1]["content"][1]["image_url"]["url"]
    assert image.startswith("data:image/jpeg;base64,")
