"""POST /webhooks/revenuecat with REVENUECAT_SECRET_API_KEY set: the backend asks
RevenueCat (a fake here) for the truth instead of trusting the event's fields."""

import asyncio
from datetime import UTC, datetime

import httpx
import pytest

from app.config import settings
from app.deps import pool
from app.services import billing
from tests.billing.helpers import RC_KEY, days, iso_z

pytestmark = pytest.mark.db


async def events(db):
    return await db.fetch("select * from public.billing_events")


async def test_the_entitlement_comes_from_revenuecat_not_the_event(
        send, rc, make_event, make_user, profile):
    uid = await make_user()
    end = days(30)
    rc.grant(uid, end)
    # The event claims an expiry it does not have; RevenueCat's answer wins.
    r = await send(make_event("INITIAL_PURCHASE", uid, expires=days(2)))
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == end


async def test_rest_calls_carry_the_secret_key_and_the_user_id(send, rc, make_event, make_user):
    uid = await make_user()
    rc.grant(uid, days(30))
    await send(make_event("RENEWAL", uid, expires=days(30)))
    (call,) = rc.calls
    assert call.method == "GET" and call.url.path == f"/v1/subscribers/{uid}"
    assert call.url.host == "rc.test"
    assert call.headers["authorization"] == f"Bearer {RC_KEY}"


async def test_an_event_that_says_pro_but_revenuecat_says_no_stays_free(
        send, rc, make_event, make_user, profile):
    uid = await make_user()
    await send(make_event("INITIAL_PURCHASE", uid, expires=days(30)))
    assert (await profile(uid))["plan"] == "free"


async def test_an_expiration_event_does_not_revoke_an_entitlement_revenuecat_still_has(
        send, rc, make_event, make_user, profile, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(-2), changed=days(-40))
    rc.grant(uid, days(300))  # renewed elsewhere (or the events arrived out of order)
    await send(make_event("EXPIRATION", uid, expires=days(-2)))
    assert (await profile(uid))["plan"] == "pro"


async def test_any_event_type_resyncs_including_a_cancellation_after_expiry(
        send, rc, make_event, make_user, profile, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(30), changed=days(-40))
    rc.entitlements.clear()  # refunded: RevenueCat no longer has the entitlement
    await send(make_event("CANCELLATION", uid, expires=days(30)))
    assert (await profile(uid))["plan"] == "free"


async def test_an_entitlement_that_ended_reads_as_free(
        send, rc, make_event, make_user, profile, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(5), changed=days(-40))
    ended = days(-3)
    rc.grant(uid, ended)
    await send(make_event("EXPIRATION", uid))
    p = await profile(uid)
    assert p["plan"] == "free" and p["plan_expires_at"] == ended


async def test_a_lifetime_entitlement_has_no_expiry(send, rc, make_event, make_user, profile):
    uid = await make_user()
    rc.grant(uid, None)
    await send(make_event("NON_RENEWING_PURCHASE", uid))
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] is None


async def test_the_billing_grace_period_keeps_pro_on(send, rc, make_event, make_user, profile):
    uid = await make_user()
    grace = days(3)
    rc.grant(uid, days(-1), grace_period_expires_date=iso_z(grace))
    await send(make_event("BILLING_ISSUE", uid))
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == grace


async def test_a_lifetime_plan_is_never_changed_by_revenuecat(
        send, rc, make_event, make_user, profile, set_plan):
    uid = await make_user()
    await set_plan(uid, "lifetime")
    await send(make_event("EXPIRATION", uid))  # RevenueCat has nothing for this user
    assert (await profile(uid))["plan"] == "lifetime"


