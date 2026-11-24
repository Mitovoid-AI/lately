"""Stage review fixes against the test DB with fakes: a /share/ duplicate gives
its monthly save back (#4), a server fetch replaces device data outright (#6),
budget waits are capped (#15), partial saves say why (#17), TRANSCRIBE retries
temporary errors and skips stored transcripts (#19), and a retry can complete a
card from stored data with a clean payload (#20)."""

import json

import httpx
import pytest

from app.enrich.fetch import FetchResult, ReelUnavailable
from app.enrich.transcribe import TranscribeError
from app.worker import stages
from app.worker.loop import run_job
from tests.worker.test_device_hint import HINT, set_hint
from tests.worker.test_enrich_stages import (
    CARD,
    MEDIA,
    FakeTranscriber,
    StubFetcher,
    claim,
    fake_llm,
    run_all,
    save,
    thumb_http,
)

pytestmark = pytest.mark.db

SC = "C8xYz12"
URL = f"https://www.instagram.com/reel/{SC}/"


@pytest.fixture
def rt(offline_enrichment):
    r = offline_enrichment
    r.http = r.thumbnails._client = thumb_http()
    r.fetchers = [StubFetcher(MEDIA)]
    r.transcriber = FakeTranscriber()
    r.llm, r.extra["llm_calls"] = fake_llm()
    return r


class GoneFetcher:
    name = "embed_page"
    budget = None

    async def fetch(self, shortcode, url):
        raise ReelUnavailable("embed page HTTP 404")


async def save_row(db, reel_id):
    return await db.fetchrow("select status, fail_reason, retry_count from public.reels "
                             "where id = $1", reel_id)


async def content(db):
    return await db.fetchrow("select * from public.reel_content where shortcode = $1", SC)


async def claimed(db):
    job = await claim(db)
    return {**dict(job), "payload": json.loads(job["payload"])}


# ------------------------------------------------ share duplicate (#4) --

async def test_share_duplicate_gives_back_exactly_one_monthly_save(db, make_user, monkeypatch):
    def redirect(request):
        return httpx.Response(302, headers={"location": "https://www.instagram.com/reel/DupAbc1/"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(stages.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(redirect), **kw))
    uid = await make_user()
    events = "select count(*) from public.save_events where auth_user_id = $1"
    original = await save(db, uid, "DupAbc1")
    await db.execute("delete from public.jobs")
    await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $2)",
                      uid, "https://www.instagram.com/share/ZzTop9")
    later = await save(db, uid, "Later01")  # a save made after the duplicate
    await db.execute("delete from public.jobs where payload->>'reel_id' = $1", str(later))
    assert await db.fetchval(events, uid) == 3

    await run_job(db, await claim(db), "w1")

    assert {r["id"] for r in await db.fetch(
        "select id from public.reels where auth_user_id = $1", uid)} == {original, later}
    assert await db.fetchval(events, uid) == 2
    assert await db.fetchval("select count(*) from public.jobs") == 0


# ---------------------------------------------------- device trust (#6) --

async def test_server_fetch_replaces_device_supplied_fields_outright(db, make_user, rt):
    supplier = await make_user()
    await db.execute(
        """insert into public.reel_content (shortcode, source_url, caption, creator_handle,
             thumbnail_path, transcript, duration_s, fetch_source, device_user_id, media_status)
           values ($1, $2, 'device caption', 'device.handle',
                   'https://scontent.cdninstagram.com/d.jpg', 'device transcript', 12,
                   'device', $3, 'ready')""", SC, URL, supplier)
    rt.fetchers = [StubFetcher(FetchResult(source="embed_page", caption="server caption"))]
    await save(db, await make_user())
    j = await claimed(db)
    assert await stages.resolve(db, j) == "fetch"  # someone else's device card: no cache hit
    await stages.fetch(db, j)
    rc = await content(db)
    assert (rc["fetch_source"], rc["device_user_id"]) == ("embed_page", None)
    assert rc["caption"] == "server caption"
    assert rc["creator_handle"] is None and rc["thumbnail_path"] is None
    assert rc["transcript"] is None and rc["duration_s"] is None


