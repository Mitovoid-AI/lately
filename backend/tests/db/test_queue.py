"""Queue RPCs: lease-based claims, ownership checks, backoff, DLQ, sweep (PIPELINE.md §4, §7)."""

import asyncio

import pytest

pytestmark = pytest.mark.db


async def enqueue(db, uid, code):
    url = f"https://www.instagram.com/reel/{code}/"
    row = await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $2)", uid, url)
    return await db.fetchval(
        "select id from public.jobs where payload->>'reel_id' = $1", str(row["reel_id"]))


async def claim(db, worker="w1"):
    return await db.fetch("select * from public.claim_job($1)", worker)


async def test_claim_job_returns_no_rows_when_queue_empty(db):
    assert await db.fetch("select * from public.claim_job('w1')") == []


async def test_claim_job_concurrent_claims_get_distinct_jobs(db, make_user):
    for i in range(3):
        await enqueue(db, await make_user(), f"CC{i}")
    results = await asyncio.gather(*(claim(db, f"w{i}") for i in range(10)))
    claimed = [r[0]["id"] for r in results if r and r[0]["id"] is not None]
    assert len(claimed) == 3
    assert len(set(claimed)) == 3


async def test_claim_job_respects_per_user_inflight_cap(db, make_user):
    uid = await make_user()
    for i in range(11):
        await enqueue(db, uid, f"CAP{i}")
    for _ in range(10):
        assert len(await claim(db)) == 1
    assert await claim(db) == []


async def test_advance_job_rejects_non_owner(db, make_user):
    job_id = await enqueue(db, await make_user(), "ADV1")
    await claim(db, "w1")
    assert await db.fetchval("select public.advance_job($1, 'w2', 'fetch')", job_id) is False
    assert await db.fetchval("select public.advance_job($1, 'w1', 'fetch')", job_id) is True
    assert await db.fetchval("select stage from public.jobs where id = $1", job_id) == "fetch"


async def test_release_job_backoff_then_dead_after_max_attempts(db, make_user):
    job_id = await enqueue(db, await make_user(), "REL1")
    for attempt in range(1, 4):
        await claim(db, "w1")
        await db.execute("select public.release_job($1, 'w1', 'boom')", job_id)
        if attempt == 1:
            backed_off = await db.fetchval(
                "select run_at >= now() + interval '2 minutes' - interval '5 seconds' "
                "from public.jobs where id = $1", job_id)
            assert backed_off is True
        if attempt < 3:
            await db.execute("update public.jobs set run_at = now() where id = $1", job_id)
    assert await db.fetchval("select count(*) from public.jobs where id = $1", job_id) == 0
    dead = await db.fetchrow("select * from public.jobs_dead where id = $1", job_id)
    assert dead["last_error"] == "boom" and dead["attempts"] == 3


async def test_sweep_unlocks_stale_and_dead_letters_exhausted(db, make_user):
    a = await enqueue(db, await make_user(), "SWA")
    b = await enqueue(db, await make_user(), "SWB")
    await claim(db, "w1")
    await claim(db, "w1")
    await db.execute("update public.jobs set attempts = 3 where id = $1", b)
    await db.execute("update public.jobs set heartbeat_at = now() - interval '11 minutes'")
    assert await db.fetchval("select public.sweep_stuck_jobs()") == 2
    job_a = await db.fetchrow("select * from public.jobs where id = $1", a)
    assert job_a["locked_at"] is None and job_a["locked_by"] is None
    assert await db.fetchval("select count(*) from public.jobs where id = $1", b) == 0
    assert await db.fetchval(
        "select last_error from public.jobs_dead where id = $1", b) == "stuck: worker lost"
