from datetime import UTC, datetime, timedelta

import pytest

from app.search.query import ParsedQuery, normalize_query, parse_query

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize("raw,places,exp", [
    ("manali treks", {"Manali"},
     ParsedQuery("manali treks", place_hint="Manali", category_hint="Food & Places")),
    ("mountain reel", set(), ParsedQuery("mountain")),
    ("pahad wali reel", set(), ParsedQuery("pahad")),
    ("reel", set(), ParsedQuery("reel")),
    ("that momo cafe", set(), ParsedQuery("momo cafe", category_hint="Food & Places")),
    ("github tricks from june", set(), ParsedQuery(
        "github tricks", category_hint="Dev & Tools",
        saved_after=datetime(2026, 6, 1, tzinfo=UTC), saved_before=datetime(2026, 7, 1, tzinfo=UTC))),
    ("pasta recipe last week", set(), ParsedQuery(
        "pasta recipe", category_hint="Food & Places", saved_after=NOW - timedelta(days=7))),
    ("goa beach december", set(), ParsedQuery(
        "goa beach", category_hint="Food & Places",
        saved_after=datetime(2025, 12, 1, tzinfo=UTC), saved_before=datetime(2026, 1, 1, tzinfo=UTC))),
    ("things i may need", set(), ParsedQuery("things i may need")),
    ("", set(), ParsedQuery("")),
])
def test_parse_query(raw, places, exp):
    assert parse_query(raw, now=NOW, known_places=places) == exp


def test_normalize_collapses_whitespace_and_case():
    assert normalize_query("  Manali   TREK  video ") == "manali trek"


def test_date_phrases_today_yesterday_this_month():
    start = datetime(2026, 10, 3, tzinfo=UTC)
    assert parse_query("momos today", now=NOW, known_places=()).saved_after == start
    y = parse_query("momos yesterday", now=NOW, known_places=())
    assert (y.saved_after, y.saved_before) == (start - timedelta(days=1), start)
    assert parse_query("momos this month", now=NOW, known_places=()).saved_after == \
        datetime(2026, 10, 1, tzinfo=UTC)
    assert parse_query("momos last month", now=NOW, known_places=()).saved_after == \
        NOW - timedelta(days=30)


def test_may_only_counts_after_preposition():
    q = parse_query("pasta in may", now=NOW, known_places=())
    assert q.text == "pasta"
    assert (q.saved_after, q.saved_before) == (datetime(2026, 5, 1, tzinfo=UTC),
                                               datetime(2026, 6, 1, tzinfo=UTC))


def test_place_longest_whole_word_match():
    q = parse_query("south goa beaches", now=NOW, known_places={"Goa", "South Goa", "Go"})
    assert q.place_hint == "South Goa"
