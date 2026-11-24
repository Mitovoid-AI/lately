"""Worker loop (PIPELINE.md §4–§7).

Claim → run stages from `jobs.stage` → advance → release, up to `concurrency`
jobs at once. Every claim is a lease: only the claiming worker may advance or
release the job, a heartbeat renews it while a stage runs, and a periodic sweep
(`sweep_stuck_jobs`) reclaims leases whose worker died, so the job resumes from
its last saved stage. Stage errors retry with backoff via `release_job`;
exhausted jobs land in `jobs_dead`.

Each stage has a deadline (`worker_stage_timeout_seconds`): past it the stage is
cancelled and backs off like any stage error, and the heartbeat stops renewing
the lease, so a stage that will not stop is still reclaimed by the sweep. On
stop the worker claims nothing more, gives running stages a grace period, then
cancels them and hands every job it holds back to the queue with the attempt
refunded (`_release_held`).

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
from ..enrich.runtime import runtime
from . import stages

log = logging.getLogger("lately.worker")

SWEEP_EVERY_SECONDS = 60.0

# The sweep also re-enqueues embed jobs for enriched saves left without an
# embedding (their embed job was dead-lettered): at most this many per sweep,
# only for saves older than REEMBED_AFTER, and not within REEMBED_COOLDOWN of
# that save's last dead embed job.
REEMBED_PER_SWEEP = 50
REEMBED_AFTER = timedelta(minutes=5)
REEMBED_COOLDOWN = timedelta(hours=1)
_REEMBED = """
insert into public.jobs (kind, payload, stage)
select 'embed', jsonb_build_object('reel_id', r.id::text), 'embed'
from public.reels r
where r.status = 'enriched' and r.embedding is null and r.created_at < now() - $1::interval
  and not exists (select 1 from public.jobs j
                  where j.kind = 'embed' and j.payload->>'reel_id' = r.id::text)
  and not exists (select 1 from public.jobs_dead d
                  where d.kind = 'embed' and d.payload->>'reel_id' = r.id::text
                    and d.failed_at > now() - $2::interval)
order by r.created_at desc
limit $3
"""

# Every job this worker still holds goes back to the queue, due now; the
# interrupted attempt does not count.
_RELEASE_HELD = """
update public.jobs
set locked_at = null, locked_by = null, heartbeat_at = null,
    attempts = greatest(attempts - 1, 0), run_at = now()
