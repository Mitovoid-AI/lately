"""Migrations apply from zero and leave the pipeline schema in place."""

import asyncpg
import pytest

pytestmark = pytest.mark.db


async def test_pipeline_schema_exists(db):
    tables = {r["tablename"] for r in await db.fetch(
        "select tablename from pg_tables where schemaname = 'public'")}
    assert {"reels", "reel_content", "profiles", "jobs", "jobs_dead", "metrics"} <= tables
    fns = {r["proname"] for r in await db.fetch(
        "select proname from pg_proc where pronamespace = 'public'::regnamespace")}
    assert {"save_reel", "claim_job", "release_job"} <= fns
    cols = {r["column_name"] for r in await db.fetch(
        "select column_name from information_schema.columns "
        "where table_schema='public' and table_name='profiles'")}
    assert "saves_free_limit" in cols


async def test_fail_reason_takes_only_the_known_reasons(db, make_user):
    uid = await make_user()
    rid = await db.fetchval(
        "insert into public.reels (auth_user_id, source_url, shortcode_key, status) "
        "values ($1, 'https://www.instagram.com/reel/FR1/', 'FR1', 'partial') returning id", uid)
    for reason in ("fetch_blocked", "unavailable", "ai_unavailable", "timed_out", None):
        await db.execute("update public.reels set fail_reason = $2 where id = $1", rid, reason)
    with pytest.raises(asyncpg.CheckViolationError):
        await db.execute("update public.reels set fail_reason = 'gremlins' where id = $1", rid)
