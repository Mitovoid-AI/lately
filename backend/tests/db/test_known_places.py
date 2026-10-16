"""known_places(): the place names a user's cards mention, for the 📍 hint.

Cards built by STRUCTURE carry typed `entities`; only `place` entities (name,
parent, region) count, so "jeff nippard" or "robot" never shows as 📍. Cards
without typed entities (older seeds) fall back to `entity_names`.
"""

import json

import pytest

from app.search.run import known_places
from app.search.seed import seed_card

pytestmark = pytest.mark.db


def card(sc: str, names: list[str]) -> dict:
    return {"shortcode": sc, "title": sc, "category": "Food & Places", "entity_names": names,
            "tags": [], "likely_queries": []}


async def test_only_place_entities_count(db, make_user):
    uid = await make_user()
    await seed_card(db, uid, card("TYPED1", ["Jeff Nippard", "Majnu ka Tilla", "Delhi", "Boost"]),
                    None)
    await db.execute(
        "update public.reel_content set entities = $2::jsonb where shortcode = $1", "TYPED1",
        json.dumps([
            {"type": "person", "name": "Jeff Nippard"},
            {"type": "place", "name": "Majnu ka Tilla", "parent": "Delhi", "region": "Delhi",
             "country": "India"},
            {"type": "product", "name": "Boost"},
        ]))
    await seed_card(db, uid, card("LEGACY1", ["Palolem", "South Goa"]), None)

    assert set(await known_places(db, uid)) == {"Majnu ka Tilla", "Delhi", "Palolem", "South Goa"}


async def test_a_card_with_no_places_adds_none(db, make_user):
    uid = await make_user()
    await seed_card(db, uid, card("ROBOT1", ["robot", "mkbhd"]), None)
    await db.execute("update public.reel_content set entities = $2::jsonb where shortcode = $1",
                     "ROBOT1", json.dumps([{"type": "product", "name": "robot"},
                                           {"type": "person", "name": "mkbhd"}]))
    assert await known_places(db, uid) == []


async def test_other_users_places_are_not_seen(db, make_user):
    a, b = await make_user(), await make_user()
    await seed_card(db, b, card("GOA1", ["Goa"]), None)
    assert await known_places(db, a) == []