async def test_server_fetch_over_server_data_still_merges(db, make_user, rt):
    await db.execute(
        """insert into public.reel_content (shortcode, source_url, caption, creator_handle,
             transcript, fetch_source, media_status)
           values ($1, $2, 'first', 'server.handle', 'kept transcript', 'embed_page',
                   'partial')""", SC, URL)
    rt.fetchers = [StubFetcher(FetchResult(source="ytdlp", caption="second"))]
    await save(db, await make_user())
    j = await claimed(db)
    await stages.resolve(db, j)
    await stages.fetch(db, j)
    rc = await content(db)
    assert (rc["caption"], rc["creator_handle"], rc["transcript"]) == \
        ("second", "server.handle", "kept transcript")


# ------------------------------------------------------ fail reasons (#17) --

async def test_blocked_fetch_ends_partial_with_fetch_blocked(db, make_user, offline_enrichment):
    rid = await save(db, await make_user())
    await run_all(db)
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"]) == ("partial", "fetch_blocked")


async def test_gone_reel_ends_partial_with_unavailable(db, make_user, offline_enrichment):
    offline_enrichment.fetchers = [GoneFetcher()]
    rid = await save(db, await make_user())
    await run_all(db)
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"]) == ("partial", "unavailable")


async def test_llm_down_ends_partial_with_ai_unavailable(db, make_user, rt):
    rt.llm, _ = fake_llm(status=503)
    rid = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    assert (await save_row(db, rid))["status"] == "pending"  # still retrying
    await db.execute("update public.jobs set run_at = now(), attempts = max_attempts - 1")
    await run_job(db, await claim(db), "w1")
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"]) == ("partial", "ai_unavailable")


async def test_enriched_save_has_no_fail_reason(db, make_user, rt):
    rid = await save(db, await make_user())
    await db.execute("update public.reels set fail_reason = 'fetch_blocked' where id = $1", rid)
    await run_all(db)
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"]) == ("enriched", None)


@pytest.mark.parametrize(("error", "reason"), [
    ("llm unavailable: fake-model: HTTP 503", "ai_unavailable"),
    ("stuck: worker lost", "timed_out"),
    ("no shortcode after resolve", "timed_out"),
])
async def test_dead_lettered_job_gets_a_reason_from_its_last_error(db, make_user, error, reason):
    rid = await save(db, await make_user())
    await db.execute("update public.jobs set attempts = max_attempts - 1")
    job = await claim(db)
    await db.execute("select public.release_job($1, 'w1', $2)", job["id"], error)
    assert await db.fetchval("select count(*) from public.jobs_dead") == 1
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"]) == ("partial", reason)


async def _late_hint_run(db, rid):
    """Run one save's job with a device hint arriving after FETCH."""
    j = await claimed(db)
    assert await stages.resolve(db, j) == "fetch"
    await stages.fetch(db, j)
    await set_hint(db, rid, HINT)
    for name in ("transcribe", "vision", "structure", "finalize"):
        await stages.STAGES[name](db, j)
    await db.execute("delete from public.jobs where id = $1", j["id"])


async def test_late_hint_requeue_clears_the_reason_and_uses_a_retry(db, make_user, rt):
    rt.fetchers = [StubFetcher(None)]  # Instagram blocks the server
    rid = await save(db, await make_user())
    await _late_hint_run(db, rid)
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"], row["retry_count"]) == ("pending", None, 1)
    assert await db.fetchval("select stage from public.jobs where kind = 'enrich'") == "fetch"


async def test_late_hint_requeue_stops_at_the_daily_retry_cap(db, make_user, rt):
    rt.fetchers = [StubFetcher(None)]
    rid = await save(db, await make_user())
    await db.execute("update public.reels set retry_count = 3, retry_window_start = now() "
                     "where id = $1", rid)
    await _late_hint_run(db, rid)
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"], row["retry_count"]) == \
        ("partial", "fetch_blocked", 3)
    assert await db.fetchval("select count(*) from public.jobs where kind = 'enrich'") == 0


# ---------------------------------------------------- budget waits (#15) --

