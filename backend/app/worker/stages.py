"""Worker stages (Part 1: RESOLVE real, the rest registered stubs).

Each stage is `async def(db: asyncpg.Pool, job) -> next_stage | None`:
- return the next stage name to advance to, or
- raise to trigger retry/backoff (handled by the loop), or
- return None when the job is complete.
Stages query through the pool (one connection per query, never held across an
external call) and may update `job["payload"]`; the loop persists it.

Stages per PIPELINE.md §5: resolve → fetch → transcribe → vision → structure →
finalize. Parts 2–3 replace the stubs; the loop never changes.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import asyncpg
import httpx

from ..urls import is_share_link, parse_shortcode

log = logging.getLogger("lately.worker")

# Ordered registry; the loop advances jobs through these names.
STAGES: dict[str, Any] = {}
NEXT: dict[str, str | None] = {
    "resolve": "fetch",
    "fetch": "transcribe",
    "transcribe": "vision",
    "vision": "structure",
    "structure": "finalize",
    "finalize": None,
}


def stage(name: str):
    def register(fn):
        STAGES[name] = fn
        return fn

    return register


# Strong refs so fire-and-forget metric writes aren't garbage-collected mid-flight.
_metric_tasks: set[asyncio.Task[None]] = set()


def _metric(db: asyncpg.Pool, door: str, stage_name: str, started: float, outcome: str,
            detail: dict[str, Any] | None = None) -> None:
    """Fire-and-forget metrics row (PIPELINE.md §8). Never raises."""
    async def _write() -> None:
        try:
            await db.execute(
                """insert into public.metrics (door, stage, duration_ms, outcome, detail)
                   values ($1, $2, $3, $4, $5)""",
                door, stage_name, int((time.monotonic() - started) * 1000),
                outcome, (detail and str(dict(detail))) or None,
            )
        except Exception:  # metrics must never break the pipeline
            log.exception("metric write failed")

    task = asyncio.get_running_loop().create_task(_write())
    _metric_tasks.add(task)
    task.add_done_callback(_metric_tasks.discard)


@stage("resolve")
async def resolve(db: asyncpg.Pool, job: dict[str, Any]) -> str | None:
    """URL → shortcode. Follows /share/ redirects; cache-hit jumps to finalize."""
    payload = job["payload"]
    reel_id = payload["reel_id"]
    started = time.monotonic()

    reel = await db.fetchrow(
        "select source_url, shortcode_key from public.reels where id = $1", reel_id
    )
    if reel is None:
        raise RuntimeError(f"reel {reel_id} vanished")

    shortcode = reel["shortcode_key"]

    # /share/XXXX shortlinks carry no shortcode — resolve via redirect.
    if shortcode is None and is_share_link(reel["source_url"]):
        async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
            resp = await client.get(reel["source_url"])
        loc = resp.headers.get("location", "")
        shortcode = parse_shortcode(loc) or None

    if shortcode is None:
        # Can't identify the reel yet. Stay resolvable later: retry with backoff
        # rather than dead-lettering — Instagram links may resolve on retry.
        raise RuntimeError("no shortcode after resolve")

    # A /share/ link can turn out to be a reel this user already saved: the
    # second save is a no-op (PIPELINE.md §3 step 4), so drop it and finish.
    if reel["shortcode_key"] is None and await db.fetchval(
        """select exists (
             select 1 from public.reels r
             join public.reels me on me.id = $1
             where r.auth_user_id = me.auth_user_id and r.shortcode_key = $2
               and r.id <> me.id)""",
        reel_id, shortcode,
    ):
        await db.execute("delete from public.reels where id = $1", reel_id)
        _metric(db, "worker", "resolve", started, "duplicate")
        return None

    # Cache hit: shared content already structured → jump straight to finalize.
    hit = await db.fetchval(
        "select media_status = 'ready' from public.reel_content where shortcode = $1",
        shortcode,
    )

    await db.execute(
        "update public.reels set shortcode_key = $2 where id = $1", reel_id, shortcode
    )
    job["payload"]["shortcode"] = shortcode  # persisted by the loop's advance_job

    if hit:
        _metric(db, "worker", "resolve", started, "cache_hit")
        return "finalize"

    _metric(db, "worker", "resolve", started, "ok")
    return NEXT["resolve"]


@stage("fetch")
async def fetch(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """Part 2: provider chain → reel_content row (caption/thumbnail/media)."""
    raise NotImplementedError("fetch lands in Part 2 (provider chain)")


@stage("transcribe")
async def transcribe(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """Part 2: audio → transcript, only when caption is weak."""
    raise NotImplementedError("transcribe lands in Part 2 (Groq, conditional)")


@stage("vision")
async def vision(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """Part 3: keyframes → on-screen text, only if no speech and caption weak."""
    raise NotImplementedError("vision lands in Part 3")


@stage("structure")
async def structure(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """Part 2: ONE LLM call → validated JSON incl. likely_queries."""
    raise NotImplementedError("structure lands in Part 2 (Gemini + pydantic)")


@stage("finalize")
async def finalize(db: asyncpg.Pool, job: dict[str, Any]) -> None:
    """Part 1 stub: mark this save enriched.

    Part 3 replaces this: write shared reel_content, batch-update ALL reels
    rows with the shortcode, per-user embedding, enqueue deliver job.
    """
    payload = job["payload"]
    await db.execute(
        """
        update public.reels
        set status = 'enriched'
        where id = $1 and shortcode_key is not null
        """,
        payload["reel_id"],
    )
