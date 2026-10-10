"""POST /saves/{id}/hint: the device's embed-page read for one save (PIPELINE.md §5
FETCH "on-device data", §8 trust rule)."""

import json
import uuid

import pytest

pytestmark = pytest.mark.db

SC = "HINT1"
THUMB = "https://scontent-del1-1.cdninstagram.com/v/t51.29350-15/448_n.jpg?oh=1"
VIDEO = "https://video.xx.fbcdn.net/o1/v/t16/AQO.mp4?efg=1"
GOOD = {"caption": "Best momos in Majnu ka Tilla", "creator_handle": "delhi.foodtrails",
        "thumbnail_url": THUMB, "video_url": VIDEO, "duration_s": 47.3}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _save(db, uid, status="pending", code=SC, shortcode=True):
    url = f"https://www.instagram.com/reel/{code}/"
    return await db.fetchval(
        "insert into public.reels (auth_user_id, source_url, shortcode, shortcode_key, status) "
        "values ($1, $2, $3, $3, $4) returning id", uid, url, code if shortcode else None, status)


async def _hint(db, rid):
    raw = await db.fetchval("select device_hint from public.reels where id = $1", rid)
    return json.loads(raw) if raw else None


async def _enrich_jobs(db, rid):
    return await db.fetch(
        "select stage, payload from public.jobs where kind = 'enrich' and payload->>'reel_id' = $1",
        str(rid))


async def test_hint_stored_on_the_save(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _save(db, uid)
    r = await client.post(f"/saves/{rid}/hint", json={**GOOD, "shortcode": SC},
                          headers=auth(jwt_for(uid)))
    assert r.status_code == 202
    assert r.json() == {"status": "accepted", "requeued": False}
    h = await _hint(db, rid)
    assert {k: h[k] for k in GOOD} == GOOD
    assert h["shortcode"] == SC and h["at"] > 0
    # Nothing shared is written by the API: reel_content is the worker's job.
    assert await db.fetchval("select count(*) from public.reel_content") == 0


async def test_non_cdn_urls_are_dropped(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _save(db, uid)
    body = {**GOOD, "thumbnail_url": "https://evil.example/t.jpg",
            "video_url": "http://video.xx.fbcdn.net/v.mp4"}
    r = await client.post(f"/saves/{rid}/hint", json=body, headers=auth(jwt_for(uid)))
    assert r.status_code == 202
    h = await _hint(db, rid)
    assert h["thumbnail_url"] is None and h["video_url"] is None
    assert h["caption"] == GOOD["caption"]


@pytest.mark.parametrize("bad", [
    {"caption": "x" * 5001},
    {"creator_handle": "not a handle!"},
    {"creator_handle": "x" * 31},
    {"duration_s": -1},
    {"duration_s": 3601},
    {"shortcode": "../../etc"},
])
async def test_invalid_fields_are_422(client, db, make_user, jwt_for, bad):
    uid = await make_user()
    rid = await _save(db, uid)
    r = await client.post(f"/saves/{rid}/hint", json={**GOOD, **bad}, headers=auth(jwt_for(uid)))
    assert r.status_code == 422
    assert await _hint(db, rid) is None


async def test_empty_hint_is_accepted_but_not_stored(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _save(db, uid)
    r = await client.post(f"/saves/{rid}/hint", json={"thumbnail_url": "https://evil.example/x"},
                          headers=auth(jwt_for(uid)))
    assert r.status_code == 202 and r.json() == {"status": "ignored", "requeued": False}
    assert await _hint(db, rid) is None


async def test_hint_is_owner_only(client, db, make_user, jwt_for):
    owner, other = await make_user(), await make_user()
    rid = await _save(db, owner)
    r = await client.post(f"/saves/{rid}/hint", json=GOOD, headers=auth(jwt_for(other)))
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert await _hint(db, rid) is None
    r = await client.post(f"/saves/{uuid.uuid4()}/hint", json=GOOD, headers=auth(jwt_for(owner)))
    assert r.status_code == 404


async def test_hint_requires_auth(client, db, make_user):
    rid = await _save(db, await make_user())
    assert (await client.post(f"/saves/{rid}/hint", json=GOOD)).status_code == 401


async def test_late_hint_requeues_partial_save_from_fetch(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _save(db, uid, status="partial")
    r = await client.post(f"/saves/{rid}/hint", json=GOOD, headers=auth(jwt_for(uid)))
    assert r.json() == {"status": "accepted", "requeued": True}
    (job,) = await _enrich_jobs(db, rid)
    assert job["stage"] == "fetch"
    assert json.loads(job["payload"])["user_id"] == str(uid)
    assert await db.fetchval("select status from public.reels where id = $1", rid) == "pending"
    # A second hint while that job waits adds no job (the job reads the newest hint).
    r = await client.post(f"/saves/{rid}/hint", json={**GOOD, "caption": "newer"},
                          headers=auth(jwt_for(uid)))
    assert r.json()["requeued"] is False
    assert len(await _enrich_jobs(db, rid)) == 1
    assert (await _hint(db, rid))["caption"] == "newer"


async def test_partial_share_link_save_requeues_from_resolve(client, db, make_user, jwt_for):
    uid = await make_user()
    rid = await _save(db, uid, status="partial", code="SHARE9", shortcode=False)
    await client.post(f"/saves/{rid}/hint", json=GOOD, headers=auth(jwt_for(uid)))
    assert [j["stage"] for j in await _enrich_jobs(db, rid)] == ["resolve"]


@pytest.mark.parametrize("status", ["pending", "enriched"])
async def test_hint_for_pending_or_enriched_save_adds_no_job(client, db, make_user, jwt_for,
                                                             status):
    uid = await make_user()
    rid = await _save(db, uid, status=status)
    r = await client.post(f"/saves/{rid}/hint", json=GOOD, headers=auth(jwt_for(uid)))
    assert r.json() == {"status": "accepted", "requeued": False}
    assert await _enrich_jobs(db, rid) == []
