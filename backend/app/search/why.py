"""Why it matched" (SEARCH.md §7): at most two short reasons per result."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .query import ParsedQuery

_NOTE_MAX = 60


def _clip(text: str) -> str:
    return text if len(text) <= _NOTE_MAX else text[: _NOTE_MAX - 1] + "…"


def build_why(card: Mapping[str, Any], parsed: ParsedQuery,
              matched_by: Sequence[str]) -> list[str]:
    """In order: the guessed place if the card names it, the user's note if a
    query word (3+ chars) is in it, otherwise "similar meaning" when the
    meaning leg matched. Capped at 2."""
    why: list[str] = []
    entities = [e.lower() for e in card.get("entity_names") or []]
    if parsed.place_hint and parsed.place_hint.lower() in entities:
        why.append(f"📍 {parsed.place_hint}")

    note = card.get("note") or ""
    tokens = [t for t in parsed.text.split() if len(t) >= 3]
    if note and any(t in note.lower() for t in tokens):
        why.append(f'your note: "{_clip(note)}"')
    elif "meaning" in matched_by:
        why.append("similar meaning")
    return why[:2]
