"""GET /me: the signed-in user's profile, quota and linked sign-in methods."""

import pytest

pytestmark = pytest.mark.db


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def reel_url(code):
    return f"https://www.instagram.com/reel/{code}/"


async def test_me_401_without_token(client):
    assert (await client.get("/me")).status_code == 401


async def test_me_returns_the_profile_and_quota(client, make_auth_user, jwt_for):
    uid = await make_auth_user(
        "me.user", meta={"full_name": "Me User", "avatar_url": "https://lh3.example/m.png"}
    )
    headers = auth(jwt_for(uid))
    for code in ("ME1", "ME2"):
        assert (
            await client.post("/saves", json={"text": reel_url(code)}, headers=headers)
        ).status_code == 201

    r = await client.get("/me", headers=headers)
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["id"] == str(uid)
    assert me["email"].startswith("me.user@")
    assert me["name"] == "Me User"
    assert me["handle"] == "me.user"
    assert me["avatar_url"] == "https://lh3.example/m.png"
    assert me["plan"] == "free"
    assert me["saves_this_month"] == 2 and me["total_saves"] == 2
    assert me["saves_limit"] == 20
    assert len(me["resets_on"]) == 10 and len(me["member_since"]) == 10  # ISO dates
    assert me["stacks_count"] == 0
    assert me["connected_accounts"] == []


async def test_me_falls_back_to_the_handle_when_there_is_no_name(client, make_auth_user, jwt_for):
    uid = await make_auth_user("nameless")
    me = (await client.get("/me", headers=auth(jwt_for(uid)))).json()
    assert me["name"] == "nameless" and me["handle"] == "nameless"


async def test_me_rebuilds_a_missing_profile(client, db, make_auth_user, jwt_for):
    uid = await make_auth_user("rebuilt")
    await db.execute("delete from public.profiles where id = $1", uid)
    r = await client.get("/me", headers=auth(jwt_for(uid)))
    assert r.status_code == 200 and r.json()["handle"] == "rebuilt"


async def test_me_404_when_the_account_is_gone(client, db, make_auth_user, jwt_for):
    uid = await make_auth_user("ghost")
    await db.execute("delete from auth.users where id = $1", uid)
    r = await client.get("/me", headers=auth(jwt_for(uid)))
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"
