"""Phase 2 stages against the test DB with fakes: FETCH → TRANSCRIBE → VISION →
STRUCTURE → FINALIZE → embed job (PIPELINE.md §5, SEARCH.md §3)."""

import json
import time
import uuid

import httpx
import pytest

from app.enrich.fetch import FetchResult
from app.enrich.structure import ChatLLM
from app.enrich.transcribe import Transcript, TranscribeError
from app.worker import stages
from app.worker.loop import run_job

pytestmark = pytest.mark.db

SC = "C8xYz12"
URL = f"https://www.instagram.com/reel/{SC}/"

CARD = {
    "title": "Jhol momos at Majnu ka Tilla",
    "summary": "A momos crawl in Majnu ka Tilla, Delhi.",
    "category": "Food & Places",
    "tags": ["momos", "delhi food"],
    "steps": ["Take the metro to Vidhan Sabha", "Walk to the monastery lane"],
    "entities": [{"type": "place", "name": "Majnu ka Tilla", "parent": "Delhi",
                  "region": "Delhi", "country": "India"}],
    "likely_queries": ["delhi momos", "momos wali jagah", "majnu ka tilla food",
                       "best momos delhi", "tibetan food delhi"],
    "visual_description": "A plate of momos in red soup.",
    "ocr_text": "BEST MOMOS",
    "search_text": "momos jhol laphing majnu ka tilla delhi",
}


class StubFetcher:
    name = "stub"
    budget = "instagram"

    def __init__(self, result):
        self.result, self.calls = result, 0

    async def fetch(self, shortcode, url):
        self.calls += 1
        return self.result


class FakeTranscriber:
    def __init__(self, text="aaj hum momos khayenge", exc=None):
        self.text, self.exc, self.urls = text, exc, []

    async def transcribe(self, url):
        self.urls.append(url)
        if self.exc:
            raise self.exc
        return Transcript(text=self.text, duration_s=47.0)


def fake_llm(content=None, status=200):
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        if status != 200:
            return httpx.Response(status)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": content or json.dumps(CARD)}}],
            "usage": {"prompt_tokens": 1000, "completion_tokens": 400}})

    llm = ChatLLM(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                  "https://llm.test/v1", "k", ["fake-model"])
    return llm, calls


def thumb_http():
    def handler(request):
        if request.url.host == "cdn.test":
            return httpx.Response(200, content=b"\xff\xd8jpeg")
        raise AssertionError(f"unexpected {request.url}")
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


MEDIA = FetchResult(source="embed_page", caption="Best momos in Majnu ka Tilla #momos",
                    creator_handle="delhi.foodtrails", thumbnail_url="https://cdn.test/t.jpg",
                    video_url="https://cdn.test/v.mp4", duration_s=47.0)


@pytest.fixture
def full_runtime(offline_enrichment):
    rt = offline_enrichment
    rt.http = thumb_http()
    rt.fetchers = [StubFetcher(MEDIA)]
    rt.transcriber = FakeTranscriber()
    rt.llm, rt.extra["llm_calls"] = fake_llm()
    return rt


async def save(db, uid, code=SC):
    url = f"https://www.instagram.com/reel/{code}/"
    row = await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $2)", uid, url)
    return row["reel_id"]


async def claim(db, worker="w1"):
    return await db.fetchrow("select * from public.claim_job($1)", worker)


async def run_all(db, worker="w1"):
    """Claim and run every due job (enrich, then the embed jobs it enqueues)."""
    ran = 0
    while (job := await claim(db, worker)) is not None:
        await run_job(db, job, worker)
        ran += 1
    return ran


