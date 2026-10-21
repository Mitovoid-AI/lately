"""has_paid_plan() and the save quota (save_reel() and the reels insert trigger)."""

import asyncpg
import pytest

from tests.billing.helpers import days, reel_url

pytestmark = pytest.mark.db


async def save(db, uid, code):
    url = reel_url(code)
    return await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $3)",
                             uid, url, url)


async def insert_reel(db, uid, code):
    """The trigger path: a reel inserted directly, not through save_reel()."""
    await db.execute(
        "insert into public.reels (auth_user_id, source_url, shortcode_key, status) "
        "values ($1, $2, $3, 'pending')", uid, reel_url(code), code)


@pytest.mark.parametrize("plan, expires, paid", [
    ("free", None, False),
    ("free", days(30), False),
    ("pro", None, True),
    ("pro", days(30), True),
    ("pro", days(-0.5), True),  # one day of slack for a late renewal webhook
    ("pro", days(-2), False),
    ("lifetime", None, True),
    ("lifetime", days(-400), True),
    (None, None, False),
])
async def test_has_paid_plan(db, plan, expires, paid):
    assert await db.fetchval("select public.has_paid_plan($1, $2)", plan, expires) is paid


async def test_pro_with_a_future_or_missing_expiry_has_no_cap(db, make_user, set_plan):
    for expires in (None, days(30)):
        uid = await make_user()
        await set_plan(uid, "pro", expires, limit=1)
        for code in ("P1", "P2", "P3"):
            assert (await save(db, uid, code))["deduped"] is False


async def test_an_expired_pro_is_capped_again_by_save_reel(db, make_user, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(-2), limit=1)  # lapsed beyond the slack
    await save(db, uid, "E1")
    with pytest.raises(asyncpg.RaiseError, match="QUOTA_EXCEEDED"):
        await save(db, uid, "E2")


async def test_an_expired_pro_is_capped_again_by_the_insert_trigger(db, make_user, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(-2), limit=1)
    await insert_reel(db, uid, "T1")
    with pytest.raises(asyncpg.RaiseError, match="QUOTA_EXCEEDED"):
        await insert_reel(db, uid, "T2")


async def test_a_pro_within_the_slack_is_not_capped(db, make_user, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(-0.5), limit=1)
    for code in ("S1", "S2"):
        await save(db, uid, code)
        await insert_reel(db, uid, code + "x")


async def test_renewing_lifts_the_cap_again(db, make_user, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(-2), limit=1)
    await save(db, uid, "R1")
    with pytest.raises(asyncpg.RaiseError, match="QUOTA_EXCEEDED"):
        await save(db, uid, "R2")
    await set_plan(uid, "pro", days(30), limit=1)  # a renewal arrives
    assert (await save(db, uid, "R2"))["deduped"] is False


async def test_lifetime_has_no_cap_whatever_the_expiry(db, make_user, set_plan):
    uid = await make_user()
    await set_plan(uid, "lifetime", days(-400), limit=1)
    for code in ("L1", "L2", "L3"):
        await save(db, uid, code)


async def test_billing_events_are_closed_to_client_roles(db):
    privileges = await db.fetchrow(
        "select has_table_privilege('anon', 'public.billing_events', 'select') as anon,"
        " has_table_privilege('authenticated', 'public.billing_events', 'select') as auth,"
        " has_table_privilege('authenticated', 'public.billing_events', 'insert') as write,"
        " (select relrowsecurity from pg_class where oid = 'public.billing_events'::regclass)"
        " as rls")
    assert dict(privileges) == {"anon": False, "auth": False, "write": False, "rls": True}
    assert await db.fetchval(
        "select has_function_privilege('authenticated',"
        " 'public.has_paid_plan(text, timestamptz)', 'execute')") is False


async def test_a_billing_event_id_is_unique(db):
    sql = ("insert into public.billing_events (id, type, payload) values ('dup', 'TEST', '{}')")
    await db.execute(sql)
    with pytest.raises(asyncpg.UniqueViolationError):
        await db.execute(sql)
