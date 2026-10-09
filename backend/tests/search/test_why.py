from app.search.query import ParsedQuery
from app.search.why import build_why

MANALI = {"entity_names": ["Hampta Pass", "Manali", "Himachal Pradesh"],
          "note": "do this with college friends"}


def test_place_and_note():
    parsed = ParsedQuery("manali college", place_hint="Manali")
    assert build_why(MANALI, parsed, ["keyword"]) == [
        "📍 Manali", 'your note: "do this with college friends"']


def test_meaning_only():
    parsed = ParsedQuery("mountain")
    assert build_why({"entity_names": [], "note": None}, parsed, ["meaning"]) == [
        "similar meaning"]


def test_no_signals():
    assert build_why({"entity_names": None, "note": "x"}, ParsedQuery("goa"), ["keyword"]) == []


def test_place_not_in_card_is_skipped():
    parsed = ParsedQuery("goa", place_hint="Goa")
    assert build_why(MANALI, parsed, ["keyword"]) == []


def test_short_tokens_do_not_match_note():
    assert build_why({"note": "do it"}, ParsedQuery("do it"), ["keyword"]) == []


def test_long_note_truncated_to_60_chars():
    note = "college " + "x" * 100
    (why,) = build_why({"note": note}, ParsedQuery("college"), ["keyword"])
    inner = why.removeprefix('your note: "').removesuffix('"')
    assert len(inner) == 60 and inner.endswith("…")
    assert inner.startswith("college x")


def test_at_most_two_items():
    parsed = ParsedQuery("manali college", place_hint="Manali")
    assert len(build_why(MANALI, parsed, ["keyword", "meaning"])) == 2
