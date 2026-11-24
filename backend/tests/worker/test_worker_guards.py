"""Worker loop review fixes: stage deadlines and the heartbeat (#14), a graceful
stop that hands jobs back (#13), a failed advance backs off (#20), and the
sweep re-enqueues missing embeddings (#18)."""

import asyncio
import time
from datetime import timedelta

import pytest

from app import deps
from app.config import settings
from app.search.embed import EMBED_DIM, to_pgvector
from app.worker import loop, stages
from tests.worker.test_worker_loop import claim, enqueue, pass_middle_stages


async def test_pool_has_a_command_timeout(monkeypatch):
    captured = {}

    async def fake_create_pool(dsn, **kw):
        captured.update(kw)
        return object()

    monkeypatch.setattr(deps.asyncpg, "create_pool", fake_create_pool)
    monkeypatch.setattr(deps, "_pool", None)
    await deps.init_pool()
    assert captured["command_timeout"] == settings().db_command_timeout_seconds > 0


async def test_acquire_or_stop_gives_up_when_stopped_while_waiting():
    slots, stop = asyncio.Semaphore(1), asyncio.Event()
    await slots.acquire()
    waiter = asyncio.create_task(loop._acquire_or_stop(slots, stop))
    await asyncio.sleep(0.05)
    assert not waiter.done()
    stop.set()
    assert await asyncio.wait_for(waiter, 1) is False
    slots.release()
    await asyncio.wait_for(slots.acquire(), 0.5)  # the abandoned wait kept no slot
    assert await loop._acquire_or_stop(asyncio.Semaphore(1), stop) is False


# ------------------------------------------------------- deadlines (#14) --

async def hang(db, job):
    await asyncio.sleep(60)


@pytest.mark.db
async def test_a_stage_past_its_deadline_is_cancelled_and_backs_off(db, make_user, monkeypatch):
    monkeypatch.setattr(settings(), "worker_stage_timeout_seconds", 0.3)
    monkeypatch.setitem(stages.STAGES, "fetch", hang)
    reel_id = await enqueue(db, await make_user())
    started = time.monotonic()
    await asyncio.wait_for(loop.run_job(db, await claim(db), "w1"), 10)
    assert time.monotonic() - started < 5
    job = await db.fetchrow("select *, run_at > now() + interval '50 seconds' as backed_off "
                            "from public.jobs")
    assert job["stage"] == "fetch" and job["attempts"] == 1 and job["locked_by"] is None
    assert job["backed_off"] and job["last_error"].startswith("timed out: fetch")

    # Timed out on the last attempt too: dead-lettered, and the save says why.
    await db.execute("update public.jobs set run_at = now(), attempts = max_attempts - 1")
    await loop.run_job(db, await claim(db), "w1")
    assert await db.fetchval("select count(*) from public.jobs_dead") == 1
    row = await db.fetchrow("select status, fail_reason from public.reels where id = $1", reel_id)
    assert (row["status"], row["fail_reason"]) == ("partial", "timed_out")


@pytest.mark.db
async def test_heartbeat_stops_renewing_once_the_deadline_passed(db, make_user, monkeypatch):
    monkeypatch.setattr(settings(), "worker_heartbeat_seconds", 0.05)
    await enqueue(db, await make_user())
    job = await claim(db)
    await db.execute("update public.jobs set heartbeat_at = now() - interval '5 minutes'")
    clock = asyncio.get_running_loop().time
    lease = {"until": clock() - 1}
    beat = asyncio.create_task(loop._heartbeat(db, job["id"], "w1", lease))
    try:
        await asyncio.sleep(0.4)
        assert await db.fetchval(
            "select heartbeat_at < now() - interval '4 minutes' from public.jobs")
        lease["until"] = clock() + 60  # the next stage's deadline: renewing again
        await asyncio.sleep(0.4)
        assert await db.fetchval(
            "select heartbeat_at > now() - interval '1 minute' from public.jobs")
    finally:
        beat.cancel()


# ---------------------------------------------------- advance error (#20) --

@pytest.mark.db
async def test_a_failed_advance_is_a_stage_error_with_backoff(db, make_user, monkeypatch):
    async def unstorable(db, job):
        job["payload"]["card"] = {"title": "nul \x00 inside"}  # jsonb rejects \u0000
        return "transcribe"

    monkeypatch.setitem(stages.STAGES, "fetch", unstorable)
    await enqueue(db, await make_user())
    await loop.run_job(db, await claim(db), "w1")
    job = await db.fetchrow("select *, run_at > now() + interval '50 seconds' as backed_off "
                            "from public.jobs")
    assert job["stage"] == "fetch" and job["attempts"] == 1 and job["locked_by"] is None
    assert job["backed_off"] and job["last_error"].startswith("advance after fetch failed")


# -------------------------------------------------------- shutdown (#13) --