async def test_transfer_decides_both_users_from_revenuecat(
        send, rc, make_event, make_user, profile, set_plan):
    old, new = await make_user(), await make_user()
    await set_plan(old, "pro", days(30), changed=days(-5))
    rc.grant(new, days(30))  # the purchase now belongs to `new`
    body = make_event("TRANSFER", None, transferred_from=[str(old)],
                      transferred_to=[str(new)], app_user_id=str(new))
    r = await send(body)
    assert r.status_code == 200
    assert (await profile(old))["plan"] == "free"
    assert (await profile(new))["plan"] == "pro"
    assert sorted(rc.asked) == sorted([str(old), str(new)])


async def test_only_real_accounts_are_looked_up(send, rc, make_event, make_user, profile):
    uid = await make_user()
    anon = "$RCAnonymousID:0a1b2c3d4e5f"
    ghost = "6f1c2b1e-0000-4000-8000-00000000dead"
    rc.grant(uid, days(30))
    await send(make_event("INITIAL_PURCHASE", anon, aliases=[anon, ghost, str(uid)]))
    assert rc.asked == [str(uid)]
    assert (await profile(uid))["plan"] == "pro"


async def test_an_event_naming_no_account_makes_no_call(send, rc, make_event):
    r = await send(make_event("INITIAL_PURCHASE", "$RCAnonymousID:abc"))
    assert r.status_code == 200 and rc.calls == []


@pytest.mark.parametrize("failure", [
    {"status": 500}, {"status": 429}, {"status": 401},
    {"error": httpx.ConnectError("down")}, {"error": httpx.ReadTimeout("slow")},
])
async def test_when_revenuecat_fails_the_event_is_rolled_back_and_retried(
        send, rc, make_event, make_user, profile, db, failure):
    uid = await make_user()
    rc.grant(uid, days(30))
    rc.status = failure.get("status", 200)
    rc.error = failure.get("error")
    body = make_event("INITIAL_PURCHASE", uid, expires=days(30))

    r = await send(body)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "BILLING_UNAVAILABLE"
    assert RC_KEY not in r.text
    assert await events(db) == []  # not stored, so RevenueCat's retry is processed
    assert (await profile(uid))["plan"] == "free"

    rc.status, rc.error = 200, None  # RevenueCat is back; same event id redelivered
    r = await send(body)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert (await profile(uid))["plan"] == "pro"
    assert len(await events(db)) == 1


async def test_one_failing_lookup_defers_the_whole_event(
        send, rc, make_event, make_user, profile, db, monkeypatch):
    first, second = await make_user(), await make_user()
    rc.grant(first, days(30))

    def handler(request):
        if request.url.path.endswith(str(second)):
            raise httpx.ConnectError("down")
        return rc.handler(request)

    monkeypatch.setattr(
        billing, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    r = await send(make_event("TRANSFER", None, transferred_from=[str(first)],
                              transferred_to=[str(second)]))
    assert r.status_code == 503
    assert (await profile(first))["plan"] == "free" and await events(db) == []


@pytest.mark.parametrize("body", [
    {"subscriber": {}}, {"nothing": 1}, {"subscriber": {"entitlements": []}},
    {"subscriber": {"entitlements": {"pro": {"expires_date": "not a date"}}}},
])
async def test_an_unreadable_revenuecat_reply_is_a_retry_not_a_revoke(
        send, rc, make_event, make_user, profile, set_plan, monkeypatch, body):
    uid = await make_user()
    await set_plan(uid, "pro", days(30), changed=days(-5))
    monkeypatch.setattr(billing, "_client", lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body))))
    r = await send(make_event("EXPIRATION", uid))
    assert r.status_code == 503
    assert (await profile(uid))["plan"] == "pro"


# ------------------------------------------------- the connection pool stays free --

