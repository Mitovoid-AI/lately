"""Provider budget (migration 0007): atomic per-minute / per-day token buckets."""

import asyncio

import pytest

from app.enrich.budget import take_token

pytestmark = pytest.mark.db


async def test_schema_has_budget_and_new_content_columns(db):
    cols = {r["column_name"] for r in await db.fetch(
        "select column_name from information_schema.columns "
        "where table_schema='public' and table_name='reel_content'")}
    assert {"fetch_source", "duration_s", "fetch_meta"} <= cols
    assert await db.fetchval("select to_regclass('public.provider_budget')") is not None


async def test_unknown_provider_is_unlimited(db):
    assert await take_token(db, "nobody") == 0


async def test_per_minute_budget_exhausts_then_reports_wait(db):
    await db.execute("insert into public.provider_budget (provider, per_minute, per_day) "
                     "values ('llm', 2, 100)")
    assert await take_token(db, "llm") == 0
    assert await take_token(db, "llm") == 0
    wait = await take_token(db, "llm")
    assert 1 <= wait <= 60
    assert await db.fetchval("select used from public.provider_budget") == 2


async def test_per_day_budget(db):
    await db.execute("insert into public.provider_budget (provider, per_minute, per_day) "
                     "values ('groq', 100, 1)")
    assert await take_token(db, "groq") == 0
    assert await take_token(db, "groq") > 60


async def test_minute_window_rolls_over(db):
    await db.execute(
        "insert into public.provider_budget (provider, per_minute, per_day, window_start, used, "
        "day_start, day_used) values ('llm', 1, 100, now() - interval '2 minutes', 1, now(), 1)")
    assert await take_token(db, "llm") == 0


async def test_concurrent_takes_never_overspend(db):
    await db.execute("insert into public.provider_budget (provider, per_minute, per_day) "
                     "values ('ig', 3, 100)")
    results = await asyncio.gather(*(take_token(db, "ig") for _ in range(8)))
    assert sum(1 for r in results if r == 0) == 3
