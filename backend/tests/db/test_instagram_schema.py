"""Migration 0016 (Instagram DM door): tables locked to the service role, one link
and one code per user, cascades from auth.users, and safe to run twice."""

from pathlib import Path

import asyncpg
import pytest

pytestmark = pytest.mark.db

TABLES = ("instagram_links", "instagram_link_codes", "instagram_messages")
MIGRATION = Path(__file__).resolve().parents[3] / "supabase/migrations/0016_instagram_dm.sql"


async def test_tables_have_rls_and_no_client_access(db):
    for table in TABLES:
        row = await db.fetchrow(
            "select (select relrowsecurity from pg_class where oid = $1::regclass) as rls,"
            " has_table_privilege('anon', $1, 'select') as anon_read,"
            " has_table_privilege('authenticated', $1, 'select') as auth_read,"
            " has_table_privilege('authenticated', $1, 'insert,update,delete') as auth_write",
            f"public.{table}")
        assert dict(row) == {"rls": True, "anon_read": False, "auth_read": False,
                             "auth_write": False}, table


async def test_one_link_and_one_code_per_user(db, make_user):
    uid = await make_user()
    await db.execute("insert into public.instagram_links (ig_user_id, auth_user_id) "
                     "values ('1', $1)", uid)
    with pytest.raises(asyncpg.UniqueViolationError):
        await db.execute("insert into public.instagram_links (ig_user_id, auth_user_id) "
                         "values ('2', $1)", uid)
    await db.execute("insert into public.instagram_link_codes (code, auth_user_id, expires_at) "
                     "values ('LATELY-AAAAAA', $1, now())", uid)
    with pytest.raises(asyncpg.UniqueViolationError):
        await db.execute("insert into public.instagram_link_codes (code, auth_user_id, "
                         "expires_at) values ('LATELY-BBBBBB', $1, now())", uid)


async def test_deleting_the_user_or_the_save_cleans_up(db, make_user):
    uid = await make_user()
    rid = await db.fetchval(
        "select reel_id from public.save_reel($1, $2, 'meta_dm', $2)",
        uid, "https://www.instagram.com/reel/SCHEMA1/")
    await db.execute("insert into public.instagram_links (ig_user_id, auth_user_id, last_save_id,"
                     " last_save_at) values ('1', $1, $2, now())", uid, rid)
    await db.execute("insert into public.instagram_link_codes (code, auth_user_id, expires_at) "
                     "values ('LATELY-CCCCCC', $1, now())", uid)

    await db.execute("delete from public.reels where id = $1", rid)
    assert await db.fetchval(
        "select last_save_id from public.instagram_links where ig_user_id = '1'") is None

    await db.execute("delete from auth.users where id = $1", uid)
    for table in ("instagram_links", "instagram_link_codes"):
        assert await db.fetchval(f"select count(*) from public.{table}") == 0, table


async def test_dm_saves_are_stored_as_the_legacy_channel(db, make_user):
    """0002's check allows app | telegram | web; save_reel() stores meta_dm as
    telegram and services/saves_view.py reads it back as meta_dm."""
    uid = await make_user()
    rid = await db.fetchval("select reel_id from public.save_reel($1, $2, 'meta_dm', $2)",
                            uid, "https://www.instagram.com/reel/CHAN1/")
    assert await db.fetchval(
        "select source_channel from public.reels where id = $1", rid) == "telegram"


async def test_the_migration_runs_again_cleanly(db):
    async with db.acquire() as con, con.transaction():
        await con.execute(MIGRATION.read_text(encoding="utf-8"))
    for table in TABLES:
        assert await db.fetchval("select to_regclass($1) is not null", f"public.{table}")
