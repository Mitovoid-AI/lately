"""Pre-launch review fixes (backend review 2026-10-10): dead-lettered saves
recover, quota can't be reset by deleting, retries are capped, notes on
partial cards re-embed, NUL input never 500s, unknown stages don't burn
attempts, and the client roles can't reach server-side functions/tables."""

import pytest

from app.worker.loop import run_job

pytestmark = pytest.mark.db


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def url(code):
    return f"https://www.instagram.com/reel/{code}/"


async def save(db, uid, code):
    row = await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $2)",
                            uid, url(code))
    return row["reel_id"]


async def test_dead_lettered_enrich_job_marks_save_partial(db, make_user):
    reel_id = await save(db, await make_user(), "DEAD1")
    job = await db.fetchrow("select * from public.claim_job('w1')")
    await db.execute("update public.jobs set attempts = max_attempts where id = $1", job["id"])
    await db.execute("select public.release_job($1, 'w1', 'boom')", job["id"])
    assert await db.fetchval("select count(*) from public.jobs_dead") == 1
    assert await db.fetchval("select status from public.reels where id = $1", reel_id) == "partial"


async def test_swept_dead_job_marks_save_partial(db, make_user):
    reel_id = await save(db, await make_user(), "DEAD2")
    job = await db.fetchrow("select * from public.claim_job('w1')")
    await db.execute(
        "update public.jobs set attempts = max_attempts, heartbeat_at = now() - interval '1 hour',"
        " locked_at = now() - interval '1 hour' where id = $1", job["id"])
    await db.execute("select public.sweep_stuck_jobs()")
    assert await db.fetchval("select status from public.reels where id = $1", reel_id) == "partial"


async def test_deleting_saves_does_not_reset_monthly_quota(client, db, make_user, jwt_for):
    uid = await make_user()
    await db.execute("insert into public.profiles (id, saves_free_limit) values ($1, 2) "
                     "on conflict (id) do update set saves_free_limit = 2", uid)
    h = auth(jwt_for(uid))
    for code in ("QA1", "QA2"):
        r = await client.post("/saves", json={"text": url(code)}, headers=h)
        assert r.status_code == 201
        assert (await client.delete(f"/saves/{r.json()['reel_id']}", headers=h)).status_code == 204
    r = await client.post("/saves", json={"text": url("QA3")}, headers=h)
    assert r.status_code == 429 and r.json()["error"]["code"] == "QUOTA_EXCEEDED"


async def test_retries_are_capped_per_save(client, db, make_user, jwt_for):
    uid = await make_user()
    reel_id = await save(db, uid, "RETRY1")
    await db.execute("delete from public.jobs")
    await db.execute("update public.reels set status = 'partial' where id = $1", reel_id)
    h = auth(jwt_for(uid))
    for _ in range(3):
        assert (await client.post(f"/retries/{reel_id}", headers=h)).status_code == 202
        await db.execute("delete from public.jobs")
        await db.execute("update public.reels set status = 'partial' where id = $1", reel_id)
    r = await client.post(f"/retries/{reel_id}", headers=h)
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"


async def test_note_on_partial_card_enqueues_embed(client, db, make_user, jwt_for):
    uid = await make_user()
    reel_id = await save(db, uid, "PART1")
    await db.execute("delete from public.jobs")
    await db.execute("update public.reels set status = 'partial' where id = $1", reel_id)
    r = await client.patch(f"/saves/{reel_id}", json={"note": "the rooftop cafe"},
                           headers=auth(jwt_for(uid)))
    assert r.status_code == 200
    assert await db.fetchval("select count(*) from public.jobs where kind = 'embed'") == 1


async def test_nul_bytes_never_500(client, db, make_user, jwt_for):
    uid = await make_user()
    h = auth(jwt_for(uid))
    reel_id = await save(db, uid, "NUL1")
    assert (await client.get("/search", params={"q": "mo\x00mos"}, headers=h)).status_code == 200
    r = await client.patch(f"/saves/{reel_id}", json={"note": "a\x00b"}, headers=h)
    assert r.status_code == 200 and r.json()["note"] == "ab"
    r = await client.post("/stacks", json={"name": "tr\x00ips"}, headers=h)
    assert r.status_code == 201 and r.json()["name"] == "trips"
    r = await client.post("/saves", json={"text": url("NUL2") + "\x00"}, headers=h)
    assert r.status_code in (200, 201)


async def test_unknown_stage_requeues_without_burning_attempt(db, make_user):
    await save(db, await make_user(), "UNK1")
    await db.execute("update public.jobs set stage = 'from_the_future'")
    job = await db.fetchrow("select * from public.claim_job('w1')")
    await run_job(db, job, "w1")
    row = await db.fetchrow("select attempts, locked_at from public.jobs")
    assert row is not None and row["attempts"] == 0 and row["locked_at"] is None
    assert await db.fetchval("select count(*) from public.jobs_dead") == 0


@pytest.mark.parametrize("fn", [
    "public.save_reel(uuid, text, text, text, integer)", "public.claim_job(text)",
    "public.release_job(uuid, text, text)", "public.sweep_stuck_jobs(interval)",
])
async def test_client_roles_cannot_execute_server_functions(db, fn):
    for role in ("anon", "authenticated"):
        assert not await db.fetchval("select has_function_privilege($1, $2, 'execute')", role, fn)


async def test_authenticated_cannot_read_tables_directly(db):
    for table in ("public.reel_content", "public.reels", "public.profiles"):
        assert not await db.fetchval("select has_table_privilege('authenticated', $1, 'select')",
                                     table)