async def test_no_pooled_connection_is_held_while_revenuecat_is_asked(
        send, rc, make_event, make_user, profile, monkeypatch):
    uid = await make_user()
    rc.grant(uid, days(30))
    busy: list[int] = []

    def handler(request):
        busy.append(pool().get_size() - pool().get_idle_size())  # connections checked out now
        return rc.handler(request)

    monkeypatch.setattr(
        billing, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    r = await send(make_event("INITIAL_PURCHASE", uid, expires=days(30)))
    assert r.status_code == 200
    assert busy == [0]  # the lookup is not made inside the transaction
    assert (await profile(uid))["plan"] == "pro"


async def test_a_redelivered_event_makes_no_revenuecat_call(send, rc, make_event, make_user):
    uid = await make_user()
    rc.grant(uid, days(30))
    body = make_event("INITIAL_PURCHASE", uid, expires=days(30))
    assert (await send(body)).json() == {"status": "ok"}
    assert len(rc.calls) == 1
    assert (await send(body)).json() == {"status": "duplicate"}
    assert len(rc.calls) == 1


async def test_a_slow_lookup_cannot_overwrite_a_newer_update(
        send, rc, make_event, make_user, profile, db, monkeypatch):
    """A webhook's lookup that overlaps a newer update (here, the app's sync landing
    first) carries the state from before it, so it must not win."""
    uid = await make_user()
    end = days(30)

    async def slow_handler(request):
        await asyncio.sleep(0.01)
        # The purchase is synced while RevenueCat is still answering the webhook's lookup.
        async with db.acquire() as con:
            await billing.apply_plan(con, uid, True, end, datetime.now(UTC))
        return httpx.Response(200, json={"subscriber": {"entitlements": {}, "subscriptions": {}}})

    monkeypatch.setattr(
        billing, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(slow_handler)))
    r = await send(make_event("EXPIRATION", uid))
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == end


# ------------------------------------------------------- RevenueCat answers 201 --

@pytest.mark.parametrize("granted, plan", [(False, "free"), (True, "pro")])
async def test_a_201_reply_is_a_normal_answer(
        send, rc, make_event, make_user, profile, granted, plan):
    # RevenueCat creates the customer on a first lookup and says so with 201.
    uid = await make_user()
    if granted:
        rc.grant(uid, days(30))
    rc.status = 201
    r = await send(make_event("INITIAL_PURCHASE", uid, expires=days(30)))
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert (await profile(uid))["plan"] == plan


# ------------------------------------------------------- the sandbox switch --

async def test_a_sandbox_entitlement_is_not_trusted_when_sandbox_is_switched_off(
        send, rc, make_event, make_user, profile, set_plan, monkeypatch):
    monkeypatch.setattr(settings(), "revenuecat_allow_sandbox", False)
    tester, buyer = await make_user(), await make_user()
    rc.grant(tester, days(7), sandbox=True)
    rc.grant(buyer, days(30), sandbox=False)
    await set_plan(tester, "pro", days(7), changed=days(-3))  # granted while sandbox counted

    # A production event for a user whose entitlement is a license tester's purchase.
    r = await send(make_event("RENEWAL", tester, expires=days(7)))
    assert r.status_code == 200
    assert (await profile(tester))["plan"] == "free"
    await send(make_event("INITIAL_PURCHASE", buyer, expires=days(30)))
    assert (await profile(buyer))["plan"] == "pro"


async def test_a_sandbox_event_is_ignored_without_asking_revenuecat_when_switched_off(
        send, rc, make_event, make_user, profile, monkeypatch):
    monkeypatch.setattr(settings(), "revenuecat_allow_sandbox", False)
    uid = await make_user()
    rc.grant(uid, days(7), sandbox=True)
    r = await send(make_event("INITIAL_PURCHASE", uid, expires=days(7), environment="SANDBOX"))
    assert r.json() == {"status": "ignored"} and rc.calls == []
    assert (await profile(uid))["plan"] == "free"


async def test_a_sandbox_entitlement_counts_while_sandbox_is_allowed(
        send, rc, make_event, make_user, profile):
    uid = await make_user()
    rc.grant(uid, days(7), sandbox=True)
    await send(make_event("INITIAL_PURCHASE", uid, expires=days(7), environment="SANDBOX"))
    assert (await profile(uid))["plan"] == "pro"
