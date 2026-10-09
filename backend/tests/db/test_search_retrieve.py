"""Hybrid retrieval over the 6 fixture cards (SEARCH.md §5)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.search.embed import FakeEmbedder
from app.search.query import parse_query
from app.search.retrieve import search
from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db

KNOWN_PLACES = sorted({p for c in CARDS.values() for p in c.get("entity_names") or []})


@dataclass
class Seeded:
    db: object
    user_a: UUID
    user_b: UUID
    code_of: dict[UUID, str]
    id_of: dict[str, UUID]
    b_manali: UUID


@pytest.fixture
async def seeded(db, make_user) -> Seeded:
    emb = FakeEmbedder()
    a, b = await make_user(), await make_user()
    code_of: dict[UUID, str] = {}
    for code, card in CARDS.items():
        code_of[await seed_card(db, a, card, emb)] = code
    b_manali = await seed_card(db, b, CARDS["MANALI1"] | {"note": "b's private note"}, emb)
    return Seeded(db, a, b, code_of, {v: k for k, v in code_of.items()}, b_manali)


async def _hits(s: Seeded, q: str, **kw):
    parsed = parse_query(q, now=datetime.now(UTC), known_places=KNOWN_PLACES)
    (vec,) = await FakeEmbedder().embed([parsed.text or "x"], "query")
    return await search(s.db, s.user_a, parsed, kw.pop("query_vec", vec), **kw)


async def _top(s: Seeded, q: str, k: int, **kw) -> list[str]:
    return [s.code_of.get(h.reel_id, "?") for h in (await _hits(s, q, **kw))[:k]]


async def test_keyword_finds_exact_place(seeded):
    assert await _top(seeded, "manali treks", 1) == ["MANALI1"]


async def test_fuzzy_finds_misspelling(seeded):
    assert "MANALI1" in await _top(seeded, "manaali", 3)


async def test_fuzzy_leg_alone_catches_misspelling(seeded):
    hits = await _hits(seeded, "manaali", legs=frozenset({"fuzzy"}))
    assert [seeded.code_of[h.reel_id] for h in hits][:1] == ["MANALI1"]
    assert hits[0].matched_by == ("fuzzy",)


async def test_visual_description_matches(seeded):
    assert await _top(seeded, "mountain reel", 1) == ["MANALI1"]


async def test_hinglish_likely_query_matches(seeded):
    assert await _top(seeded, "pahad wali reel", 1) == ["MANALI1"]


async def test_entity_parent_region_matches(seeded):
    assert await _top(seeded, "himachal trips", 1) == ["MANALI1"]


async def test_likely_query_exact_phrase(seeded):
    assert await _top(seeded, "repo for job search", 1) == ["JOBS1"]


async def test_note_match_ranks_first(seeded):
    assert await _top(seeded, "college friends", 1) == ["MANALI1"]


async def test_meaning_leg_alone_finds_card(seeded):
    vec = await seeded.db.fetchval(
        "select embedding::text from public.reels where id = $1", seeded.id_of["MANALI1"])
    floats = [float(x) for x in vec.strip("[]").split(",")]
    hits = await _hits(seeded, "something unrelated", query_vec=floats,
                       legs=frozenset({"meaning"}))
    assert seeded.code_of[hits[0].reel_id] == "MANALI1"
    assert hits[0].matched_by == ("meaning",)


async def test_search_scoped_to_user(seeded):
    hits = await _hits(seeded, "private note")
    ids = {h.reel_id for h in hits}
    assert seeded.b_manali not in ids
    assert ids <= set(seeded.code_of)


async def test_category_hard_filter(seeded):
    codes = await _top(seeded, "github", 30, category="Dev & Tools")
    assert codes and set(codes) <= {"GITHUB1", "JOBS1"}


async def test_saved_after_filter_excludes_older(seeded):
    await seeded.db.execute(
        "update public.reels set created_at = now() - interval '60 days' where id = $1",
        seeded.id_of["GOA1"])
    assert "GOA1" in await _top(seeded, "goa beaches", 5)
    assert "GOA1" not in await _top(seeded, "goa beaches last month", 30)


async def test_search_pending_reel_matches_on_note(db, make_user):
    uid = await make_user()
    rid = await db.fetchval(
        "select reel_id from public.save_reel($1, $2)", uid,
        "https://www.instagram.com/share/reel/abcDEF/")
    await db.execute("update public.reels set note = 'cafe to try' where id = $1", rid)
    parsed = parse_query("cafe", now=datetime.now(UTC), known_places=[])
    hits = await search(db, uid, parsed, None)
    assert [h.reel_id for h in hits] == [rid]


async def test_search_handles_symbols_and_emoji(seeded):
    hits = await _hits(seeded, 'c++ 🚀 "rooftop" -cafe')
    assert isinstance(hits, list)


async def test_empty_text_returns_empty_without_query(seeded):
    parsed = parse_query("last month", now=datetime.now(UTC), known_places=[])
    assert parsed.text == ""
    assert await search(None, seeded.user_a, parsed, None) == []  # type: ignore[arg-type]


async def test_hint_boost_breaks_ties_and_matched_by_is_ordered(seeded):
    hits = await _hits(seeded, "manali treks")
    assert hits[0].matched_by[0] == "keyword"
    assert hits == sorted(hits, key=lambda h: -h.score)
