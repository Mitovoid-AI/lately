"""Worker loop (Part 1).

Claim → run stages from `jobs.stage` → advance → release. Errors retry with
backoff via release_job(); a dead job lands in jobs_dead after max_attempts.
A stuck-job sweep (cron-style, every minute) unlocks jobs whose worker died.
Run: `python -m app.worker`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal

import asyncpg

from ..config import settings
from ..deps import close_pool, pool
from . import stages

log = logging.getLogger("lately.worker")


async def _claim_one(conn: asyncpg.Connection) -> asyncpg.Record | None:
    row = await conn.fetchrow("select * from public.claim_job($1)", "worker")
    return row


async def _run_job(job: asyncpg.Record) -> None:
    conn = await pool().acquire()
    assert conn is not None
    try:
        payload = dict(job["payload"]) if job["payload"] else {}
        j: dict = {
            "id": job["id"],
            "payload": payload,
            "stage": job["stage"],
            "attempts": job["attempts"],
        }

        while True:
            stage_name = j["stage"]
            fn = stages.STAGES.get(stage_name)
            if fn is None:
                await conn.execute(
                    "select public.release_job($1, $2)",
                    j["id"], f"unknown stage {stage_name}",
                )
                return
            try:
                result = await fn(conn, j)
            except NotImplementedError as exc:
                # Stage not built yet (Parts 2–3): leave the job queued for a
                # later worker that has it, without burning attempts.
                await conn.execute(
                    """update public.jobs
                       set locked_at = null, run_at = now() + interval '5 minutes'
                       where id = $1""",
                    j["id"],
                )
                log.info("stage %s not implemented; job %s requeued", stage_name, j["id"])
                return
            except Exception as exc:  # noqa: BLE001 — any stage error → backoff
                await conn.execute(
                    "select public.release_job($1, $2)", j["id"], str(exc)
                )
                log.warning("job %s failed at %s: %s", j["id"], stage_name, exc)
                return

            if result is None:
                await conn.execute("select public.release_job($1)", j["id"])
                log.info("job %s complete", j["id"])
                return

            # Advance to the next stage, persisting progress (resumability).
            await conn.execute(
                "update public.jobs set stage = $2 where id = $1", j["id"], result
            )
            j["stage"] = result
    finally:
        await pool().release(conn)


async def _sweep_stuck() -> int:
    """Unlock jobs whose worker died mid-stage (PIPELINE.md §7)."""
    conn = await pool().acquire()
    assert conn is not None
    try:
        n = await conn.fetchval(
            f"""
            update public.jobs
            set locked_at = null
            where locked_at is not null
              and locked_at < now() - make_interval(mins => $1)
            """,
            settings().worker_stuck_after_minutes,
        )
        return int(n or 0)
    finally:
        await pool().release(conn)


async def run_forever() -> None:
    s = settings()
    log.info("worker started (poll=%ss)", s.worker_poll_interval_seconds)
    sweep_every = 60.0
    last_sweep = 0.0

    while True:
        try:
            if asyncio.get_running_loop().time() - last_sweep > sweep_every:
                stuck = await _sweep_stuck()
                if stuck:
                    log.info("unlocked %d stuck jobs", stuck)
                last_sweep = asyncio.get_running_loop().time()

            conn = await pool().acquire()
            assert conn is not None
            try:
                job = await _claim_one(conn)
            finally:
                await pool().release(conn)

            if job is None:
                await asyncio.sleep(s.worker_poll_interval_seconds)
                continue
            await _run_job(job)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — the loop must survive anything
            log.exception("worker iteration failed")
            await asyncio.sleep(1.0)


def main() -> None:  # pragma: no cover — long-running entrypoint
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    async def _amain() -> None:
        loop = asyncio.get_running_loop()
        stop = asyncio.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            with contextlib.suppress(NotImplementedError):  # Windows lacks add_signal_handler
                loop.add_signal_handler(sig, stop.set)
        runner = asyncio.create_task(run_forever())
        try:
            await stop.wait()
        finally:
            runner.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await runner
            await close_pool()

    asyncio.run(_amain())


if __name__ == "__main__":
    main()
