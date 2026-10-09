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
