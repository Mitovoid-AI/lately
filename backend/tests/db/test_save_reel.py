"""save_reel(): the whole catch path in one RPC (PIPELINE.md §3)."""

import pytest

pytestmark = pytest.mark.db
URL = "https://www.instagram.com/reel/C8xYz12/"


async def test_save_reel_first_save_for_new_auth_user(db, make_user):
    uid = await make_user()
    row = await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $3)", uid, URL, URL)
    assert row["deduped"] is False
    reel = await db.fetchrow("select * from public.reels where id = $1", row["reel_id"])
    assert reel["auth_user_id"] == uid and reel["status"] == "pending"
    assert reel["shortcode_key"] == "C8xYz12"
    assert await db.fetchval("select count(*) from public.jobs where payload->>'reel_id' = $1",
                             str(row["reel_id"])) == 1
