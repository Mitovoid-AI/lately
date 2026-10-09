"""GET /curated — contract CuratedFeed built from the user's own saves (no LLM)."""

import pytest

from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db


def auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _seed_all(db, uid):
    ids = {}
    for i, code in enumerate(("MANALI1", "MOMO1", "GITHUB1", "JOBS1", "PASTA1", "GOA1")):
        ids[code] = await seed_card(db, uid, CARDS[code], None)
        # oldest first, one hour apart, so the order is deterministic
        await db.execute("update public.reels set created_at = now() - make_interval(hours => $2) "
                         "where id = $1", ids[code], 10 - i)
    return ids


def _titles(feed):
    return [s["title"] for s in feed["sections"]]


async def test_empty_account_gets_an_empty_feed(client, make_user, jwt_for):
    r = await client.get("/curated", headers=auth(jwt_for(await make_user())))
    assert r.status_code == 200
    feed = r.json()
    assert set(feed) == {"date_label", "hero", "sections"}
    assert set(feed["hero"]) == {"label", "title", "subtitle", "image_url", "save_ids", "query"}
    assert feed["hero"]["save_ids"] == [] and feed["hero"]["query"] == ""
    assert feed["sections"] == [] and feed["date_label"]


async def test_feed_hero_is_the_biggest_category_cluster(client, db, make_user, jwt_for):
    uid = await make_user()
    ids = await _seed_all(db, uid)
    feed = (await client.get("/curated", headers=auth(jwt_for(uid)))).json()
    hero = feed["hero"]
    assert hero["query"] == "Food & Places"
    assert hero["save_ids"] == [str(ids[c]) for c in ("GOA1", "PASTA1", "MOMO1", "MANALI1")]
    assert hero["image_url"].endswith("GOA1.jpg")
    assert "4" in hero["title"]

    sections = {s["title"]: s for s in feed["sections"]}
    assert _titles(feed)[0] == "Recently saved"
    assert [s["id"] for s in sections["Recently saved"]["saves"]][:2] == [
        str(ids["GOA1"]), str(ids["PASTA1"])]
    no_note = sections["No note yet"]
    assert no_note["kind"] == "list"
    assert {s["id"] for s in no_note["saves"]} == {str(ids[c]) for c in ("MOMO1", "JOBS1", "PASTA1")}
    assert [t for t in _titles(feed) if t.startswith("Revisit")] == [
        "Revisit · Food & Places", "Revisit · Career & Jobs", "Revisit · Dev & Tools"]
    for s in feed["sections"]:
        assert s["kind"] in ("row", "list") and all(x["status"] for x in s["saves"])


async def test_a_shared_tag_beats_a_category(client, db, make_user, jwt_for):
    uid = await make_user()
    await _seed_all(db, uid)
    await seed_card(db, uid, CARDS["MANALI1"] | {"shortcode": "TREK2", "category": "Fitness",
                                                  "title": "Triund in a day",
                                                  "tags": ["trek", "day hike"]}, None)
    hero = (await client.get("/curated", headers=auth(jwt_for(uid)))).json()["hero"]
    assert hero["query"] == "trek" and len(hero["save_ids"]) == 2


async def test_old_saves_show_as_forgotten_gems(client, db, make_user, jwt_for):
    uid = await make_user()
    ids = await _seed_all(db, uid)
    await db.execute("update public.reels set created_at = now() - interval '45 days' "
                     "where id = $1", ids["JOBS1"])
    feed = (await client.get("/curated", headers=auth(jwt_for(uid)))).json()
    gems = next(s for s in feed["sections"] if s["title"] == "Forgotten gems")
    assert [s["id"] for s in gems["saves"]] == [str(ids["JOBS1"])]


async def test_pending_only_account_still_gets_a_feed(client, make_user, jwt_for):
    h = auth(jwt_for(await make_user()))
    await client.post("/saves", json={"text": "https://www.instagram.com/reel/NEW1/"}, headers=h)
    feed = (await client.get("/curated", headers=h)).json()
    assert _titles(feed) == ["Recently saved"]
    assert len(feed["hero"]["save_ids"]) == 1


async def test_feed_only_uses_own_saves(client, db, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    await _seed_all(db, a)
    feed = (await client.get("/curated", headers=auth(jwt_for(b)))).json()
    assert feed["hero"]["save_ids"] == [] and feed["sections"] == []


async def test_curated_401_without_token(client):
    assert (await client.get("/curated")).status_code == 401
