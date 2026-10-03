"""Worker loop: stages run under a lease, errors back off, crashes resume (PIPELINE.md §4–§7)."""

import asyncio
import time

import httpx
import pytest

from app.worker import loop, stages

pytestmark = pytest.mark.db


def passthrough(name):
    async def _stage(db, job):
        return stages.NEXT[name]
    return _stage


def pass_middle_stages(monkeypatch, *names):
    for name in names:
        monkeypatch.setitem(stages.STAGES, name, passthrough(name))


async def enqueue(db, uid, code="C8xYz12"):
    url = f"https://www.instagram.com/reel/{code}/"
    row = await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $2)", uid, url)
    return row["reel_id"]


async def claim(db, worker="w1"):
    return await db.fetchrow("select * from public.claim_job($1)", worker)


async def test_run_job_walks_all_stages_to_finalize(db, make_user, monkeypatch):
    pass_middle_stages(monkeypatch, "fetch", "transcribe", "vision", "structure")
    reel_id = await enqueue(db, await make_user())
    await loop.run_job(db, await claim(db), "w1")
    assert await db.fetchval("select status from public.reels where id = $1", reel_id) == "enriched"
    assert await db.fetchval("select count(*) from public.jobs") == 0


async def test_run_job_stage_error_backs_off(db, make_user, monkeypatch):
    async def boom(db, job):
        raise RuntimeError("boom")
    monkeypatch.setitem(stages.STAGES, "fetch", boom)
    await enqueue(db, await make_user())
    await loop.run_job(db, await claim(db), "w1")
    job = await db.fetchrow("select *, run_at > now() + interval '50 seconds' as backed_off "
                            "from public.jobs")
    assert job["attempts"] == 1 and job["locked_by"] is None
    assert job["last_error"] == "boom" and job["backed_off"] is True


async def test_run_job_not_implemented_requeues_without_burning_attempt(db, make_user):
    await enqueue(db, await make_user())
    await loop.run_job(db, await claim(db), "w1")
    job = await db.fetchrow(
        "select *, run_at between now() + interval '4 minutes' and now() + interval '6 minutes'"
        " as requeued from public.jobs")
    assert job["attempts"] == 0 and job["stage"] == "fetch"
    assert job["locked_by"] is None and job["requeued"] is True


async def test_run_forever_processes_jobs_concurrently(db, make_user, monkeypatch):
    windows = []

    async def slow_fetch(db, job):
        start = time.monotonic()
        await asyncio.sleep(2.0)  # >> a cloud DB round trip (~130 ms), so overlap is unambiguous
        windows.append((start, time.monotonic()))
        return "transcribe"

    monkeypatch.setitem(stages.STAGES, "fetch", slow_fetch)
    pass_middle_stages(monkeypatch, "transcribe", "vision", "structure")
    for i in range(3):
        await enqueue(db, await make_user(), f"CON{i}")
    # Open the pool's connections now so connection setup isn't timed as "work".
    await asyncio.gather(*(db.fetchval("select pg_sleep(0.05)") for _ in range(8)))

    stop = asyncio.Event()
    runner = asyncio.create_task(
        loop.run_forever(db, "wf", concurrency=3, poll_interval=0.05, stop=stop))
    deadline = time.monotonic() + 20
    while await db.fetchval("select count(*) from public.jobs") and time.monotonic() < deadline:
        await asyncio.sleep(0.1)
    stop.set()
    await asyncio.wait_for(runner, 10)

    assert len(windows) == 3
    assert max(s for s, _ in windows) < min(e for _, e in windows), "fetches did not overlap"
    assert await db.fetchval("select count(*) from public.reels where status = 'enriched'") == 3


async def test_crash_mid_job_resumes_from_saved_stage(db, make_user):
    await enqueue(db, await make_user())
    job = await claim(db, "w1")
    assert await db.fetchval("select public.advance_job($1, 'w1', 'transcribe')", job["id"])
    # w1 dies here: no release, no more heartbeats.
    await db.execute("update public.jobs set heartbeat_at = now() - interval '11 minutes'")
    assert await db.fetchval("select public.sweep_stuck_jobs()") == 1
    resumed = await claim(db, "w2")
    assert resumed["stage"] == "transcribe"
    assert await db.fetchval("select public.advance_job($1, 'w1', 'vision')", job["id"]) is False


async def test_resolve_drops_a_share_link_duplicate_of_a_saved_reel(db, make_user, monkeypatch):
    # The user saved /reel/DupAbc1 earlier, then shares the same reel via a /share/
    # link: RESOLVE learns it is a duplicate and the second save becomes a no-op.
    def redirect(request):
        return httpx.Response(302, headers={"location": "https://www.instagram.com/reel/DupAbc1/"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(stages.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(redirect), **kw))
    uid = await make_user()
    original = await enqueue(db, uid, "DupAbc1")
    await db.execute("delete from public.jobs")  # the original was enriched long ago
    share = "https://www.instagram.com/share/ZzTop9"
    dup = (await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $2)",
                             uid, share))["reel_id"]

    await loop.run_job(db, await claim(db), "w1")

    reels = {r["id"] for r in await db.fetch(
        "select id from public.reels where auth_user_id = $1", uid)}
    assert reels == {original} and dup not in reels
    assert await db.fetchval("select count(*) from public.jobs") == 0
    assert await db.fetchval("select count(*) from public.jobs_dead") == 0
