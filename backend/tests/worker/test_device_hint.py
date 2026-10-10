"""Device hints in the worker (PIPELINE.md §5 FETCH provider 0, §8 trust rule):
the hint is used when the server chain can't reach Instagram, device-sourced
cards are never reused for someone else's save, and a late hint re-runs a
partial card from FETCH."""

import json
import time

import httpx
import pytest

from app.enrich.fetch import FetchResult
from app.worker import stages
from tests.worker.test_enrich_stages import CARD, MEDIA, StubFetcher, claim, fake_llm, run_all, save

pytestmark = pytest.mark.db

SC = "C8xYz12"
THUMB = "https://scontent-del1-1.cdninstagram.com/v/t51.29350-15/448_n.jpg?oh=1"
VIDEO = "https://video.xx.fbcdn.net/o1/v/t16/AQO.mp4?efg=1"
JPEG = b"\xff\xd8\xff\xe0jpeg"
HINT = {"caption": "Best momos in Majnu ka Tilla #momos", "creator_handle": "delhi.foodtrails",
        "thumbnail_url": THUMB, "video_url": VIDEO, "duration_s": 47.0, "shortcode": SC}


def cdn_http(image=JPEG):
    def handler(request):
        if request.url.host.endswith("cdninstagram.com"):
            return httpx.Response(200, content=image)
        raise AssertionError(f"unexpected {request.url}")
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture
def rt(offline_enrichment):
    """Server chain that always fails (Instagram blocks the data-centre IP)."""
    r = offline_enrichment
    r.http = cdn_http()
    r.thumbnails._client = r.http
    r.fetchers = [StubFetcher(None)]
    r.llm, r.extra["llm_calls"] = fake_llm()
    return r


async def set_hint(db, reel_id, hint=HINT, at=None):
    await db.execute("update public.reels set device_hint = $2::jsonb where id = $1", reel_id,
                     json.dumps({**hint, "at": at or time.time()}))


async def content(db):
    return await db.fetchrow("select * from public.reel_content where shortcode = $1", SC)


async def status(db, reel_id):
    return await db.fetchval("select status from public.reels where id = $1", reel_id)


async def test_hint_used_when_server_chain_fails(db, make_user, rt):
    uid = await make_user()
    rid = await save(db, uid)
    await set_hint(db, rid)
    await run_all(db)
    rc = await content(db)
    assert rc["fetch_source"] == "device" and rc["device_user_id"] == uid
    assert rc["caption"] == HINT["caption"] and rc["creator_handle"] == "delhi.foodtrails"
    assert rc["duration_s"] == pytest.approx(47.0)
    assert rc["thumbnail_path"] == THUMB  # confirmed by the server's own download (no key)
    assert rc["media_status"] == "ready" and rc["title"] == CARD["title"]
    assert await status(db, rid) == "enriched"
    assert rt.fetchers[0].calls == 0  # first success wins: the hint
    assert await db.fetchval(
        "select detail->>'source' from public.metrics where stage = 'fetch'") == "device"


async def test_unconfirmed_hint_thumbnail_is_not_shown(db, make_user, rt):
    rt.http = rt.thumbnails._client = cdn_http(image=b"<html>login</html>")
    rid = await save(db, await make_user())
    await set_hint(db, rid)
    await run_all(db)
    rc = await content(db)
    assert rc["fetch_source"] == "device" and rc["thumbnail_path"] is None
    assert rc["caption"] == HINT["caption"]


async def test_hint_for_another_shortcode_is_ignored(db, make_user, rt):
    rid = await save(db, await make_user())
    await set_hint(db, rid, {**HINT, "shortcode": "OTHER1"})
    await run_all(db)
    rc = await content(db)
    assert rc["fetch_source"] is None and rc["caption"] is None
    assert await status(db, rid) == "partial"


async def test_server_fetch_preferred_when_it_works(db, make_user, rt):
    """Hint first, but the hint's absence (or emptiness) means the server chain runs."""
    rt.fetchers = [StubFetcher(MEDIA)]
    rid = await save(db, await make_user())
    await set_hint(db, rid, {"shortcode": SC})
    await run_all(db)
    assert (await content(db))["fetch_source"] == "embed_page"
    assert (await content(db))["device_user_id"] is None


# ------------------------------------------------------------ trust rule --

async def _device_card_for(db, uid):
    rid = await save(db, uid)
    await set_hint(db, rid)
    await run_all(db)
    await db.execute("delete from public.jobs")
    return rid


async def test_device_card_is_not_a_cache_hit_for_another_user(db, make_user, rt):
    a_rid = await _device_card_for(db, await make_user())
    b = await make_user()
    b_rid = await save(db, b)
    job = await claim(db)
    j = {**dict(job), "payload": json.loads(job["payload"])}
    assert await stages.resolve(db, j) == "fetch"  # not "finalize"
    await db.execute("delete from public.jobs")
    # B has no hint and the server chain fails: B's save stays partial and can be
    # retried; A's own card is untouched.
    await stages.fetch(db, j)
    for name in ("transcribe", "vision", "structure", "finalize"):
        await stages.STAGES[name](db, j)
    assert await status(db, b_rid) == "partial"
    assert await status(db, a_rid) == "enriched"
    rc = await content(db)
    assert rc["media_status"] == "ready" and rc["fetch_source"] == "device"


