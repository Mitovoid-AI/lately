"""The app's `Save` / `SaveDetail` shapes (frontend/src/api/contract.ts) and the
one query that builds them, shared by /saves, /search, /stacks and /curated.

A save is the user's `reels` row joined to the shared `reel_content` card.
Every read here is scoped to `auth_user_id`, so callers pass the verified user.
A card built from another user's device hint is not joined (TRUSTED_CARD): that
save reads as if no card existed yet.
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
from . import thumbnails

CATEGORIES = ("Dev & Tools", "Food & Places", "Career & Jobs", "Fitness", "Style & Vibes",
              "Watch Later")

# The stages of the enrich job (worker/stages.py), in the order a save goes through them. Anything
# else on a job row (a newer worker's stage) is not shown: the app only knows these names.
ENRICH_STAGES = ("resolve", "fetch", "transcribe", "vision", "structure", "finalize")

# reels.source_channel predates the door names (0002 check: app | telegram | web);
# save_reel() maps app_share → app and meta_dm → telegram on the way in.
_CHANNEL_OUT = {"app": "app_share", "telegram": "meta_dm", "web": "web"}

# reels.fail_reason (migration 0014 check constraint).
FailReason = Literal["fetch_blocked", "unavailable", "ai_unavailable", "timed_out"]


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
    # Where the enrich job is right now, for a pending save only (null once it is done, or when
    # no job is queued). The app shows it as the named step of its progress tracker.
    stage: str | None = None
    # Why a partial card could not be completed (written by the worker); null unless partial.
    fail_reason: FailReason | None = None


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
  rc.summary, rc.steps, rc.tags, rc.entities, coalesce(rc.media_status, 'pending') as media_status,
  case when r.status = 'pending' then (
    select j.stage from public.jobs j
    where j.kind = 'enrich' and j.payload->>'reel_id' = r.id::text
    order by j.created_at desc limit 1) end as job_stage,
  case when r.status = 'partial' then r.fail_reason end as fail_reason
"""

# Is shared content `rc` trusted for save `r`? The worker's rule (worker/stages.py
# _TRUSTED_FOR_SAVE): server-fetched, or device-sourced by this save's own user.
TRUSTED_CARD = ("(rc.fetch_source is distinct from 'device' "
                "or rc.device_user_id = r.auth_user_id)")

SAVE_FROM = f"""
from public.reels r
left join public.reel_content rc on rc.shortcode = r.shortcode_key and {TRUSTED_CARD}
"""


def thumbnail_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith(("http://", "https://")):
        return path
    if thumbnails.is_local(path):
        return thumbnails.local_url(path)
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
    stage = row.get("job_stage")
    return SaveOut(
        id=row["id"], source_url=row["source_url"], shortcode=row["shortcode"],
        status=row["status"], note=row["note"], created_at=row["created_at"],
        title=row["title"], caption=row["caption"], category=category,
        thumbnail_url=thumbnail_url(row["thumbnail_path"]), creator=row["creator_handle"],
        channel=_CHANNEL_OUT.get(row["source_channel"], "app_share"),  # type: ignore[arg-type]
        stage=stage if row["status"] == "pending" and stage in ENRICH_STAGES else None,
        fail_reason=row.get("fail_reason") if row["status"] == "partial" else None)


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
