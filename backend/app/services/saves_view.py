"""The app's `Save` / `SaveDetail` shapes (frontend/src/api/contract.ts) and the
one query that builds them, shared by /saves, /search, /stacks and /curated.

A save is the user's `reels` row joined to the shared `reel_content` card.
Every read here is scoped to `auth_user_id`, so callers pass the verified user.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote_plus
from uuid import UUID

import asyncpg
from pydantic import BaseModel

from ..config import settings

CATEGORIES = ("Dev & Tools", "Food & Places", "Career & Jobs", "Fitness", "Style & Vibes",
              "Watch Later")

# reels.source_channel predates the door names (0002 check: app | telegram | web);
# save_reel() maps app_share → app and meta_dm → telegram on the way in.
_CHANNEL_OUT = {"app": "app_share", "telegram": "meta_dm", "web": "web"}


class PlaceOut(BaseModel):
    name: str
    address: str
    maps_url: str | None = None


class SaveOut(BaseModel):
    id: UUID
    source_url: str
    shortcode: str | None
    status: Literal["pending", "enriched", "partial"]
    note: str | None
    created_at: datetime
    title: str | None
    caption: str | None
    category: str | None
    thumbnail_url: str | None
    creator: str | None
    channel: Literal["app_share", "web", "meta_dm"]


class SaveDetailOut(SaveOut):
    summary: str | None
    steps: list[str] | None
    tags: list[str] | None
    places: list[PlaceOut]
    media_status: Literal["pending", "partial", "ready", "failed"]


SAVE_COLUMNS = """
  r.id, r.source_url, coalesce(r.shortcode_key, r.shortcode) as shortcode, r.status, r.note,
  r.created_at, r.source_channel,
  coalesce(rc.thumbnail_path, r.thumbnail_path) as thumbnail_path,
  rc.title, rc.caption, rc.category, rc.creator_handle,
  rc.summary, rc.steps, rc.tags, rc.entities, coalesce(rc.media_status, 'pending') as media_status
"""

SAVE_FROM = """
from public.reels r
left join public.reel_content rc on rc.shortcode = r.shortcode_key
"""


def thumbnail_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith(("http://", "https://")):
        return path
    return f"{settings().supabase_url.rstrip('/')}/storage/v1/object/public/thumbnails/{path}"


def _steps(raw: Any) -> list[str] | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = json.loads(raw)
    if isinstance(raw, list):
        return [s if isinstance(s, str) else str(s.get("text", s)) for s in raw]
    return None


def _places(raw: Any) -> list[PlaceOut]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = json.loads(raw)
    out = []
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict) or e.get("type") != "place" or not e.get("name"):
            continue
        address = ", ".join(str(e[k]) for k in ("parent", "region", "country") if e.get(k))
        query = ", ".join(x for x in (e["name"], address) if x)
        out.append(PlaceOut(
            name=e["name"], address=address,
            maps_url=e.get("maps_url") or
            f"https://www.google.com/maps/search/?api=1&query={quote_plus(query)}"))
    return out


def to_save(row: asyncpg.Record | dict[str, Any]) -> SaveOut:
    category = row["category"] if row["category"] in CATEGORIES else None
    return SaveOut(
        id=row["id"], source_url=row["source_url"], shortcode=row["shortcode"],
        status=row["status"], note=row["note"], created_at=row["created_at"],
        title=row["title"], caption=row["caption"], category=category,
        thumbnail_url=thumbnail_url(row["thumbnail_path"]), creator=row["creator_handle"],
        channel=_CHANNEL_OUT.get(row["source_channel"], "app_share"))  # type: ignore[arg-type]


def to_save_detail(row: asyncpg.Record | dict[str, Any]) -> SaveDetailOut:
    base = to_save(row).model_dump()
    return SaveDetailOut(**base, summary=row["summary"], steps=_steps(row["steps"]),
                         tags=list(row["tags"]) if row["tags"] else None,
                         places=_places(row["entities"]), media_status=row["media_status"])


async def fetch_saves(db: asyncpg.Pool | asyncpg.Connection, user_id: UUID,
                      ids: Sequence[UUID]) -> list[SaveOut]:
    """Saves for `ids`, in the order given; ids the user doesn't own are dropped."""
    if not ids:
        return []
    rows = await db.fetch(
        f"select {SAVE_COLUMNS} {SAVE_FROM} where r.auth_user_id = $1 and r.id = any($2::uuid[])",
        user_id, list(ids))
    by_id = {r["id"]: to_save(r) for r in rows}
    return [by_id[i] for i in ids if i in by_id]


async def fetch_save_detail(db: asyncpg.Pool | asyncpg.Connection, user_id: UUID,
                            save_id: UUID) -> SaveDetailOut | None:
    row = await db.fetchrow(
        f"select {SAVE_COLUMNS} {SAVE_FROM} where r.auth_user_id = $1 and r.id = $2",
        user_id, save_id)
    return to_save_detail(row) if row else None
