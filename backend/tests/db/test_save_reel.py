"""save_reel(): the whole catch path in one RPC (PIPELINE.md §3)."""

import asyncio

import asyncpg
import pytest

pytestmark = pytest.mark.db
URL = "https://www.instagram.com/reel/C8xYz12/"


def reel_url(code: str) -> str:
    return f"https://www.instagram.com/reel/{code}/"


async def save(db, uid, url, rate_per_hour=30):
    return await db.fetchrow(
        "select * from public.save_reel($1, $2, 'app_share', $3, $4)", uid, url, url, rate_per_hour
    )


async def count_rows(db, uid):
    reels = await db.fetchval("select count(*) from public.reels where auth_user_id = $1", uid)
    jobs = await db.fetchval(
        "select count(*) from public.jobs where payload->>'user_id' = $1", str(uid))
    return reels, jobs


async def test_save_reel_first_save_for_new_auth_user(db, make_user):
    uid = await make_user()
    row = await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $3)", uid, URL, URL)
    assert row["deduped"] is False
    reel = await db.fetchrow("select * from public.reels where id = $1", row["reel_id"])
    assert reel["auth_user_id"] == uid and reel["status"] == "pending"
    assert reel["shortcode_key"] == "C8xYz12"
    assert await db.fetchval("select count(*) from public.jobs where payload->>'reel_id' = $1",
                             str(row["reel_id"])) == 1


async def test_save_reel_share_link_without_shortcode(db, make_user):
    uid = await make_user(); url = "https://www.instagram.com/share/AbCd12"
    row = await db.fetchrow("select * from public.save_reel($1,$2,'app_share',$3)", uid, url, url)
    reel = await db.fetchrow("select * from public.reels where id=$1", row["reel_id"])
    assert reel["shortcode_key"] is None and row["deduped"] is False


async def test_save_reel_duplicate_returns_same_id_deduped(db, make_user):
    uid = await make_user()
    first = await save(db, uid, URL)
    second = await save(db, uid, URL)
    assert second["reel_id"] == first["reel_id"]
    assert second["deduped"] is True
    assert await count_rows(db, uid) == (1, 1)


async def test_save_reel_concurrent_duplicates_one_row(db, make_user):
    uid = await make_user()
    rows = await asyncio.gather(*(save(db, uid, URL) for _ in range(5)))
    assert len({r["reel_id"] for r in rows}) == 1
    assert await count_rows(db, uid) == (1, 1)


async def test_save_reel_returns_inserted_id_not_latest(db, make_user):
    uid = await make_user()
    a = await save(db, uid, reel_url("AAA111"))
    # A row newer than the one being inserted (clock skew, backfill) must not
    # be mistaken for it.
    await db.execute("update public.reels set created_at = now() + interval '1 hour' "
                     "where id = $1", a["reel_id"])
    b = await save(db, uid, reel_url("BBB222"))
    b_id = await db.fetchval("select id from public.reels where auth_user_id = $1 "
                             "and shortcode_key = 'BBB222'", uid)
    assert b["reel_id"] == b_id != a["reel_id"]


async def test_save_reel_quota_exceeded(db, make_user):
    uid = await make_user()
    await db.execute("insert into public.profiles (id, saves_free_limit) values ($1, 2)", uid)
    await save(db, uid, reel_url("Q1"))
    await save(db, uid, reel_url("Q2"))
    with pytest.raises(asyncpg.RaiseError, match="QUOTA_EXCEEDED"):
        await save(db, uid, reel_url("Q3"))


async def test_save_reel_duplicate_at_quota_returns_deduped(db, make_user):
    uid = await make_user()
    await db.execute("insert into public.profiles (id, saves_free_limit) values ($1, 1)", uid)
    first = await save(db, uid, URL)
    again = await save(db, uid, URL)
    assert again["deduped"] is True and again["reel_id"] == first["reel_id"]


async def test_save_reel_rate_limited(db, make_user):
    uid = await make_user()
    await save(db, uid, reel_url("R1"), rate_per_hour=2)
    await save(db, uid, reel_url("R2"), rate_per_hour=2)
    with pytest.raises(asyncpg.RaiseError, match="RATE_LIMITED"):
        await save(db, uid, reel_url("R3"), rate_per_hour=2)


async def test_save_reel_bad_url(db, make_user):
    uid = await make_user()
    with pytest.raises(asyncpg.RaiseError, match="BAD_URL"):
        await save(db, uid, "https://example.com/x")
