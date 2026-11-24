"""Saves router — the CATCH path (PIPELINE.md §3) and per-user reads.

POST /saves is the only door entry point. It must stay ~100ms and never touch
Instagram or an AI API: extract URL → call save_reel() RPC (quota, dedup,
insert pending, enqueue) → return. That's the whole route.

Reads and edits return the app's `Save` / `SaveDetail` shapes
(services/saves_view.py), always scoped to the verified user.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime
from typing import Any

import asyncpg
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse

from ..config import settings
from ..deps import CurrentUser, pool
from ..enrich.device import hint_is_useful, sanitize_hint
from ..models import (
    CategoryCountOut,
    DeviceHintRequest,
    NoteRequest,
    SaveRequest,
    SaveResponse,
    api_error,
)
from ..services import jobs as jobs_service
from ..services.saves_view import (
    CATEGORIES,
    SAVE_COLUMNS,
    SAVE_FROM,
    TRUSTED_CARD,
    SaveDetailOut,
    SaveOut,
    fetch_save_detail,
    fetch_saves,
    to_save,
)
from ..urls import is_saveable_link, normalize_shared_text

log = logging.getLogger(__name__)

router = APIRouter(prefix="/saves", tags=["saves"])


def _not_found() -> HTTPException:
    return api_error(404, "NOT_FOUND", "Save not found.")


@router.post("", response_model=SaveResponse, status_code=201)
async def create_save(body: SaveRequest, user: CurrentUser) -> SaveResponse | JSONResponse:
    url = normalize_shared_text(body.text)
    if url is None:
        raise api_error(422, "BAD_URL", "No Instagram link found.")
    if not is_saveable_link(url):  # a profile, story, explore or audio page
        raise api_error(422, "BAD_URL", "That link isn't a reel or post.")

    try:
        try:
            # The status of a new save is `pending` (its row is not visible to this
            # statement's snapshot); a deduped save reports its existing row's.
            row = await pool().fetchrow(
                "select s.reel_id, s.deduped, coalesce("
                "(select r.status from public.reels r where r.id = s.reel_id), 'pending') as status "
                "from public.save_reel($1, $2, $3, $4, $5) s",
                uuid.UUID(user.id),
                body.text,
                body.channel,
                url,
                settings().rate_limit_per_hour,
            )
        except asyncpg.PostgresError as exc:
            mapped = jobs_service.map_rpc_error(exc)
            if isinstance(mapped, jobs_service.QuotaExceeded):
                raise api_error(429, "QUOTA_EXCEEDED", "Monthly save limit reached.") from exc
            if isinstance(mapped, jobs_service.RateLimited):
                raise api_error(429, "RATE_LIMITED", "Too many saves right now.") from exc
            if isinstance(mapped, jobs_service.BadUrl):
                raise api_error(422, "BAD_URL", "That link isn't a reel or post.") from exc
            raise
    except HTTPException:
        raise
    except Exception as exc:
        # Never echo the exception: it can carry SQL, hostnames or credentials.
        log.exception("save_reel failed for user %s", user.id)
        raise api_error(500, "SERVER", "Could not save right now. Try again.") from exc

    assert row is not None
    saved = SaveResponse(reel_id=row["reel_id"], deduped=bool(row["deduped"]),
                         status=row["status"])
    if saved.deduped:  # nothing was created: 200, not 201
        return JSONResponse(status_code=200, content=saved.model_dump(mode="json"))
    return saved


@router.get("", response_model=list[SaveOut])
async def list_saves(
    user: CurrentUser,
    before: datetime | None = None,
    limit: int = 25,
    category: str | None = None,
) -> list[SaveOut]:
    """Keyset-paginated list, newest first (`before` = created_at cursor)."""
    limit = max(1, min(limit, 100))
    rows = await pool().fetch(
        f"""
        select {SAVE_COLUMNS} {SAVE_FROM}
        where r.auth_user_id = $1
          and ($2::timestamptz is null or r.created_at < $2)
          and ($4::text is null or rc.category = $4)
        order by r.created_at desc
        limit $3
        """,
        uuid.UUID(user.id),
        before,
        limit,
        category,
    )
    return [to_save(r) for r in rows]


# Registered before /{save_id}, which would otherwise take "categories" as an id.
@router.get("/categories", response_model=list[CategoryCountOut])
async def list_categories(user: CurrentUser) -> list[CategoryCountOut]:
    """The user's categories with how many saves each has, most used first. Only
    the app's categories on cards trusted for this user (a save without one, or
    with someone else's device card, has no category)."""
    rows = await pool().fetch(
        f"""
        select rc.category, count(*) as n
        from public.reels r
        join public.reel_content rc on rc.shortcode = r.shortcode_key and {TRUSTED_CARD}
        where r.auth_user_id = $1 and rc.category = any($2::text[])
        group by rc.category
        order by n desc, rc.category
        """,
        uuid.UUID(user.id),
        list(CATEGORIES),
    )
    return [CategoryCountOut(category=r["category"], count=r["n"]) for r in rows]


