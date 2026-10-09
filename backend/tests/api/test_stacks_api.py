"""/stacks — contract Stack / StackDetail, scoped to the signed-in user."""

import uuid

import pytest

from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db

STACK_KEYS = {"id", "name", "category", "save_count", "updated_at", "cover_urls"}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _stack(client, headers, name="Trips"):
    r = await client.post("/stacks", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_and_list_stacks(client, make_user, jwt_for):
    h = auth(jwt_for(await make_user()))
    created = await _stack(client, h, "  Trips  ")
    assert set(created) == STACK_KEYS
    assert created["name"] == "Trips" and created["save_count"] == 0
    assert created["category"] is None and created["cover_urls"] == []
    second = await _stack(client, h, "Code")
    r = await client.get("/stacks", headers=h)
    assert r.status_code == 200
    assert [s["id"] for s in r.json()] == [second["id"], created["id"]]  # newest change first


async def test_create_stack_rejects_blank_name(client, make_user, jwt_for):
    r = await client.post("/stacks", json={"name": "   "}, headers=auth(jwt_for(await make_user())))
    assert r.status_code == 422


async def test_add_saves_is_idempotent_and_shapes_the_stack(client, db, make_user, jwt_for):
    a = await make_user()
    h = auth(jwt_for(a))
    st = await _stack(client, h)
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    g = await seed_card(db, a, CARDS["GOA1"], None)
    code = await seed_card(db, a, CARDS["GITHUB1"], None)
    for sid in (m, g, code, g):  # g twice: no duplicate
        r = await client.post(f"/stacks/{st['id']}/saves", json={"save_id": str(sid)}, headers=h)
        assert r.status_code == 204
    r = await client.get(f"/stacks/{st['id']}", headers=h)
    assert r.status_code == 200
    d = r.json()
    assert set(d) == STACK_KEYS | {"saves"}
    assert d["save_count"] == 3
    assert d["category"] == "Food & Places"  # 2 of 3
    assert [s["id"] for s in d["saves"]] == [str(code), str(g), str(m)]  # newest added first
    assert len(d["cover_urls"]) == 3 and d["cover_urls"][0].endswith("GITHUB1.jpg")
    assert d["updated_at"] > st["updated_at"]


async def test_cover_urls_cap_at_four(client, db, make_user, jwt_for):
    a = await make_user()
    h = auth(jwt_for(a))
    st = await _stack(client, h)
    for code in ("MANALI1", "MOMO1", "GITHUB1", "JOBS1", "PASTA1"):
        sid = await seed_card(db, a, CARDS[code], None)
        await client.post(f"/stacks/{st['id']}/saves", json={"save_id": str(sid)}, headers=h)
    (listed,) = (await client.get("/stacks", headers=h)).json()
    assert listed["save_count"] == 5 and len(listed["cover_urls"]) == 4


async def test_remove_save_and_delete_stack(client, db, make_user, jwt_for):
    a = await make_user()
    h = auth(jwt_for(a))
    st = await _stack(client, h)
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    await client.post(f"/stacks/{st['id']}/saves", json={"save_id": str(m)}, headers=h)
    r = await client.delete(f"/stacks/{st['id']}/saves/{m}", headers=h)
    assert r.status_code == 204
    assert (await client.get(f"/stacks/{st['id']}", headers=h)).json()["save_count"] == 0
    assert (await client.delete(f"/stacks/{st['id']}", headers=h)).status_code == 204
    assert (await client.get(f"/stacks/{st['id']}", headers=h)).status_code == 404
    assert await db.fetchval("select count(*) from public.reels where id = $1", m) == 1


async def test_deleted_save_leaves_the_stack(client, db, make_user, jwt_for):
    a = await make_user()
    h = auth(jwt_for(a))
    st = await _stack(client, h)
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    await client.post(f"/stacks/{st['id']}/saves", json={"save_id": str(m)}, headers=h)
    await client.delete(f"/saves/{m}", headers=h)
    assert (await client.get(f"/stacks/{st['id']}", headers=h)).json()["saves"] == []


async def test_stacks_are_private(client, db, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    ha, hb = auth(jwt_for(a)), auth(jwt_for(b))
    st = await _stack(client, ha)
    mine = await seed_card(db, a, CARDS["MANALI1"], None)
    theirs = await seed_card(db, b, CARDS["GOA1"], None)
    assert (await client.get("/stacks", headers=hb)).json() == []
    sid = st["id"]
    for method, path, body in (
        ("GET", f"/stacks/{sid}", None),
        ("POST", f"/stacks/{sid}/saves", {"save_id": str(theirs)}),
        ("DELETE", f"/stacks/{sid}/saves/{theirs}", None),
        ("DELETE", f"/stacks/{sid}", None),
        ("GET", f"/stacks/{uuid.uuid4()}", None),
    ):
        r = await client.request(method, path, json=body, headers=hb)
        assert r.status_code == 404, (method, path)
        assert r.json()["error"]["code"] == "NOT_FOUND"
    # a's own stack cannot take b's save
    r = await client.post(f"/stacks/{sid}/saves", json={"save_id": str(theirs)}, headers=ha)
    assert r.status_code == 404
    assert (await client.post(f"/stacks/{sid}/saves", json={"save_id": str(mine)},
                              headers=ha)).status_code == 204


async def test_stacks_401_without_token(client):
    sid, save = uuid.uuid4(), uuid.uuid4()
    for method, path, body in (
        ("GET", "/stacks", None),
        ("POST", "/stacks", {"name": "x"}),
        ("GET", f"/stacks/{sid}", None),
        ("POST", f"/stacks/{sid}/saves", {"save_id": str(save)}),
        ("DELETE", f"/stacks/{sid}/saves/{save}", None),
        ("DELETE", f"/stacks/{sid}", None),
    ):
        assert (await client.request(method, path, json=body)).status_code == 401, path
