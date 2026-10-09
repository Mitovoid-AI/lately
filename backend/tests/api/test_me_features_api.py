"""/me extras: stacks_count, preferences, export request, account deletion."""

import pytest

from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db

DEFAULTS = {"reading_font": "newsreader", "text_size": 16, "theme": "light",
            "push_digests": True, "offline_reading": True}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_me_counts_stacks(client, make_auth_user, jwt_for):
    h = auth(jwt_for(await make_auth_user("stacker")))
    for name in ("a", "b"):
        await client.post("/stacks", json={"name": name}, headers=h)
    assert (await client.get("/me", headers=h)).json()["stacks_count"] == 2


# ---------------------------------------------------------------- preferences

async def test_preferences_default_then_partial_update(client, make_user, jwt_for):
    h = auth(jwt_for(await make_user()))
    r = await client.get("/me/preferences", headers=h)
    assert r.status_code == 200 and r.json() == DEFAULTS
    r = await client.patch("/me/preferences", json={"theme": "dark", "text_size": 18}, headers=h)
    assert r.status_code == 200
    assert r.json() == DEFAULTS | {"theme": "dark", "text_size": 18}
    r = await client.patch("/me/preferences", json={"push_digests": False}, headers=h)
    assert r.json() == DEFAULTS | {"theme": "dark", "text_size": 18, "push_digests": False}
    assert (await client.get("/me/preferences", headers=h)).json() == r.json()


@pytest.mark.parametrize("body", [
    {"theme": "sepia"}, {"text_size": 15}, {"text_size": "16"}, {"reading_font": "Inter"},
    {"push_digests": "yes"}, {"offline_reading": 1}, {"theme": None}, {"colour": "red"},
])
async def test_preferences_reject_values_outside_the_contract(client, make_user, jwt_for, body):
    h = auth(jwt_for(await make_user()))
    assert (await client.patch("/me/preferences", json=body, headers=h)).status_code == 422
    assert (await client.get("/me/preferences", headers=h)).json() == DEFAULTS


async def test_preferences_are_per_user(client, make_user, jwt_for):
    ha, hb = auth(jwt_for(await make_user())), auth(jwt_for(await make_user()))
    await client.patch("/me/preferences", json={"theme": "system"}, headers=ha)
    assert (await client.get("/me/preferences", headers=hb)).json() == DEFAULTS


async def test_preferences_401_without_token(client):
    assert (await client.get("/me/preferences")).status_code == 401
    assert (await client.patch("/me/preferences", json={"theme": "dark"})).status_code == 401


# --------------------------------------------------------------------- export

async def test_export_is_queued_once(client, db, make_user, jwt_for):
    uid = await make_user()
    h = auth(jwt_for(uid))
    for _ in range(2):
        r = await client.post("/me/export", headers=h)
        assert r.status_code == 202 and r.json() == {"status": "queued"}
    jobs = await db.fetch("select stage, payload->>'user_id' as uid from public.jobs "
                          "where kind = 'export'")
    assert [(j["stage"], j["uid"]) for j in jobs] == [("export", str(uid))]


async def test_export_401_without_token(client):
    assert (await client.post("/me/export")).status_code == 401


# ------------------------------------------------------------- delete account

async def test_delete_me_removes_everything_of_the_user_only(client, db, make_auth_user,
                                                              jwt_for):
    a, b = await make_auth_user("leaver"), await make_auth_user("stayer")
    ha = auth(jwt_for(a))
    mine = await seed_card(db, a, CARDS["MANALI1"], None)
    theirs = await seed_card(db, b, CARDS["MANALI1"], None)
    st = (await client.post("/stacks", json={"name": "x"}, headers=ha)).json()
    await client.post(f"/stacks/{st['id']}/saves", json={"save_id": str(mine)}, headers=ha)
    await client.patch("/me/preferences", json={"theme": "dark"}, headers=ha)
    await client.post("/saves", json={"text": "https://www.instagram.com/reel/LEAVE1/"},
                      headers=ha)
    await client.post("/me/export", headers=ha)

    r = await client.delete("/me", headers=ha)
    assert r.status_code == 204 and r.content == b""

    for sql in ("select count(*) from auth.users where id = $1",
                "select count(*) from public.profiles where id = $1",
                "select count(*) from public.reels where auth_user_id = $1",
                "select count(*) from public.stacks where auth_user_id = $1",
                "select count(*) from public.preferences where auth_user_id = $1",
                "select count(*) from public.jobs where payload->>'user_id' = $1::uuid::text"):
        assert await db.fetchval(sql, a) == 0, sql
    assert await db.fetchval("select count(*) from public.reels where id = $1", theirs) == 1
    assert await db.fetchval(
        "select count(*) from public.reel_content where shortcode = 'MANALI1'") == 1
    # the token still verifies, but the account is gone
    assert (await client.get("/me", headers=ha)).status_code == 404
    assert (await client.delete("/me", headers=ha)).status_code == 404


async def test_delete_me_401_without_token(client):
    assert (await client.delete("/me")).status_code == 401