@router.get("/{save_id}", response_model=SaveDetailOut)
async def get_save(save_id: uuid.UUID, user: CurrentUser) -> SaveDetailOut:
    detail = await fetch_save_detail(pool(), uuid.UUID(user.id), save_id)
    if detail is None:
        raise _not_found()
    return detail


@router.patch("/{save_id}", response_model=SaveOut)
async def set_note(save_id: uuid.UUID, body: NoteRequest, user: CurrentUser) -> SaveOut:
    """Attach (or clear, with a blank note) the "why?" note.

    The note is part of the save's embedding, so an enriched card gets an
    `embed` job (worker side: the enrichment workstream). A pending or partial
    save is embedded when its enrichment finishes, so it needs none.
    """
    uid = uuid.UUID(user.id)
    async with pool().acquire() as con, con.transaction():
        status = await con.fetchval(
            "update public.reels set note = $3 where id = $1 and auth_user_id = $2 "
            "returning status",
            save_id, uid, body.note or None)
        if status is None:
            raise _not_found()
        if status in ("enriched", "partial"):
            await con.execute(
                """
                insert into public.jobs (kind, payload, stage)
                select 'embed', jsonb_build_object('reel_id', $1::uuid), 'embed'
                where not exists (
                  select 1 from public.jobs
                  where kind = 'embed' and payload->>'reel_id' = $1::text
                    and locked_at is null)
                """,
                save_id)
        (save,) = await fetch_saves(con, uid, [save_id])
    return save


@router.delete("/{save_id}", status_code=204)
async def delete_save(save_id: uuid.UUID, user: CurrentUser) -> Response:
    """Delete the user's save. The shared card (reel_content) stays for others."""
    async with pool().acquire() as con, con.transaction():
        deleted = await con.fetchval(
            "delete from public.reels where id = $1 and auth_user_id = $2 returning id",
            save_id, uuid.UUID(user.id))
        if deleted is None:
            raise _not_found()
        # Queued (unclaimed) work for a save that no longer exists.
        await con.execute(
            "delete from public.jobs where payload->>'reel_id' = $1 and locked_at is null",
            str(save_id))
    return Response(status_code=204)


# --------------------------------------------------------------- device hint --

@router.post("/{save_id}/hint", status_code=202)
async def device_hint(save_id: uuid.UUID, body: DeviceHintRequest,
                      user: CurrentUser) -> dict[str, Any]:
    """The phone's own read of the reel's public embed page (PIPELINE.md §5
    FETCH "on-device data"). Stored on this user's save only; the worker's
    FETCH uses it first. Nothing shared is written here (§8 trust rule).

    A save that already ended `partial` is re-enqueued from FETCH so the hint
    gets used; a queued or running job reads the newest hint itself."""
    uid = uuid.UUID(user.id)
    hint = sanitize_hint(body.model_dump())
    useful = hint_is_useful(hint)
    async with pool().acquire() as con, con.transaction():
        reel = await con.fetchrow(
            "select status, shortcode_key from public.reels "
            "where id = $1 and auth_user_id = $2 for update",
            save_id, uid)
        if reel is None:
            raise _not_found()
        if not useful:
            return {"status": "ignored", "requeued": False}
        stored = {**hint, "shortcode": body.shortcode, "at": time.time()}
        await con.execute("update public.reels set device_hint = $2::jsonb where id = $1",
                          save_id, json.dumps(stored))
        requeued = False
        if reel["status"] == "partial" and not await con.fetchval(
            "select exists (select 1 from public.jobs "
            "where kind = 'enrich' and payload->>'reel_id' = $1)", str(save_id)):
            # Uses the save's retry budget; at the cap the hint is kept but not run now.
            requeued = await _requeue(con, save_id, uid, reel["shortcode_key"])
    return {"status": "accepted", "requeued": requeued}


