"""prune_meaning(): meaning-only hits far from the query's best match are dropped.

The meaning leg ranks every save by distance, so without a cutoff every query
returned 10 results, the tail unrelated ("exoplanet" → a folding phone). Live
distances on 23 real reels (text-embedding-3-small): the expected reel was at
0.26–0.77, unrelated reels at a median of 0.82–0.93. In a library of one or two reels
the best match is itself unrelated, so the ceiling does the work there: re-measured
2026-10-18, "cafe" was 0.82 from an AI video editor reel and "car repair", "learn
spanish", "stock market tips" 0.79–0.84 from their nearest reel; settings use 0.78.
"""

from datetime import UTC, datetime
from uuid import uuid4

from app.search.retrieve import LegRow, prune_meaning

NOW = datetime.now(UTC)


def row(leg: str, rank: int, distance: float | None = None, rid=None) -> LegRow:
    return LegRow(rid or uuid4(), leg, rank, NOW, None, (), distance)


def test_far_meaning_only_rows_are_dropped():
    best, near, far = row("meaning", 1, 0.36), row("meaning", 2, 0.55), row("meaning", 3, 0.69)
    kept = prune_meaning([best, near, far], spread=0.25, max_distance=0.85)
    assert kept == [best, near]


def test_absolute_ceiling_applies_when_the_best_match_is_weak():
    best, mid, far = row("meaning", 1, 0.77), row("meaning", 2, 0.84), row("meaning", 3, 0.86)
    assert prune_meaning([best, mid, far], spread=0.25, max_distance=0.85) == [best, mid]


def test_a_reel_matched_by_keyword_or_fuzzy_keeps_its_meaning_row():
    rid = uuid4()
    kw, far = row("keyword", 1, rid=rid), row("meaning", 5, 0.95, rid=rid)
    best = row("meaning", 1, 0.30)
    assert prune_meaning([kw, best, far], spread=0.25, max_distance=0.85) == [kw, best, far]


def test_lexical_rows_and_rows_without_distance_pass_through():
    rows = [row("keyword", 1), row("fuzzy", 1), row("meaning", 1, None)]
    assert prune_meaning(rows, spread=0.25, max_distance=0.85) == rows


def test_disabled_when_settings_are_none():
    rows = [row("meaning", 1, 0.2), row("meaning", 2, 0.99)]
    assert prune_meaning(rows, spread=None, max_distance=None) == rows


def test_a_lone_unrelated_reel_is_not_offered_as_similar_meaning():
    # Library of one: "cafe" against an AI video editor reel (measured 0.823).
    from app.config import settings

    lone = row("meaning", 1, 0.823)
    kept = prune_meaning([lone], spread=settings().search_meaning_spread,
                         max_distance=settings().search_meaning_max_distance)
    assert kept == []


def test_the_weakest_expected_match_still_passes_the_default_ceiling():
    # "biryni" (a typo) was the farthest expected reel in queries.tsv, at 0.769.
    from app.config import settings

    weakest = row("meaning", 1, 0.769)
    assert prune_meaning([weakest], spread=settings().search_meaning_spread,
                         max_distance=settings().search_meaning_max_distance) == [weakest]