async def test_save_to_card_end_to_end(client, make_user, jwt_for, db, full_runtime):
    uid = await make_user()
    r = await client.post("/saves", json={"text": f"{URL}?igsh=abc"},
                          headers={"Authorization": f"Bearer {jwt_for(uid)}"})
    assert r.status_code == 201
    reel_id = uuid.UUID(r.json()["reel_id"])

    job = await claim(db)
    await run_job(db, job, "w1")

    rc = await db.fetchrow("select * from public.reel_content where shortcode = $1", SC)
    assert rc["media_status"] == "ready" and rc["fetch_source"] == "embed_page"
    assert rc["title"] == CARD["title"] and rc["category"] == "Food & Places"
    assert rc["caption"].startswith("Best momos") and rc["creator_handle"] == "delhi.foodtrails"
    assert rc["transcript"] == "aaj hum momos khayenge"
    assert json.loads(rc["steps"]) == CARD["steps"]
    assert json.loads(rc["entities"])[0]["name"] == "Majnu ka Tilla"
    assert rc["entity_names"] == ["Majnu ka Tilla", "Delhi"]
    assert rc["likely_queries"] == CARD["likely_queries"]
    assert rc["parser_version"] == 1 and rc["search_text"] == CARD["search_text"]
    assert rc["thumbnail_path"] == "https://cdn.test/t.jpg"  # no service key → remote URL
    assert rc["duration_s"] == pytest.approx(47.0)
    assert json.loads(rc["fetch_meta"])["video_url"] == "https://cdn.test/v.mp4"
    assert rc["tsv"] is not None and "majnu" in rc["match_text"].lower()

    assert await db.fetchval("select status from public.reels where id = $1", reel_id) == "enriched"
    embed = await db.fetchrow("select * from public.jobs")
    assert embed["kind"] == "embed" and embed["stage"] == "embed"
    assert json.loads(embed["payload"]) == {"reel_id": str(reel_id)}
    assert full_runtime.transcriber.urls == ["https://cdn.test/v.mp4"]

    # The LLM got the thumbnail as an image.
    (call,) = full_runtime.extra["llm_calls"]
    assert call["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/jpeg")

    assert await run_all(db) == 1
    assert await db.fetchval("select embedding is not null from public.reels where id = $1",
                             reel_id)
    assert await db.fetchval("select count(*) from public.jobs") == 0
    outcomes = {r["stage"]: r["outcome"] for r in await db.fetch(
        "select stage, outcome from public.metrics")}
    assert outcomes == {"resolve": "ok", "fetch": "ok", "transcribe": "ok", "vision": "skipped",
                        "structure": "ok", "finalize": "ok", "embed": "ok"}
    cost = await db.fetchval("select cost_usd from public.metrics where stage = 'transcribe'")
    assert cost > 0

    # The card reads back through the shared Save view, and is searchable.
    detail = await client.get(f"/saves/{reel_id}",
                              headers={"Authorization": f"Bearer {jwt_for(uid)}"})
    if detail.status_code == 200:  # GET /saves/{id} lands with workstream A
        assert detail.json()["title"] == CARD["title"]


async def test_partial_path_when_fetch_gives_up_and_no_llm(db, make_user, offline_enrichment):
    reel_id = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    rc = await db.fetchrow("select * from public.reel_content where shortcode = $1", SC)
    assert rc["media_status"] == "partial" and rc["fetch_source"] is None
    assert rc["title"] == "Saved reel" and rc["category"] == "Watch Later"
    assert await db.fetchval("select status from public.reels where id = $1", reel_id) == "partial"
    assert await db.fetchval("select count(*) from public.jobs where kind = 'embed'") == 1
    assert await db.fetchval(
        "select outcome from public.metrics where stage = 'fetch'") == "partial"


async def test_caption_only_card_without_llm_is_partial(db, make_user, offline_enrichment):
    offline_enrichment.fetchers = [StubFetcher(FetchResult(source="embed_page",
                                                           caption="Leg day split #fitness"))]
    reel_id = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    rc = await db.fetchrow("select * from public.reel_content where shortcode = $1", SC)
    assert rc["media_status"] == "partial" and rc["title"] == "Leg day split"
    assert rc["tags"] == ["fitness"]
    assert await db.fetchval("select status from public.reels where id = $1", reel_id) == "partial"


async def test_budget_exhaustion_reschedules_without_burning_attempt(
        db, make_user, full_runtime):
    await db.execute("insert into public.provider_budget (provider, per_minute, per_day, "
                     "window_start, used) values ('instagram', 1, 100, now(), 1)")
    await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    job = await db.fetchrow("select *, run_at > now() + interval '1 second' as later "
                            "from public.jobs")
    assert job["stage"] == "fetch" and job["attempts"] == 0
    assert job["locked_by"] is None and job["later"] is True
    assert "instagram" in job["last_error"]
    assert full_runtime.fetchers[0].calls == 0
    assert await db.fetchval("select count(*) from public.jobs_dead") == 0


async def test_finalize_is_idempotent_and_marks_every_save_of_the_reel(
        db, make_user, full_runtime):
    a = await save(db, await make_user())
    b = await save(db, await make_user())
    await db.execute("delete from public.jobs where payload->>'reel_id' = $1", str(b))
    await run_job(db, await claim(db), "w1")
    statuses = {r["id"]: r["status"] for r in await db.fetch("select id, status from public.reels")}
    assert statuses == {a: "enriched", b: "enriched"}
    embeds = {json.loads(r["payload"])["reel_id"] for r in await db.fetch(
        "select payload from public.jobs where kind = 'embed'")}
    assert embeds == {str(a), str(b)}

    # Re-run FINALIZE with the same payload: same card, no duplicate embed jobs.
    payload = {"reel_id": str(a), "shortcode": SC, "card": {**CARD, "entity_names": ["x"],
               "parser_version": 1}, "structure_outcome": "ok",
               "fetch": {**MEDIA.to_meta(), "at": time.time()}}
    for _ in range(2):
        assert await stages.finalize(db, {"payload": dict(payload), "attempts": 1}) is None
    assert await db.fetchval("select count(*) from public.jobs where kind = 'embed'") == 2
    assert await db.fetchval("select count(*) from public.reel_content") == 1