@pytest.mark.db
async def test_stop_hands_running_jobs_back_with_the_attempt_refunded(db, make_user,
                                                                       monkeypatch):
    calls = []
    started = asyncio.Event()

    async def slow(db, job):
        calls.append(job["id"])
        started.set()
        await asyncio.sleep(60)
        return "transcribe"

    monkeypatch.setitem(stages.STAGES, "fetch", slow)
    await enqueue(db, await make_user(), "STOP001")
    await enqueue(db, await make_user(), "STOP002")
    stop = asyncio.Event()
    runner = asyncio.create_task(loop.run_forever(
        db, "ws", concurrency=1, poll_interval=0.05, stop=stop, grace_seconds=0.3))
    await asyncio.wait_for(started.wait(), 10)
    assert await db.fetchval("select count(*) from public.jobs where locked_by = 'ws'") == 1
    stop.set()
    await asyncio.wait_for(runner, 10)

    assert len(calls) == 1  # the waiting job was never claimed
    jobs = await db.fetch("select *, run_at <= now() as due from public.jobs order by stage")
    assert len(jobs) == 2
    for job in jobs:
        assert job["locked_by"] is None and job["locked_at"] is None
        assert job["heartbeat_at"] is None and job["attempts"] == 0 and job["due"]
    assert sorted(j["stage"] for j in jobs) == ["fetch", "resolve"]


@pytest.mark.db
async def test_stop_lets_a_job_finish_within_the_grace_period(db, make_user, monkeypatch):
    started = asyncio.Event()

    async def short(db, job):
        started.set()
        await asyncio.sleep(0.3)
        return "transcribe"

    monkeypatch.setitem(stages.STAGES, "fetch", short)
    pass_middle_stages(monkeypatch, "transcribe", "vision", "structure")
    reel_id = await enqueue(db, await make_user())
    stop = asyncio.Event()
    runner = asyncio.create_task(loop.run_forever(
        db, "ws", concurrency=2, poll_interval=0.05, stop=stop, grace_seconds=10))
    await asyncio.wait_for(started.wait(), 10)
    stop.set()
    await asyncio.wait_for(runner, 10)
    assert await db.fetchval("select count(*) from public.jobs where kind = 'enrich'") == 0
    assert await db.fetchval("select status from public.reels where id = $1", reel_id) == "partial"
    # FINALIZE's embed job is left queued for the next worker, not claimed.
    assert await db.fetchval("select count(*) from public.jobs where locked_at is not null") == 0


@pytest.mark.db
async def test_hurry_skips_the_grace_period(db, make_user, monkeypatch):
    started = asyncio.Event()

    async def slow(db, job):
        started.set()
        await asyncio.sleep(60)

    monkeypatch.setitem(stages.STAGES, "fetch", slow)
    await enqueue(db, await make_user())
    stop, hurry = asyncio.Event(), asyncio.Event()
    runner = asyncio.create_task(loop.run_forever(
        db, "ws", concurrency=1, poll_interval=0.05, stop=stop, hurry=hurry, grace_seconds=60))
    await asyncio.wait_for(started.wait(), 10)
    hurry.set()
    stop.set()
    await asyncio.wait_for(runner, 5)
    job = await db.fetchrow("select * from public.jobs")
    assert job["locked_by"] is None and job["attempts"] == 0


# ------------------------------------------------- missing embeddings (#18) --

@pytest.mark.db
async def test_sweep_requeues_embeds_for_enriched_saves_without_one(db, make_user,
                                                                      offline_enrichment):
    uid = await make_user()
    ids = {name: await enqueue(db, uid, f"EMB{name}") for name in
           ("old", "young", "pending", "embedded", "queued", "cooling", "cooled")}
    await db.execute("delete from public.jobs")
    await db.execute("update public.reels set status = 'enriched', "
                     "created_at = now() - interval '1 hour'")
    await db.execute("update public.reels set created_at = now() where id = $1", ids["young"])
    await db.execute("update public.reels set status = 'pending' where id = $1", ids["pending"])
    await db.execute("update public.reels set embedding = $2::vector where id = $1",
                     ids["embedded"], to_pgvector([1.0] + [0.0] * (EMBED_DIM - 1)))
    await db.execute("insert into public.jobs (kind, payload, stage) "
                     "values ('embed', jsonb_build_object('reel_id', $1::text), 'embed')",
                     str(ids["queued"]))
    for name, ago in (("cooling", "10 minutes"), ("cooled", "2 hours")):
        await db.execute(
            "insert into public.jobs_dead (id, kind, payload, stage, attempts, last_error, "
            "failed_at) values (gen_random_uuid(), 'embed', "
            "jsonb_build_object('reel_id', $1::text), 'embed', 3, 'HTTP 500', "
            f"now() - interval '{ago}')", str(ids["cooled" if name == "cooled" else "cooling"]))

    # No embedder configured: the sweep leaves them alone.
    offline_enrichment.embedder = None
    await loop._sweep(db, timedelta(minutes=10))
    assert await db.fetchval("select count(*) from public.jobs") == 1

    offline_enrichment.embedder = object()
    await loop._sweep(db, timedelta(minutes=10))
    queued = {r["reel_id"] for r in await db.fetch(
        "select payload->>'reel_id' as reel_id from public.jobs where kind = 'embed'")}
    assert queued == {str(ids["old"]), str(ids["cooled"]), str(ids["queued"])}
    assert await db.fetchval("select count(*) from public.jobs") == 3
    assert await loop.requeue_missing_embeddings(db) == 0  # nothing twice
