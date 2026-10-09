"""Shared fixture data: the 6 seeded cards (Phase 1 plan, 'Shared test fixture')."""

import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent
CARDS: dict[str, dict] = {
    c["shortcode"]: c for c in json.loads((FIXTURES / "cards.json").read_text(encoding="utf-8"))
}