async def test_partial_rerun_never_downgrades_a_ready_card(db, make_user, full_runtime):
    await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    payload = {"reel_id": str(uuid.uuid4()), "shortcode": SC, "structure_outcome": "fallback",
               "card": {**CARD, "title": "worse", "entity_names": [], "parser_version": 1},
               "fetch": {"source": None}}
    await stages.finalize(db, {"payload": payload, "attempts": 1})
    rc = await db.fetchrow("select title, media_status from public.reel_content")
    assert (rc["title"], rc["media_status"]) == (CARD["title"], "ready")


async def test_cache_hit_finalizes_only_the_new_save(db, make_user, full_runtime):
    first = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    await db.execute("delete from public.jobs")
    second = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    assert full_runtime.fetchers[0].calls == 1  # no second fetch
    assert await db.fetchval("select status from public.reels where id = $1", second) == "enriched"
    embeds = [json.loads(r["payload"])["reel_id"] for r in await db.fetch(
        "select payload from public.jobs where kind = 'embed'")]
    assert embeds == [str(second)] and str(first) not in embeds


async def test_embed_job_without_embedder_completes_as_skipped(db, make_user, offline_enrichment):
    offline_enrichment.embedder = None
    reel_id = await save(db, await make_user())
    await db.execute("delete from public.jobs")
    await db.execute("insert into public.jobs (kind, payload, stage) "
                     "values ('embed', jsonb_build_object('reel_id', $1::text), 'embed')",
                     str(reel_id))
    await run_job(db, await claim(db), "w1")
    assert await db.fetchval("select count(*) from public.jobs") == 0
    assert await db.fetchval("select embedding is null from public.reels")
    assert await db.fetchval("select outcome from public.metrics where stage='embed'") == "skipped"


async def test_embed_job_uses_note(db, make_user, offline_enrichment):
    reel_id = await save(db, await make_user())
    await db.execute("delete from public.jobs")
    await db.execute("update public.reels set note = 'birthday gift idea' where id = $1", reel_id)
    await db.execute("insert into public.jobs (kind, payload, stage) "
                     "values ('embed', jsonb_build_object('reel_id', $1::text), 'embed')",
                     str(reel_id))
    await run_job(db, await claim(db), "w1")
    (vec,) = await offline_enrichment.embedder.embed(["birthday gift idea"], "document")
    got = await db.fetchval("select embedding::text from public.reels where id = $1", reel_id)
    assert [round(float(x), 5) for x in got.strip("[]").split(",")] == \
        [round(x, 5) for x in vec]


async def test_llm_down_retries_then_falls_back_on_last_attempt(db, make_user, full_runtime):
    full_runtime.llm, _ = fake_llm(status=503)
    reel_id = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    job = await db.fetchrow("select * from public.jobs")
    assert job["stage"] == "structure" and job["attempts"] == 1 and job["last_error"]

    await db.execute("update public.jobs set run_at = now(), attempts = max_attempts - 1")
    await run_job(db, await claim(db), "w1")
    rc = await db.fetchrow("select * from public.reel_content")
    assert rc["media_status"] == "partial" and rc["title"] == "Best momos in Majnu ka Tilla"
    assert await db.fetchval("select status from public.reels where id = $1", reel_id) == "partial"


async def test_transcribe_failure_is_skipped_not_fatal(db, make_user, full_runtime):
    full_runtime.transcriber = FakeTranscriber(exc=TranscribeError("groq HTTP 500"))
    await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    assert await db.fetchval("select media_status from public.reel_content") == "ready"
    assert await db.fetchval(
        "select outcome from public.metrics where stage = 'transcribe'") == "error"


async def test_transcribe_refetches_stale_media_urls(db, make_user, full_runtime):
    fresh = FetchResult(**{**MEDIA.to_meta(), "video_url": "https://cdn.test/fresh.mp4"})
    reel_id = await save(db, await make_user())
    await db.execute("update public.reels set shortcode_key = $1 where id = $2", SC, reel_id)
    full_runtime.fetchers = [StubFetcher(fresh)]
    stale = {**MEDIA.to_meta(), "at": time.time() - 7200}
    job = {"payload": {"reel_id": str(reel_id), "shortcode": SC, "fetch": stale}, "attempts": 2}
    await db.execute("insert into public.reel_content (shortcode, source_url, caption) "
                     "values ($1, $2, 'short')", SC, URL)
    assert await stages.transcribe(db, job) == "vision"
    assert full_runtime.transcriber.urls == ["https://cdn.test/fresh.mp4"]
    assert job["payload"]["fetch"]["video_url"] == "https://cdn.test/fresh.mp4"


async def test_strong_caption_skips_transcribe(db, make_user, full_runtime):
    long_caption = " ".join(["word"] * 60)
    full_runtime.fetchers = [StubFetcher(FetchResult(**{**MEDIA.to_meta(),
                                                        "caption": long_caption}))]
    await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    assert full_runtime.transcriber.urls == []
    detail = await db.fetchval("select detail from public.metrics where stage = 'transcribe'")
    assert json.loads(detail)["reason"] == "caption_strong"
