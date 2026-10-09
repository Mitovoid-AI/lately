"""Seed a finished card for a user (tests, the eval harness, demo data).

Writes the shared `reel_content` row, the user's `reels` row and, when an
embedder is given, the per-user embedding — the same shape FINALIZE produces.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any
from uuid import UUID

import asyncpg

from .embed import card_embedding_text, to_pgvector

if TYPE_CHECKING:
    from .embed import Embedder

_UPSERT_CONTENT = """
insert into public.reel_content
  (shortcode, source_url, caption, transcript, title, summary, category, tags,
   entity_names, likely_queries, visual_description, ocr_text, creator_handle,
   steps, thumbnail_path, media_status, fetched_at)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, 'ready', now())
on conflict (shortcode) do update set
  caption = excluded.caption, transcript = excluded.transcript, title = excluded.title,
  summary = excluded.summary, category = excluded.category, tags = excluded.tags,
  entity_names = excluded.entity_names, likely_queries = excluded.likely_queries,
  visual_description = excluded.visual_description, ocr_text = excluded.ocr_text,
  creator_handle = excluded.creator_handle, steps = excluded.steps,
  thumbnail_path = excluded.thumbnail_path, media_status = 'ready'
"""

_INSERT_REEL = """
insert into public.reels
  (auth_user_id, source_url, shortcode, shortcode_key, status, note, thumbnail_path,
   source_channel)
values ($1, $2, $3, $3, 'enriched', $4, $5, 'app')
returning id
"""


def reel_url(shortcode: str) -> str:
    return f"https://www.instagram.com/reel/{shortcode}/"


async def seed_card(db: asyncpg.Pool, user_id: UUID, card: Mapping[str, Any],
                    embedder: Embedder | None) -> UUID:
    sc = card["shortcode"]
    thumb = card.get("thumbnail_path", f"{sc}.jpg")
    await db.execute(
        _UPSERT_CONTENT, sc, reel_url(sc), card.get("caption"), card.get("transcript"),
        card.get("title"), card.get("summary"), card.get("category"), card.get("tags"),
        card.get("entity_names"), card.get("likely_queries"), card.get("visual_description"),
        card.get("ocr_text"), card.get("creator_handle"),
        json.dumps(card["steps"]) if card.get("steps") is not None else None, thumb)
    await db.execute("select public.refresh_search_columns($1)", sc)
    note = card.get("note")
    reel_id: UUID = await db.fetchval(_INSERT_REEL, user_id, reel_url(sc), sc, note, thumb)
    if embedder is not None:
        (vec,) = await embedder.embed([card_embedding_text(card, note)], "document")
        await db.execute("update public.reels set embedding = $2::vector where id = $1",
                         reel_id, to_pgvector(vec))
    return reel_id
