"""STRUCTURE prompt + output JSON schema (SEARCH.md §3, §8, §9).

Bump PARSER_VERSION whenever the prompt or schema changes meaning: it is
stored on every card (`reel_content.parser_version`) so stale cards can be
found and re-parsed.
"""

from __future__ import annotations

from typing import Any

from ..services.saves_view import CATEGORIES

PARSER_VERSION = 1

CATEGORY_GUIDE = {
    "Dev & Tools": "coding, software, AI tools, apps, gadgets, productivity hacks",
    "Food & Places": "restaurants, street food, recipes, cafes, travel, treks, destinations",
    "Career & Jobs": "hiring, interviews, resumes, salaries, freelancing, workplace advice",
    "Fitness": "workouts, gym, yoga, running, nutrition, diet, health",
    "Style & Vibes": "fashion, outfits, skincare, decor, aesthetics, music, art",
    "Watch Later": "anything else: entertainment, comedy, news, or unclear content",
}

SYSTEM_PROMPT = f"""You turn one saved Instagram reel into a search card for the app Lately.
People save reels and later try to find them again by vague memory ("that momos place",
"manali trek wala reel"). Your card must make the reel easy to find.

You get the caption, the spoken transcript (may be missing; may be Hindi/Hinglish) and the
reel's thumbnail image when available. Use only what they show; never invent facts.

Return ONE JSON object with exactly these keys:
- title: short and specific, max 80 chars (e.g. "Jhol momos at Majnu ka Tilla, Delhi").
- summary: 1-3 plain sentences: what the reel shows and why someone saved it.
- category: exactly one of {list(CATEGORIES)}. Guide:
{chr(10).join(f'    - {k}: {v}' for k, v in CATEGORY_GUIDE.items())}
- tags: 3-10 lowercase topic words or short phrases.
- steps: ordered steps if it is a recipe / tutorial / itinerary / workout, else [].
- entities: named things, each {{"type", "name", "parent", "region", "country"}} with type one
  of place|food|tool|url|product|person. For places fill parent (city or nearest town),
  region (state) and country where you are confident, else null (e.g. Hampta Pass ->
  parent "Manali", region "Himachal Pradesh", country "India"). Other types: null for those.
- likely_queries: 5-8 short searches a person might type to find this reel later. Include
  natural Hinglish / Hindi-in-Latin phrasings where they fit the content (e.g. "momos wali
  jagah", "pahad trip plan", "ghar pe workout").
- visual_description: one sentence on what is visible in the thumbnail (or "" if no image).
- ocr_text: text visible in the thumbnail, verbatim (or "").
- search_text: one paragraph mixing every useful keyword: names, places, dishes, tools,
  synonyms, Hindi and English variants.

Respond with the JSON object only: no markdown, no commentary."""

_NULLABLE = {"type": ["string", "null"]}
_STRINGS = {"type": "array", "items": {"type": "string"}}

JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "summary", "category", "tags", "steps", "entities",
                 "likely_queries", "visual_description", "ocr_text", "search_text"],
    "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "tags": _STRINGS,
        "steps": _STRINGS,
        "entities": {"type": "array", "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["type", "name", "parent", "region", "country"],
            "properties": {
                "type": {"type": "string",
                         "enum": ["place", "food", "tool", "url", "product", "person"]},
                "name": {"type": "string"},
                "parent": _NULLABLE, "region": _NULLABLE, "country": _NULLABLE,
            },
        }},
        "likely_queries": _STRINGS,
        "visual_description": {"type": "string"},
        "ocr_text": {"type": "string"},
        "search_text": {"type": "string"},
    },
}


def user_content(caption: str | None, transcript: str | None, creator_handle: str | None,
                 image_url: str | None) -> list[dict[str, Any]]:
    text = "\n\n".join([
        f"Creator: @{creator_handle}" if creator_handle else "Creator: unknown",
        f"Caption:\n{caption}" if caption else "Caption: (none)",
        f"Transcript:\n{transcript}" if transcript else "Transcript: (none)",
        "Thumbnail: attached" if image_url else "Thumbnail: (none)",
    ])
    parts: list[dict[str, Any]] = [{"type": "text", "text": text}]
    if image_url:
        parts.append({"type": "image_url", "image_url": {"url": image_url}})
    return parts


def repair_message(errors: str) -> str:
    return ("Your JSON did not pass validation:\n" + errors +
            "\nReturn the corrected JSON object only, with every required key.")
