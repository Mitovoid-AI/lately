"""Saves router — the CATCH path (PIPELINE.md §3) and per-user reads.

POST /saves is the only door entry point. It must stay ~100ms and never touch
Instagram or an AI API: extract URL → call save_reel() RPC (quota, dedup,
insert pending, enqueue) → return. That's the whole route.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import asyncpg
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..config import settings
from ..deps import CurrentUser, pool
from ..models import NoteRequest, ReelOut, SaveRequest, SaveResponse
from ..services import jobs as jobs_service
from ..urls import normalize_shared_text

router = APIRouter(prefix="/saves", tags=["saves"])


@router.post("", response_model=SaveResponse, status_code=201)
async def create_save(body: SaveRequest, user: CurrentUser) -> SaveResponse | JSONResponse:
    url = normalize_shared_text(body.text)
    if url is None:
        raise HTTPException(
            422, {"error": {"code": "BAD_URL", "message": "No Instagram link found."}}
        )

    try:
        try:
            row = await pool().fetchrow(
                "select * from public.save_reel($1, $2, $3, $4, $5)",
                uuid.UUID(user.id),
                body.text,
                body.channel,
                url,
                settings().rate_limit_per_hour,
            )
        except asyncpg.PostgresError as exc:
            mapped = jobs_service.map_rpc_error(exc)
            if isinstance(mapped, jobs_service.QuotaExceeded):
                raise HTTPException(
                    429,
                    {"error": {"code": "QUOTA_EXCEEDED",
                               "message": "Monthly save limit reached."}},
                ) from exc
            if isinstance(mapped, jobs_service.RateLimited):
                raise HTTPException(
                    429,
                    {"error": {"code": "RATE_LIMITED",
                               "message": "Too many saves right now."}},
                ) from exc
            if isinstance(mapped, jobs_service.BadUrl):
                raise HTTPException(
                    422,
                    {"error": {"code": "BAD_URL",
                               "message": "No Instagram link found."}},
                ) from exc
            raise
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            500, {"error": {"code": "SAVE_FAILED", "message": str(exc)}}
        ) from exc

    assert row is not None
    saved = SaveResponse(reel_id=row["reel_id"], deduped=bool(row["deduped"]))
    if saved.deduped:  # nothing was created: 200, not 201
        return JSONResponse(status_code=200, content=saved.model_dump(mode="json"))
    return saved


@router.get("", response_model=list[ReelOut])
async def list_saves(
    user: CurrentUser,
    before: datetime | None = None,
    limit: int = 25,
) -> list[ReelOut]:
    """Keyset-paginated list, newest first (`before` = created_at cursor)."""
    limit = max(1, min(limit, 100))
    rows = await pool().fetch(
        """
        select id, auth_user_id, source_url, shortcode, shortcode_key,
               status, note, created_at
        from public.reels
        where auth_user_id = $1
          and ($2::timestamptz is null or created_at < $2)
        order by created_at desc
        limit $3
        """,
        uuid.UUID(user.id),
        before,
        limit,
    )
    return [ReelOut(**dict(r)) for r in rows]


@router.patch("/{reel_id}", response_model=ReelOut)
async def set_note(reel_id: uuid.UUID, body: NoteRequest, user: CurrentUser) -> ReelOut:
    """Attach the "why?" note after the save (skippable follow-up)."""
    row = await pool().fetchrow(
        """
        update public.reels
        set note = $2
        where id = $1 and auth_user_id = $3
        returning id, auth_user_id, source_url, shortcode, shortcode_key,
                  status, note, created_at
        """,
        reel_id,
        body.note,
        uuid.UUID(user.id),
    )
    if row is None:
        raise HTTPException(404, {"error": {"code": "NOT_FOUND",
                                            "message": "Save not found."}})
    return ReelOut(**dict(row))