# ------------------------------------------------------------------ retries --

retries_router = APIRouter(prefix="/retries", tags=["saves"])
RETRIES_PER_DAY = 3


async def _requeue(con: asyncpg.Connection, reel_id: uuid.UUID, uid: uuid.UUID,
                   shortcode_key: str | None) -> bool:
    """Enqueue enrichment again for a save (from FETCH; from RESOLVE when the
    shortcode was never resolved) and set it back to pending, if its retry
    budget allows: RETRIES_PER_DAY per rolling day, shared by POST /retries and
    the hint route. False (nothing changed) at the cap."""
    # Each retry re-runs fetch + LLM calls from shared provider budgets.
    allowed = await con.fetchval(
        f"""
        update public.reels set
          retry_count = case when retry_window_start > now() - interval '1 day'
                             then retry_count + 1 else 1 end,
          retry_window_start = case when retry_window_start > now() - interval '1 day'
                                    then retry_window_start else now() end
        where id = $1
          and not (retry_window_start > now() - interval '1 day'
                   and retry_count >= {RETRIES_PER_DAY})
        returning id
        """, reel_id)
    if allowed is None:
        return False
    stage = "fetch" if shortcode_key else "resolve"
    await jobs_service.enqueue_enrich(con, str(reel_id), str(uid), stage)
    await con.execute(
        "update public.reels set status = 'pending', fail_reason = null where id = $1", reel_id)
    return True


@retries_router.post("/{reel_id}", status_code=202)
async def retry_enrichment(reel_id: uuid.UUID, user: CurrentUser) -> dict[str, str]:
    """Re-enqueue enrichment for a partial save, or a pending one whose job
    died (PIPELINE.md §7: the retry button resumes from FETCH; a save whose
    shortcode was never resolved starts at RESOLVE). An enriched save has
    nothing to retry: 404.

    When the save already has a job, nothing new is queued and no retry is
    used: a job waiting (back-off, or parked) runs now, and so does one whose
    worker stopped heartbeating (the sweep's staleness rule); one a live
    worker holds answers {"status": "running"}."""
    uid = uuid.UUID(user.id)
    async with pool().acquire() as con, con.transaction():
        reel = await con.fetchrow(
            "select status, shortcode_key from public.reels "
            "where id = $1 and auth_user_id = $2 for update",
            reel_id, uid)
        if reel is None or reel["status"] == "enriched":
            raise api_error(404, "NOT_FOUND", "Nothing to retry for this save.")
        moved = await con.fetchval(
            """
            with moved as (
              update public.jobs
              set run_at = now(), locked_at = null, locked_by = null, heartbeat_at = null
              where kind = 'enrich' and payload->>'reel_id' = $1
                and (locked_at is null
                     or coalesce(heartbeat_at, locked_at) < now() - make_interval(mins => $2))
              returning 1)
            select count(*) from moved
            """, str(reel_id), settings().worker_stuck_after_minutes)
        if moved:
            return {"status": "queued"}
        if await con.fetchval(
                "select exists (select 1 from public.jobs "
                "where kind = 'enrich' and payload->>'reel_id' = $1)", str(reel_id)):
            return {"status": "running"}
        if not await _requeue(con, reel_id, uid, reel["shortcode_key"]):
            raise api_error(429, "RATE_LIMITED",
                            "Too many retries for this save. Try again tomorrow.")
    return {"status": "queued"}
