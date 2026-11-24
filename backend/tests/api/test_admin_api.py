"""GET /admin/health — ops counters behind the X-Admin-Key header."""

import pytest

from app.config import settings
from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db
KEY = "test-admin-key"


@pytest.fixture
def admin_key(monkeypatch):
    monkeypatch.setattr(settings(), "admin_key", KEY)
    return KEY


async def test_health_is_disabled_without_a_configured_key(client, monkeypatch):
    monkeypatch.setattr(settings(), "admin_key", "")
    r = await client.get("/admin/health", headers={"X-Admin-Key": ""})
    assert r.status_code == 404


async def test_health_401_with_missing_or_wrong_key(client, admin_key):
    assert (await client.get("/admin/health")).status_code == 401
    r = await client.get("/admin/health", headers={"X-Admin-Key": "nope"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"


async def test_health_ignores_user_jwts(client, admin_key, make_user, jwt_for):
    r = await client.get("/admin/health",
                         headers={"Authorization": f"Bearer {jwt_for(await make_user())}"})
    assert r.status_code == 401


async def test_health_reports_queue_partials_latency_and_llm_calls(client, db, admin_key,
                                                                   make_user):
    uid = await make_user()
    await seed_card(db, uid, CARDS["MANALI1"], None)  # enriched, now
    await db.execute(
        "insert into public.reels (auth_user_id, source_url, shortcode_key, status) values "
        "($1, 'https://www.instagram.com/reel/P1/', 'P1', 'partial'),"
        "($1, 'https://www.instagram.com/reel/P2/', 'P2', 'pending')", uid)
    await db.execute(
        "insert into public.reels (auth_user_id, source_url, shortcode_key, status, created_at) "
        "values ($1, 'https://www.instagram.com/reel/OLD/', 'OLD', 'partial', "
        "now() - interval '3 days')", uid)
    await db.execute(
        "insert into public.jobs (payload) values ('{}'), ('{}');"
        "insert into public.jobs (payload, locked_at, locked_by) values ('{}', now(), 'w1');"
        "insert into public.jobs_dead (id, kind) values (gen_random_uuid(), 'enrich')")
    await db.execute(
        "insert into public.metrics (stage, duration_ms, outcome, at) "
        "select 'enrich', g * 100, 'ok', now() from generate_series(1, 20) g;"
        "insert into public.metrics (stage, duration_ms, outcome, at) values "
        "('structure', 900, 'ok', now()), ('structure', 800, 'ok', now()),"
        "('structure', 700, 'ok', now() - interval '2 days')")
    r = await client.get("/admin/health", headers={"X-Admin-Key": KEY})
    assert r.status_code == 200, r.text
    h = r.json()
    assert h["jobs_pending"] == 2  # unlocked; reels inserted directly enqueue nothing
    assert h["jobs_running"] == 1 and h["jobs_dead"] == 1
    assert h["partial_rate_24h"] == 0.5  # 1 partial of 2 finished saves in 24 h
    assert h["enrich_p95_ms"] == 1900
    assert h["stage_p95_ms"]["structure"] == 900 and h["stage_p95_ms"]["enrich"] == 1900
    assert h["llm_calls_today"] == 2


async def test_health_on_an_empty_database(client, db, admin_key):
    h = (await client.get("/admin/health", headers={"X-Admin-Key": KEY})).json()
    assert h["jobs_pending"] == 0 and h["jobs_dead"] == 0 and h["llm_calls_today"] == 0
    assert h["partial_rate_24h"] is None and h["enrich_p95_ms"] is None
    assert h["stage_p95_ms"] == {}


# ----------------------------------------------- dead-letter queue (GitHub #17)

async def _dead(db, kind="enrich", payload="{}", stage="fetch", failed_ago="0"):
    return await db.fetchval(
        "insert into public.jobs_dead (id, kind, payload, stage, attempts, last_error, failed_at) "
        "values (gen_random_uuid(), $1, $2::jsonb, $3, 3, 'provider down', "
        "now() - make_interval(mins => $4::int)) returning id", kind, payload, stage, int(failed_ago))


async def test_dead_job_endpoints_are_guarded_like_health(client, monkeypatch):
    monkeypatch.setattr(settings(), "admin_key", "")
    assert (await client.get("/admin/jobs/dead")).status_code == 404
    path = "/admin/jobs/dead/00000000-0000-0000-0000-000000000000/redrive"
    assert (await client.post(path)).status_code == 404
    monkeypatch.setattr(settings(), "admin_key", KEY)
    for r in (await client.get("/admin/jobs/dead", headers={"X-Admin-Key": "nope"}),
              await client.post(path)):
        assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"


async def test_dead_jobs_are_listed_newest_first(client, db, admin_key, make_user):
    rid = await db.fetchval(
        "insert into public.reels (auth_user_id, source_url, shortcode_key, status) values "
        "($1, 'https://www.instagram.com/reel/D1/', 'D1', 'partial') returning id",
        await make_user())
    old = await _dead(db, kind="export", payload='{"user_id": "u"}', stage="export",
                      failed_ago="60")
    new = await _dead(db, payload=f'{{"reel_id": "{rid}"}}')
    r = await client.get("/admin/jobs/dead", headers={"X-Admin-Key": KEY})
    assert r.status_code == 200
    rows = r.json()
    assert [x["id"] for x in rows] == [str(new), str(old)]
    assert set(rows[0]) == {"id", "kind", "stage", "last_error", "failed_at", "reel_id"}
    assert rows[0]["kind"] == "enrich" and rows[0]["stage"] == "fetch"
    assert rows[0]["reel_id"] == str(rid) and rows[0]["last_error"] == "provider down"
    assert rows[1]["reel_id"] is None
    limited = await client.get("/admin/jobs/dead", params={"limit": 1}, headers={"X-Admin-Key": KEY})
    assert [x["id"] for x in limited.json()] == [str(new)]


async def test_redrive_puts_the_job_back_to_run_now(client, db, admin_key, make_user):
    rid = await db.fetchval(
        "insert into public.reels (auth_user_id, source_url, shortcode_key, status, fail_reason) "
        "values ($1, 'https://www.instagram.com/reel/D2/', 'D2', 'partial', 'unavailable') "
        "returning id", await make_user())
    dead = await _dead(db, payload=f'{{"reel_id": "{rid}", "shortcode": "D2"}}', stage="structure")
    r = await client.post(f"/admin/jobs/dead/{dead}/redrive", headers={"X-Admin-Key": KEY})
    assert r.status_code == 202 and r.json() == {"status": "queued"}
    job = await db.fetchrow("select *, run_at <= now() as due from public.jobs where id = $1", dead)
    assert job["kind"] == "enrich" and job["stage"] == "structure" and job["attempts"] == 0
    assert job["due"] and job["locked_at"] is None
    assert await db.fetchval("select count(*) from public.jobs_dead") == 0
    save = await db.fetchrow("select status, fail_reason from public.reels where id = $1", rid)
    assert save["status"] == "pending" and save["fail_reason"] is None
    # Gone from the dead letters now: a second redrive is a 404.
    r = await client.post(f"/admin/jobs/dead/{dead}/redrive", headers={"X-Admin-Key": KEY})
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
