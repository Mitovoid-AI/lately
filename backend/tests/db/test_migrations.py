"""Migrations apply from zero and leave the pipeline schema in place."""

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