async def test_capped_budget_wait_ends_partial_instead_of_waiting(db, make_user, rt):
    await db.execute("insert into public.provider_budget (provider, per_minute, per_day, "
                     "window_start, used) values ('instagram', 1, 100, now(), 1)")
    rid = await save(db, await make_user())
    await db.execute("update public.jobs set created_at = now() - interval '31 minutes'")
    await run_job(db, await claim(db), "w1")
    assert await db.fetchval("select count(*) from public.jobs where kind = 'enrich'") == 0
    assert rt.fetchers[0].calls == 0
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"]) == ("partial", "fetch_blocked")


async def test_capped_llm_budget_wait_ends_with_a_fallback_card(db, make_user, rt):
    await db.execute("insert into public.provider_budget (provider, per_minute, per_day, "
                     "window_start, used) values ('llm', 1, 100, now(), 1)")
    rid = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    job = await db.fetchrow("select stage, attempts from public.jobs where kind = 'enrich'")
    assert (job["stage"], job["attempts"]) == ("structure", 0)  # under the cap: waits

    await db.execute("update public.jobs set run_at = now(), "
                     "created_at = now() - interval '31 minutes'")
    await run_job(db, await claim(db), "w1")
    assert rt.extra["llm_calls"] == []
    assert (await content(db))["title"] == "Best momos in Majnu ka Tilla"
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"]) == ("partial", "ai_unavailable")


# ------------------------------------------------------- transcribe (#19) --

async def test_temporary_transcribe_error_retries_until_the_last_attempt(db, make_user, rt):
    rt.transcriber = FakeTranscriber(exc=TranscribeError("groq HTTP 503", retryable=True))
    rid = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    job = await db.fetchrow("select *, run_at > now() + interval '50 seconds' as backed_off "
                            "from public.jobs")
    assert job["stage"] == "transcribe" and job["attempts"] == 1 and job["backed_off"]
    assert "503" in job["last_error"]

    await db.execute("update public.jobs set run_at = now(), attempts = max_attempts - 1")
    await run_job(db, await claim(db), "w1")
    assert (await save_row(db, rid))["status"] == "enriched"  # no transcript, card goes on
    assert len(rt.transcriber.urls) == 2


async def test_stored_server_transcript_is_not_transcribed_again(db, make_user, rt):
    await db.execute(
        """insert into public.reel_content (shortcode, source_url, caption, transcript,
             fetch_source) values ($1, $2, 'short', 'stored transcript', 'embed_page')""",
        SC, URL)
    await save(db, await make_user())
    await run_all(db)
    assert rt.transcriber.urls == []
    assert (await content(db))["transcript"] == "stored transcript"
    detail = await db.fetchval("select detail from public.metrics where stage = 'transcribe'")
    assert json.loads(detail)["reason"] == "stored"


# --------------------------------------------------------- retries (#20) --

async def test_retry_with_a_blocked_refetch_completes_from_stored_server_data(
        db, make_user, rt):
    # An earlier run fetched the caption but the AI step failed; this retry's fetch is blocked.
    await db.execute(
        """insert into public.reel_content (shortcode, source_url, caption, creator_handle,
             fetch_source, media_status)
           values ($1, $2, 'Best momos in Majnu ka Tilla #momos', 'delhi.foodtrails',
                   'embed_page', 'partial')""", SC, URL)
    rt.fetchers = [StubFetcher(None)]
    rid = await save(db, await make_user())
    await run_all(db)
    assert (await content(db))["media_status"] == "ready"
    row = await save_row(db, rid)
    assert (row["status"], row["fail_reason"]) == ("enriched", None)


async def test_structure_cleans_the_card_before_it_enters_the_payload(db, make_user, rt):
    dirty = {**CARD, "title": "Jhol momos\u0000 at Majnu ka Tilla",
             "tags": ["momos\u0000", "delhi food"]}
    rt.llm, _ = fake_llm(content=json.dumps(dirty))
    rid = await save(db, await make_user())
    await run_job(db, await claim(db), "w1")
    assert await db.fetchval("select count(*) from public.jobs where kind = 'enrich'") == 0
    rc = await content(db)
    assert rc["title"] == "Jhol momos at Majnu ka Tilla" and "momos" in rc["tags"]
    assert (await save_row(db, rid))["status"] == "enriched"