async def test_device_card_is_a_cache_hit_for_the_same_user(db, make_user, rt):
    uid = await make_user()
    rid = await _device_card_for(db, uid)
    await db.execute("delete from public.reels where id = $1", rid)
    again = await save(db, uid)
    job = await claim(db)
    j = {**dict(job), "payload": json.loads(job["payload"])}
    assert await stages.resolve(db, j) == "finalize"
    await stages.finalize(db, j)
    assert await status(db, again) == "enriched"


async def test_server_fetch_overwrites_a_device_card(db, make_user, rt):
    a_rid = await _device_card_for(db, await make_user())
    rt.fetchers = [StubFetcher(MEDIA)]
    b_rid = await save(db, await make_user())
    await run_all(db)
    rc = await content(db)
    assert rc["fetch_source"] == "embed_page" and rc["device_user_id"] is None
    assert rc["thumbnail_path"] == "https://scontent.cdninstagram.com/t.jpg"
    # Server-fetched content is trusted for everyone.
    assert await status(db, a_rid) == "enriched" and await status(db, b_rid) == "enriched"


async def test_other_users_own_hint_is_used_for_their_save(db, make_user, rt):
    await _device_card_for(db, await make_user())
    b = await make_user()
    b_rid = await save(db, b)
    await set_hint(db, b_rid, {**HINT, "caption": "B's own read of the reel"})
    await run_all(db)
    rc = await content(db)
    assert rc["fetch_source"] == "device" and rc["device_user_id"] == b
    assert rc["caption"] == "B's own read of the reel"
    assert await status(db, b_rid) == "enriched"


async def test_device_hint_never_overwrites_server_fetched_content(db, make_user, rt):
    await db.execute(
        """insert into public.reel_content (shortcode, source_url, caption, fetch_source,
                                            media_status)
           values ($1, 'https://www.instagram.com/reel/C8xYz12/', 'server caption',
                   'embed_page', 'partial')""", SC)
    rid = await save(db, await make_user())
    await set_hint(db, rid, {**HINT, "caption": "device caption"})
    await run_all(db)
    rc = await content(db)
    assert rc["caption"] == "server caption" and rc["fetch_source"] == "embed_page"
    assert rc["device_user_id"] is None


# ------------------------------------------------------------- late hint --

async def test_hint_after_fetch_requeues_a_partial_card(db, make_user, rt):
    """The job passed FETCH before the hint landed: FINALIZE ends partial, sees the
    unused hint and re-enqueues from FETCH; that run uses it."""
    uid = await make_user()
    rid = await save(db, uid)
    job = await claim(db)
    j = {**dict(job), "payload": json.loads(job["payload"])}
    assert await stages.resolve(db, j) == "fetch"
    await stages.fetch(db, j)
    await set_hint(db, rid)  # arrives while the job is past FETCH
    for name in ("transcribe", "vision", "structure", "finalize"):
        await stages.STAGES[name](db, j)
    await db.execute("delete from public.jobs where id = $1", job["id"])
    (requeued,) = await db.fetch(
        "select stage, payload from public.jobs where kind = 'enrich'")
    assert requeued["stage"] == "fetch"
    assert json.loads(requeued["payload"])["reel_id"] == str(rid)
    assert await status(db, rid) == "pending"
    await run_all(db)
    assert (await content(db))["fetch_source"] == "device"
    assert await status(db, rid) == "enriched"


async def test_used_hint_does_not_requeue_forever(db, make_user, rt):
    """A hint already seen by FETCH that still ends partial (no LLM) is not retried."""
    rt.llm = None
    rid = await save(db, await make_user())
    await set_hint(db, rid)
    await run_all(db)
    assert await status(db, rid) == "partial"
    assert await db.fetchval("select count(*) from public.jobs where kind = 'enrich'") == 0


async def test_late_hint_via_api_recovers_partial_card(client, db, make_user, jwt_for, rt):
    uid = await make_user()
    rid = await save(db, uid)
    await run_all(db)
    assert await status(db, rid) == "partial"
    r = await client.post(f"/saves/{rid}/hint", json={k: v for k, v in HINT.items()},
                          headers={"Authorization": f"Bearer {jwt_for(uid)}"})
    assert r.json() == {"status": "accepted", "requeued": True}
    await run_all(db)
    assert await status(db, rid) == "enriched"
    assert (await content(db))["fetch_source"] == "device"


def test_fetch_result_source_device_is_useful():
    assert FetchResult(source="device", caption="x").useful
