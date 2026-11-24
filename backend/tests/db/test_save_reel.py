"""save_reel(): the whole catch path in one RPC (PIPELINE.md §3)."""

import asyncio

import asyncpg
import pytest

from app.urls import is_saveable_link, normalize_shared_text, parse_shortcode

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
    await db.execute("insert into public.profiles (id, saves_free_limit) values ($1, 2) "
                     "on conflict (id) do update set saves_free_limit = excluded.saves_free_limit", uid)
    await save(db, uid, reel_url("Q1"))
    await save(db, uid, reel_url("Q2"))
    with pytest.raises(asyncpg.RaiseError, match="QUOTA_EXCEEDED"):
        await save(db, uid, reel_url("Q3"))


@pytest.mark.parametrize("plan", ["pro", "lifetime"])
async def test_paid_plans_have_no_monthly_cap(db, make_user, plan):
    uid = await make_user()
    await db.execute("insert into public.profiles (id, plan, saves_free_limit) values ($1, $2, 1) "
                     "on conflict (id) do update set plan = excluded.plan, "
                     "saves_free_limit = excluded.saves_free_limit", uid, plan)
    for code in ("P1", "P2", "P3"):
        row = await save(db, uid, reel_url(code))
        assert row["deduped"] is False
    assert await db.fetchval("select count(*) from public.reels where auth_user_id = $1", uid) == 3


async def test_save_reel_duplicate_at_quota_returns_deduped(db, make_user):
    uid = await make_user()
    await db.execute("insert into public.profiles (id, saves_free_limit) values ($1, 1) "
                     "on conflict (id) do update set saves_free_limit = excluded.saves_free_limit", uid)
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


# ---------------------------------------- 0014: link rule, profile lock, rate log

@pytest.mark.parametrize("text", [
    "https://www.instagram.com/reel/C8xYz12/",
    "instagram.com/reels/Dxyz_-9",
    "www.instagram.com/p/Cpost123/?igsh=abc",
    "https://www.instagram.com/tv/Ctv12345/",
    "https://www.instagram.com/delhi.foodtrails/reel/Cuser12/",
    "https://www.instagram.com/some_user/p/Cuser34/",
    "https://www.instagram.com/share/AbCd12",
    "https://www.instagram.com/share/reel/BAabc12/",
    "https://www.instagram.com/reels/audio/123456/",
    "https://www.instagram.com/delhi.foodtrails/",
    "https://www.instagram.com/stories/delhi.foodtrails/3456789/",
    "https://www.instagram.com/explore/tags/momos/",
])
async def test_sql_link_rule_agrees_with_python(db, make_user, text):
    uid = await make_user()
    url = normalize_shared_text(text)
    assert url is not None
    if not is_saveable_link(url):
        with pytest.raises(asyncpg.RaiseError, match="BAD_URL"):
            await save(db, uid, url)
        return
    row = await save(db, uid, url)
    assert row["deduped"] is False
    assert await db.fetchval("select shortcode_key from public.reels where id = $1",
                             row["reel_id"]) == parse_shortcode(url)


async def test_username_permalink_dedupes_with_the_plain_link(db, make_user):
    uid = await make_user()
    first = await save(db, uid, "https://www.instagram.com/delhi.foodtrails/reel/C8xYz12/")
    again = await save(db, uid, URL)
    assert again["deduped"] is True and again["reel_id"] == first["reel_id"]


async def test_rate_limit_counts_saves_that_were_deleted(db, make_user):
    uid = await make_user()
    for code in ("DEL1", "DEL2"):
        row = await save(db, uid, reel_url(code), rate_per_hour=2)
        await db.execute("delete from public.reels where id = $1", row["reel_id"])
    with pytest.raises(asyncpg.RaiseError, match="RATE_LIMITED"):
        await save(db, uid, reel_url("DEL3"), rate_per_hour=2)


async def _second_save_while_first_is_open(db, uid, first_url, second_url):
    """Save `first_url` in an open transaction, start saving `second_url` on another
    connection, then commit the first: what the second call returns (or raises)."""
    sql = "select * from public.save_reel($1, $2, 'app_share', $2, 30)"
    async with db.acquire() as c1, db.acquire() as c2:
        tx = c1.transaction()
        await tx.start()
        first = await c1.fetchrow(sql, uid, first_url)
        second = asyncio.create_task(c2.fetchrow(sql, uid, second_url))
        await asyncio.sleep(0.3)
        assert not second.done()  # held back until the first save commits
        await tx.commit()
        return first, await asyncio.gather(second, return_exceptions=True)


async def test_simultaneous_shares_of_one_reel_are_charged_once(db, make_user):
    uid = await make_user()
    first, (second,) = await _second_save_while_first_is_open(db, uid, URL, URL)
    assert first["deduped"] is False
    assert second["deduped"] is True and second["reel_id"] == first["reel_id"]
    assert await db.fetchval(
        "select count(*) from public.save_events where auth_user_id = $1", uid) == 1


async def test_simultaneous_saves_cannot_overrun_the_monthly_quota(db, make_user):
    uid = await make_user()
    await db.execute("insert into public.profiles (id, saves_free_limit) values ($1, 1) "
                     "on conflict (id) do update set saves_free_limit = excluded.saves_free_limit", uid)
    _, (second,) = await _second_save_while_first_is_open(
        db, uid, reel_url("RACE1"), reel_url("RACE2"))
    assert isinstance(second, asyncpg.RaiseError) and "QUOTA_EXCEEDED" in str(second)
    assert await db.fetchval("select count(*) from public.reels where auth_user_id = $1", uid) == 1
