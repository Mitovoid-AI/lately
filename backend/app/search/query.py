"""Query normalisation and the rule parser (SEARCH.md §5 steps 1–2).

Rules only, no LLM. Date phrases become hard filters and are removed from the
text. Guessed category and place are hints that boost results; they are never
filters, so a wrong guess can't hide the right reel.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class ParsedQuery:
    text: str                          # normalized; used by keyword, fuzzy, embedding
    place_hint: str | None = None      # original casing from known_places
    category_hint: str | None = None   # one of the seeded categories
    saved_after: datetime | None = None
    saved_before: datetime | None = None


_NOISE = "reel reels video videos post posts saved save that wo woh jo wahi wala wali waala waali vala vali ki ka ke"
NOISE_WORDS: frozenset[str] = frozenset(_NOISE.split())

_CATEGORY_GROUPS: dict[str, str] = {
    "Food & Places": "recipe food cafe restaurant momo momos place trip travel trek beach",
    "Dev & Tools": "github code coding tool tools dev repo ai",
    "Career & Jobs": "job jobs resume interview career visa",
    "Fitness": "workout gym fitness exercise diet",
    "Style & Vibes": "outfit style fashion aesthetic",
}
CATEGORY_WORDS: dict[str, str] = {
    word: category for category, words in _CATEGORY_GROUPS.items() for word in words.split()
}

_MONTHS: dict[str, int] = {}
_MONTH_NAMES = "january february march april may june july august september october november december"
for _i, _name in enumerate(_MONTH_NAMES.split(), start=1):
    _MONTHS[_name] = _i
    _MONTHS[_name[:3]] = _i
_MONTHS["sept"] = 9

_PREP = r"(?:\b(?:from|in|since)\s+)"
_DATE_RE = re.compile(
    rf"(?P<prep>{_PREP})?\b(?P<phrase>today|yesterday|last week|last month|this month|"
    rf"{'|'.join(sorted(_MONTHS, key=len, reverse=True))})\b"
)
_WS = re.compile(r"\s+")


def _drop_noise(text: str) -> str:
    kept = [t for t in text.split() if t not in NOISE_WORDS]
    return " ".join(kept) if kept else text


def normalize_query(raw: str) -> str:
    """Lowercase, collapse whitespace, drop noise words. If only noise is left,
    the lowercased, trimmed input is kept (so `reel` still searches for something)."""
    return _drop_noise(_WS.sub(" ", raw.lower()).strip())


def _month_range(month: int, now: datetime) -> tuple[datetime, datetime]:
    year = now.year if month <= now.month else now.year - 1
    start = datetime(year, month, 1, tzinfo=now.tzinfo)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=now.tzinfo)
    return start, end


def _date_window(phrase: str, now: datetime) -> tuple[datetime | None, datetime | None]:
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if phrase == "today":
        return today, None
    if phrase == "yesterday":
        return today - timedelta(days=1), today
    if phrase == "last week":
        return now - timedelta(days=7), None
    if phrase == "last month":
        return now - timedelta(days=30), None
    if phrase == "this month":
        return today.replace(day=1), None
    return _month_range(_MONTHS[phrase], now)


def parse_query(raw: str, *, now: datetime, known_places: Iterable[str]) -> ParsedQuery:
    text = _WS.sub(" ", raw.lower()).strip()

    saved_after: datetime | None = None
    saved_before: datetime | None = None
    for m in _DATE_RE.finditer(text):
        phrase = m["phrase"]
        if phrase == "may" and not m["prep"]:
            continue  # "things i may need" is not a date
        saved_after, saved_before = _date_window(phrase, now)
        text = _WS.sub(" ", (text[: m.start()] + " " + text[m.end():])).strip()
        break

    text = _drop_noise(text)

    category_hint = None
    for token in text.split():
        category_hint = CATEGORY_WORDS.get(token) or (
            CATEGORY_WORDS.get(token[:-1]) if token.endswith("s") else None)
        if category_hint:
            break

    place_hint = None
    for place in sorted(known_places, key=len, reverse=True):
        if place and re.search(rf"(?<!\w){re.escape(place.lower())}(?!\w)", text):
            place_hint = place
            break

    return ParsedQuery(text, place_hint, category_hint, saved_after, saved_before)