where locked_by = $1
"""


async def run_job(db: asyncpg.Pool, job: Mapping[str, Any], worker_id: str) -> None:
    """Run one claimed job until it finishes, fails, waits, or loses its lease.
    Never raises (cancelling it, on stop, raises CancelledError)."""
    payload = job["payload"]
    j: dict[str, Any] = {
        "id": job["id"],
        "payload": json.loads(payload) if isinstance(payload, str) else dict(payload or {}),
        "stage": job["stage"],
        "attempts": job["attempts"],
        "max_attempts": job.get("max_attempts") or 3,
        "created_at": job.get("created_at"),
    }
    timeout = settings().worker_stage_timeout_seconds
    clock = asyncio.get_running_loop().time
    lease = {"until": clock() + timeout}  # the heartbeat renews only until then
    heartbeat = asyncio.create_task(_heartbeat(db, j["id"], worker_id, lease))
    try:
        while True:
            stage_name = j["stage"]
            fn = stages.STAGES.get(stage_name)
            if fn is None:
                # A newer deploy's job kind/stage reached an older worker (rolling
                # deploy): leave it for a worker that has it, without burning an attempt.
                await db.execute(
                    """update public.jobs
                       set locked_at = null, locked_by = null, heartbeat_at = null,
                           attempts = greatest(attempts - 1, 0),
                           run_at = now() + interval '5 minutes',
                           last_error = $3
                       where id = $1 and locked_by = $2""",
                    j["id"], worker_id, f"unknown stage {stage_name}")
                log.warning("job %s: unknown stage %s; requeued", j["id"], stage_name)
                return
            lease["until"] = clock() + timeout
            try:
                result = await asyncio.wait_for(fn(db, j), timeout)
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
            except stages.Reschedule as r:
                # Provider budget exhausted: wait it out without burning an attempt,
                # keeping any progress the stage recorded in the payload.
                await db.execute(
                    """update public.jobs
                       set locked_at = null, locked_by = null, heartbeat_at = null,
                           attempts = greatest(attempts - 1, 0),
                           run_at = now() + make_interval(secs => $3),
                           payload = $4::jsonb, last_error = $5
                       where id = $1 and locked_by = $2""",
                    j["id"], worker_id, float(r.delay_s), json.dumps(j["payload"]), r.reason,
                )
                log.info("job %s rescheduled at %s: %s", j["id"], stage_name, r.reason)
                return
            except TimeoutError as exc:  # the stage deadline, or a query's command_timeout
                took = clock() - (lease["until"] - timeout)
                error = str(exc) or f"timed out: {stage_name} after {took:.0f}s"
                await _release(db, j["id"], worker_id, error)
                log.warning("job %s timed out at %s: %s", j["id"], stage_name, error)
                return
            except Exception as exc:  # noqa: BLE001 — any stage error → backoff
                await _release(db, j["id"], worker_id, str(exc))
                log.warning("job %s failed at %s: %s", j["id"], stage_name, exc)
                return

            if result is None:
                await _release(db, j["id"], worker_id, None)
                log.info("job %s complete", j["id"])
                return

            # Persist progress before running the next stage (resumability). If that
            # fails (a payload Postgres rejects, a lost connection), it is a stage
            # error: back off now rather than wait for the stuck-job sweep.
            try:
                advanced = await db.fetchval(
                    "select public.advance_job($1, $2, $3, $4::jsonb)",
                    j["id"], worker_id, result, json.dumps(j["payload"]),
                )
            except Exception as exc:  # noqa: BLE001
                await _release(db, j["id"], worker_id, f"advance after {stage_name} failed: {exc}")
                log.warning("job %s: advance after %s failed: %s", j["id"], stage_name, exc)
                return
            if not advanced:
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


async def _heartbeat(db: asyncpg.Pool, job_id: Any, worker_id: str,
                     lease: Mapping[str, float]) -> None:
    """Renew the lease while the current stage is within its deadline
    (`lease["until"]`); past it, stop renewing so the sweep can reclaim the job."""
    every = settings().worker_heartbeat_seconds
    clock = asyncio.get_running_loop().time
    while True:
        await asyncio.sleep(every)
        if clock() > lease["until"]:
            continue
        try:
            if not await db.fetchval("select public.heartbeat_job($1, $2)", job_id, worker_id):
                return  # lease lost; run_job finds out at its next advance
        except Exception:
            log.warning("job %s: heartbeat failed", job_id, exc_info=True)


async def _sleep_or_stop(stop: asyncio.Event, seconds: float) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), seconds)


async def _acquire_or_stop(slots: asyncio.Semaphore, stop: asyncio.Event) -> bool:
    """Wait for a free slot: True holding it, or False (holding none) once `stop` is set."""
    if stop.is_set():
        return False
    acquire = asyncio.ensure_future(slots.acquire())
    stopped = asyncio.ensure_future(stop.wait())
    try:
        await asyncio.wait({acquire, stopped}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        stopped.cancel()
        acquire.cancel()  # no-op once it holds the slot; else the semaphore takes it back
    if not acquire.done() or acquire.cancelled():
        return False
    if stop.is_set():
        slots.release()
        return False
    return True


async def requeue_missing_embeddings(db: asyncpg.Pool) -> int:
    """Embed jobs for enriched saves left without an embedding (see REEMBED_*)."""
    status = await db.execute(_REEMBED, REEMBED_AFTER, REEMBED_COOLDOWN, REEMBED_PER_SWEEP)
    return int(status.rsplit(" ", 1)[-1])


async def _sweep(db: asyncpg.Pool, stale: timedelta) -> None:
    swept = await db.fetchval("select public.sweep_stuck_jobs($1)", stale)
    if swept:
        log.info("swept %d stuck jobs", swept)
    if runtime().embedder is not None and (n := await requeue_missing_embeddings(db)):
        log.info("re-enqueued %d embed jobs for saves without an embedding", n)


async def _release_held(db: asyncpg.Pool, worker_id: str) -> int:
    """Hand every job this worker still holds back to the queue (see _RELEASE_HELD)."""
    try:
        status = await db.execute(_RELEASE_HELD, worker_id)
    except Exception:
        log.exception("worker %s: could not release its jobs; the sweep will", worker_id)
        return 0
    return int(status.rsplit(" ", 1)[-1])


async def run_forever(
    db: asyncpg.Pool,
    worker_id: str,
    *,
    concurrency: int,
    poll_interval: float,
    stop: asyncio.Event,
    hurry: asyncio.Event | None = None,
    grace_seconds: float | None = None,
) -> None:
    """Claim and run jobs until `stop` is set. Then claim nothing more, give
    running jobs `grace_seconds` (default worker_shutdown_grace_seconds; `hurry`
    cuts it short) to finish, cancel the rest and release every job still held."""
    slots = asyncio.Semaphore(concurrency)
    running: set[asyncio.Task[None]] = set()
    clock = asyncio.get_running_loop().time
    last_sweep = float("-inf")
    stale = timedelta(minutes=settings().worker_stuck_after_minutes)
    grace = settings().worker_shutdown_grace_seconds if grace_seconds is None else grace_seconds

    def _done(task: asyncio.Task[None]) -> None:
        running.discard(task)
        slots.release()

    log.info("worker %s started (concurrency=%d)", worker_id, concurrency)
    while not stop.is_set():
        try:
            if clock() - last_sweep >= SWEEP_EVERY_SECONDS:
                last_sweep = clock()
                await _sweep(db, stale)

            if not await _acquire_or_stop(slots, stop):
                break
            try:
                job = await db.fetchrow("select * from public.claim_job($1)", worker_id)
            except BaseException:
                slots.release()
                raise
            if job is None or stop.is_set():
                # Claimed just as the stop came: not started; released below.
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
        log.info("worker %s stopping: %d jobs running, %gs to finish",
                 worker_id, len(running), grace)
        deadline = clock() + grace
        while running and clock() < deadline and not (hurry is not None and hurry.is_set()):
            await asyncio.wait(set(running), timeout=min(0.2, max(0.0, deadline - clock())))
        for task in set(running):
            task.cancel()
        if running:
            await asyncio.wait(set(running), timeout=5.0)
    released = await _release_held(db, worker_id)
    log.info("worker %s stopped (%d jobs handed back)", worker_id, released)
