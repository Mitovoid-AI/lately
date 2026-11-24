"""POST /retries/{reel_id}: re-enqueue enrichment from FETCH (PIPELINE.md §7)."""

import uuid

import pytest

from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db


def auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _partial(db, uid, code="PART1", shortcode=True):
    url = f"https://www.instagram.com/reel/{code}/"
    return await db.fetchval(
        "insert into public.reels (auth_user_id, source_url, shortcode, shortcode_key, status) "
        "values ($1, $2, $3, $3, 'partial') returning id", uid, url, code if shortcode else None)


async def _enrich_jobs(db, reel_id):
    return await db.fetch(
        "select stage, payload->>'user_id' as uid from public.jobs "
        "where kind = 'enrich' and payload->>'reel_id' = $1", str(reel_id))


async def test_retry_partial_save_enqueues_from_fetch(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _partial(db, uid)
    r = await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
    assert r.status_code == 202 and r.json() == {"status": "queued"}
    assert [(j["stage"], j["uid"]) for j in await _enrich_jobs(db, rid)] == [("fetch", str(uid))]
    assert await db.fetchval("select status from public.reels where id = $1", rid) == "pending"
    # retrying again while the job waits adds nothing
    assert (await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))).status_code == 202
    assert len(await _enrich_jobs(db, rid)) == 1


async def test_retry_without_shortcode_starts_at_resolve(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _partial(db, uid, "SHARE1", shortcode=False)
    await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
    assert [j["stage"] for j in await _enrich_jobs(db, rid)] == ["resolve"]


async def test_retry_pending_save_whose_job_died(client, db, make_user, jwt_for):
    uid = await make_user()
    saved = await client.post("/saves", json={"text": "https://www.instagram.com/reel/DEAD1/"},
                              headers=auth(jwt_for(uid)))
    rid = saved.json()["reel_id"]
    await db.execute("delete from public.jobs where payload->>'reel_id' = $1", rid)
    r = await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
    assert r.status_code == 202
    assert [j["stage"] for j in await _enrich_jobs(db, rid)] == ["fetch"]


async def test_retry_enriched_save_is_refused(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await seed_card(db, uid, CARDS["MANALI1"], None)
    r = await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert await _enrich_jobs(db, rid) == []


async def test_retry_404_for_other_user_or_unknown(client, db, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    rid = await _partial(db, a)
    for target in (rid, uuid.uuid4()):
        r = await client.post(f"/retries/{target}", headers=auth(jwt_for(b)))
        assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert await _enrich_jobs(db, rid) == []


async def test_retry_401_without_token(client):
    assert (await client.post(f"/retries/{uuid.uuid4()}")).status_code == 401


# ------------------------------------------ a job already exists (GitHub #12)

async def _job(db, rid, **cols):
    """Set raw SQL values on the save's job (if any given), then read it back."""
    if cols:
        sets = ", ".join(f"{k} = {v}" for k, v in cols.items())
        await db.execute(f"update public.jobs set {sets} where payload->>'reel_id' = $1", str(rid))
    return await db.fetchrow("select *, run_at <= now() as due from public.jobs "
                             "where payload->>'reel_id' = $1", str(rid))


async def _retry_count(db, rid):
    return await db.fetchval("select retry_count from public.reels where id = $1", rid)


async def test_retry_brings_a_waiting_job_forward_for_free(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _partial(db, uid)
    await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))  # 1 retry used
    await _job(db, rid, run_at="now() + interval '8 minutes'", attempts="2")  # backing off
    for _ in range(4):  # more than the daily cap: bringing a job forward is free
        r = await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
        assert r.status_code == 202 and r.json() == {"status": "queued"}
    job = await _job(db, rid)
    assert job["due"] and job["locked_at"] is None and job["attempts"] == 2
    assert len(await _enrich_jobs(db, rid)) == 1 and await _retry_count(db, rid) == 1


async def test_retry_frees_a_job_whose_worker_went_quiet(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _partial(db, uid)
    await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
    await _job(db, rid, locked_at="now() - interval '1 hour'", locked_by="'w-dead'",
               heartbeat_at="now() - interval '30 minutes'")
    r = await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
    assert r.status_code == 202 and r.json() == {"status": "queued"}
    job = await _job(db, rid)
    assert job["locked_at"] is None and job["locked_by"] is None and job["due"]
    assert await _retry_count(db, rid) == 1


async def test_retry_leaves_a_live_workers_job_alone(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _partial(db, uid)
    await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
    await _job(db, rid, locked_at="now() - interval '1 hour'", locked_by="'w-live'",
               heartbeat_at="now() - interval '20 seconds'")
    r = await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))
    assert r.status_code == 202 and r.json() == {"status": "running"}
    job = await _job(db, rid)
    assert job["locked_by"] == "w-live" and await _retry_count(db, rid) == 1


async def test_retry_clears_the_fail_reason(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _partial(db, uid)
    await db.execute("update public.reels set fail_reason = 'timed_out' where id = $1", rid)
    assert (await client.post(f"/retries/{rid}", headers=auth(jwt_for(uid)))).status_code == 202
    assert await db.fetchval("select fail_reason from public.reels where id = $1", rid) is None
