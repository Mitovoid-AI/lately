"""0006: stacks, stack membership and reading preferences."""

import json

import asyncpg
import pytest

from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db


async def test_app_tables_exist_with_rls(db):
    rows = await db.fetch(
        "select relname, relrowsecurity from pg_class "
        "where relnamespace = 'public'::regnamespace and relname = any($1)",
        ["stacks", "stack_saves", "preferences"])
    assert {r["relname"]: r["relrowsecurity"] for r in rows} == {
        "stacks": True, "stack_saves": True, "preferences": True}


async def test_clients_cannot_read_app_tables_directly(db, make_user):
    a = await make_user()
    await db.execute("insert into public.stacks (auth_user_id, name) values ($1, 'x')", a)
    for role in ("anon", "authenticated"):
        for table in ("stacks", "stack_saves", "preferences"):
            async with db.acquire() as conn, conn.transaction():
                await conn.execute(f"set local role {role}")
                await conn.execute("select set_config('request.jwt.claims', $1, true)",
                                   json.dumps({"sub": str(a), "role": role}))
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await conn.fetch(f"select * from public.{table}")


async def test_membership_change_bumps_stack_updated_at(db, make_user):
    a = await make_user()
    sid = await db.fetchval(
        "insert into public.stacks (auth_user_id, name, updated_at) "
        "values ($1, 'Trips', now() - interval '1 day') returning id", a)
    reel = await seed_card(db, a, CARDS["MANALI1"], None)
    await db.execute("insert into public.stack_saves (stack_id, reel_id) values ($1, $2)", sid, reel)
    assert await db.fetchval(
        "select updated_at > now() - interval '1 minute' from public.stacks where id = $1", sid)


async def test_deleting_a_save_or_user_cascades(db, make_user):
    a = await make_user()
    sid = await db.fetchval(
        "insert into public.stacks (auth_user_id, name) values ($1, 'Trips') returning id", a)
    reel = await seed_card(db, a, CARDS["MANALI1"], None)
    await db.execute("insert into public.stack_saves (stack_id, reel_id) values ($1, $2)", sid, reel)
    await db.execute("insert into public.preferences (auth_user_id) values ($1)", a)
    await db.execute("delete from public.reels where id = $1", reel)
    assert await db.fetchval("select count(*) from public.stack_saves") == 0
    await db.execute("delete from auth.users where id = $1", a)
    assert await db.fetchval("select count(*) from public.stacks") == 0
    assert await db.fetchval("select count(*) from public.preferences") == 0


async def test_preferences_reject_values_outside_the_contract(db, make_user):
    a = await make_user()
    with pytest.raises(asyncpg.CheckViolationError):
        await db.execute(
            "insert into public.preferences (auth_user_id, text_size) values ($1, 15)", a)
