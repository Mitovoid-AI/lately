"""/saves contract: real JWT verification, real save_reel, real database."""

import uuid

import pytest

pytestmark = pytest.mark.db
URL = "https://www.instagram.com/reel/C8xYz12/"


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def reel_url(code):
    return f"https://www.instagram.com/reel/{code}/"


async def test_post_saves_401_without_token(client):
    r = await client.post("/saves", json={"text": URL})
    assert r.status_code == 401


async def test_post_saves_201_creates_pending_reel_and_job(client, make_user, jwt_for, db):
    uid = await make_user()
    r = await client.post("/saves", json={"text": f"look at this {URL}"},
                          headers=auth(jwt_for(uid)))
    assert r.status_code == 201
    body = r.json()
    assert body["deduped"] is False
    reel_id = uuid.UUID(body["reel_id"])
    reel = await db.fetchrow("select * from public.reels where id = $1", reel_id)
    assert reel["auth_user_id"] == uid and reel["status"] == "pending"
    assert await db.fetchval("select count(*) from public.jobs where payload->>'reel_id' = $1",
                             str(reel_id)) == 1


async def test_post_saves_200_on_duplicate_with_same_id(client, make_user, jwt_for):
    headers = auth(jwt_for(await make_user()))
    first = await client.post("/saves", json={"text": URL}, headers=headers)
    second = await client.post("/saves", json={"text": URL}, headers=headers)
    assert first.status_code == 201 and second.status_code == 200
    assert second.json()["reel_id"] == first.json()["reel_id"]
    assert second.json()["deduped"] is True


async def test_post_saves_422_when_no_instagram_link(client, make_user, jwt_for):
    r = await client.post("/saves", json={"text": "look at this"},
                          headers=auth(jwt_for(await make_user())))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "BAD_URL"


async def test_post_saves_accepts_share_link_and_igsh_params(client, make_user, jwt_for):
    headers = auth(jwt_for(await make_user()))
    for text in ("https://www.instagram.com/share/AbCd12",
                 "https://www.instagram.com/reel/C8xYz12/?igsh=abc123"):
        r = await client.post("/saves", json={"text": text}, headers=headers)
        assert r.status_code == 201, (text, r.text)


async def test_post_saves_429_quota(client, make_user, jwt_for, db):
    uid = await make_user()
    await db.execute("insert into public.profiles (id, saves_free_limit) values ($1, 1)", uid)
    headers = auth(jwt_for(uid))
    assert (await client.post("/saves", json={"text": reel_url("QA1")}, headers=headers)
            ).status_code == 201
    r = await client.post("/saves", json={"text": reel_url("QA2")}, headers=headers)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "QUOTA_EXCEEDED"


async def test_get_saves_only_returns_own_reels(client, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    await client.post("/saves", json={"text": reel_url("OWNA")}, headers=auth(jwt_for(a)))
    await client.post("/saves", json={"text": reel_url("OWNB")}, headers=auth(jwt_for(b)))
    r = await client.get("/saves", headers=auth(jwt_for(a)))
    assert r.status_code == 200
    assert [s["shortcode_key"] for s in r.json()] == ["OWNA"]


async def test_get_saves_keyset_pagination(client, make_user, jwt_for):
    headers = auth(jwt_for(await make_user()))
    for code in ("PG1", "PG2", "PG3"):
        await client.post("/saves", json={"text": reel_url(code)}, headers=headers)
    page1 = (await client.get("/saves", params={"limit": 2}, headers=headers)).json()
    assert [s["shortcode_key"] for s in page1] == ["PG3", "PG2"]
    page2 = (await client.get("/saves", params={"before": page1[1]["created_at"]},
                              headers=headers)).json()
    assert [s["shortcode_key"] for s in page2] == ["PG1"]


async def test_patch_note_404_for_other_users_reel(client, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    saved = await client.post("/saves", json={"text": URL}, headers=auth(jwt_for(a)))
    r = await client.patch(f"/saves/{saved.json()['reel_id']}", json={"note": "mine now"},
                           headers=auth(jwt_for(b)))
    assert r.status_code == 404
