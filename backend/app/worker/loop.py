"""Worker loop (PIPELINE.md §4–§7).

Claim → run stages from `jobs.stage` → advance → release, up to `concurrency`
jobs at once. Every claim is a lease: only the claiming worker may advance or
release the job, a heartbeat renews it while a stage runs, and a periodic sweep
(`sweep_stuck_jobs`) reclaims leases whose worker died, so the job resumes from
its last saved stage. Stage errors retry with backoff via `release_job`;
exhausted jobs land in `jobs_dead`.

No connection is held across a stage: stages and RPCs each borrow one from
the pool per query, so a slow external call never pins a DB connection.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import Mapping
from datetime import timedelta
from typing import Any

import asyncpg

from ..config import settings
from . import stages

log = logging.getLogger("lately.worker")

SWEEP_EVERY_SECONDS = 60.0


async def run_job(db: asyncpg.Pool, job: Mapping[str, Any], worker_id: str) -> None:
    """Run one claimed job until it finishes, fails, waits, or loses its lease. Never raises."""
    payload = job["payload"]
    j: dict[str, Any] = {
        "id": job["id"],
        "payload": json.loads(payload) if isinstance(payload, str) else dict(payload or {}),
        "stage": job["stage"],
        "attempts": job["attempts"],
    }
    heartbeat = asyncio.create_task(_heartbeat(db, j["id"], worker_id))
    try:
        while True:
            stage_name = j["stage"]
            fn = stages.STAGES.get(stage_name)
            if fn is None:
                await _release(db, j["id"], worker_id, f"unknown stage {stage_name}")
                return
            try:
                result = await fn(db, j)
            except NotImplementedError:
                # Stage not built yet (Phase 2+): leave the job queued for a later
                # worker that has it, without burning an attempt.
                await db.execute(
                    """update public.jobs
                       set locked_at = null, locked_by = null, heartbeat_at = null,
                           attempts = greatest(attempts - 1, 0),
                           run_at = now() + interval '5 minutes'
                       where id = $1 and locked_by = $2""",
                    j["id"], worker_id,
                )
                log.info("stage %s not implemented; job %s requeued", stage_name, j["id"])
                return
            except Exception as exc:  # noqa: BLE001 — any stage error → backoff
                await _release(db, j["id"], worker_id, str(exc))
                log.warning("job %s failed at %s: %s", j["id"], stage_name, exc)
                return

            if result is None:
                await _release(db, j["id"], worker_id, None)
                log.info("job %s complete", j["id"])
                return

            # Persist progress before running the next stage (resumability).
            if not await db.fetchval(
                "select public.advance_job($1, $2, $3, $4::jsonb)",
                j["id"], worker_id, result, json.dumps(j["payload"]),
            ):
                log.warning("job %s: lease lost at %s; stopping", j["id"], stage_name)
                return
            j["stage"] = result
    except Exception:
        log.exception("job %s: worker error; the sweep will reclaim it", j["id"])
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat


async def _release(db: asyncpg.Pool, job_id: Any, worker_id: str, error: str | None) -> None:
    await db.execute("select public.release_job($1, $2, $3)", job_id, worker_id, error)


async def _heartbeat(db: asyncpg.Pool, job_id: Any, worker_id: str) -> None:
    every = settings().worker_heartbeat_seconds
    while True:
        await asyncio.sleep(every)
        try:
            if not await db.fetchval("select public.heartbeat_job($1, $2)", job_id, worker_id):
                return  # lease lost; run_job finds out at its next advance
        except Exception:
            log.warning("job %s: heartbeat failed", job_id, exc_info=True)


async def _sleep_or_stop(stop: asyncio.Event, seconds: float) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), seconds)


async def run_forever(
    db: asyncpg.Pool,
    worker_id: str,
    *,
    concurrency: int,
    poll_interval: float,
    stop: asyncio.Event,
) -> None:
    """Claim and run jobs until `stop` is set, then wait for in-flight jobs."""
    slots = asyncio.Semaphore(concurrency)
    running: set[asyncio.Task[None]] = set()
    clock = asyncio.get_running_loop().time
    last_sweep = float("-inf")
    stale = timedelta(minutes=settings().worker_stuck_after_minutes)

    def _done(task: asyncio.Task[None]) -> None:
        running.discard(task)
        slots.release()

    log.info("worker %s started (concurrency=%d)", worker_id, concurrency)
    while not stop.is_set():
        try:
            if clock() - last_sweep >= SWEEP_EVERY_SECONDS:
                last_sweep = clock()
                swept = await db.fetchval("select public.sweep_stuck_jobs($1)", stale)
                if swept:
                    log.info("swept %d stuck jobs", swept)

            await slots.acquire()
            try:
                job = await db.fetchrow("select * from public.claim_job($1)", worker_id)
            except BaseException:
                slots.release()
                raise
            if job is None:
                slots.release()
                await _sleep_or_stop(stop, poll_interval)
                continue
            task = asyncio.create_task(run_job(db, job, worker_id))
            running.add(task)
            task.add_done_callback(_done)
        except asyncio.CancelledError:
            raise
        except Exception:  # the loop must survive anything
            log.exception("worker iteration failed")
            await _sleep_or_stop(stop, 1.0)

    if running:
        await asyncio.gather(*running, return_exceptions=True)
    log.info("worker %s stopped", worker_id)
