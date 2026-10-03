"""RLS is the backstop for any direct client access (BACKEND.md §4)."""

import json

import asyncpg
import pytest

pytestmark = pytest.mark.db


async def test_rls_authenticated_role_sees_only_own_reels(db, make_user):
    a, b = await make_user(), await make_user()
    for uid, code in ((a, "RLSA"), (b, "RLSB")):
        url = f"https://www.instagram.com/reel/{code}/"
        await db.execute("select public.save_reel($1, $2, 'app_share', $2)", uid, url)
    async with db.acquire() as conn, conn.transaction():
        await conn.execute("set local role authenticated")
        await conn.execute("select set_config('request.jwt.claims', $1, true)",
                           json.dumps({"sub": str(a), "role": "authenticated"}))
        assert await conn.fetchval("select count(*) from public.reels") == 1
        assert await conn.fetchval("select auth_user_id from public.reels") == a
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await conn.execute(
                "insert into public.reels (auth_user_id, source_url) "
                "values ($1, 'https://www.instagram.com/reel/X/')", b)
