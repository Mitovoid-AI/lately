"""POST /billing/sync: the app calls it right after a purchase or restore."""

import asyncio
from datetime import UTC, datetime

import httpx
import pytest

from app.config import settings
from app.services import billing
from tests.billing.helpers import RC_KEY, auth, days

pytestmark = pytest.mark.db


async def test_sync_401_without_a_token(client):
    assert (await client.post("/billing/sync")).status_code == 401


# --------------------------------------------------------- without the REST key

async def test_sync_without_the_key_reports_the_profile_as_it_is(
        client, make_user, jwt_for, set_plan, profile):
    uid = await make_user()
    h = auth(jwt_for(uid))
    r = await client.post("/billing/sync", headers=h)
    assert r.status_code == 200 and r.json() == {"plan": "free", "plan_expires_at": None}

    end, changed = days(10), days(-1)
    await set_plan(uid, "pro", end, changed=changed)
    r = await client.post("/billing/sync", headers=h)
    assert r.json()["plan"] == "pro"
    assert r.json()["plan_expires_at"].startswith(end.strftime("%Y-%m-%dT%H:%M:%S"))
    assert (await profile(uid))["plan_changed_at"] == changed  # a read, not a write


async def test_sync_reports_the_effective_plan(client, make_user, jwt_for, set_plan):
    uid = await make_user()
    h = auth(jwt_for(uid))

    await set_plan(uid, "pro", days(-2))  # lapsed beyond the one-day slack
    assert (await client.post("/billing/sync", headers=h)).json() == {
        "plan": "free", "plan_expires_at": None}

    await set_plan(uid, "pro", days(-0.1))  # a late renewal webhook is still allowed for
    assert (await client.post("/billing/sync", headers=h)).json()["plan"] == "pro"

    await set_plan(uid, "pro", None)
    assert (await client.post("/billing/sync", headers=h)).json() == {
        "plan": "pro", "plan_expires_at": None}

    await set_plan(uid, "lifetime", days(-90))
    assert (await client.post("/billing/sync", headers=h)).json() == {
        "plan": "lifetime", "plan_expires_at": None}


async def test_sync_never_calls_revenuecat_without_the_key(client, make_user, jwt_for):
    # The default test client refuses every RevenueCat call: a call would fail the test.
    r = await client.post("/billing/sync", headers=auth(jwt_for(await make_user())))
    assert r.status_code == 200


async def test_sync_rebuilds_a_missing_profile(client, db, make_auth_user, jwt_for):
    uid = await make_auth_user("syncer")
    await db.execute("delete from public.profiles where id = $1", uid)
    r = await client.post("/billing/sync", headers=auth(jwt_for(uid)))
    assert r.status_code == 200 and r.json()["plan"] == "free"


async def test_sync_404_when_the_account_is_gone(client, db, make_user, jwt_for):
    uid = await make_user()
    await db.execute("delete from auth.users where id = $1", uid)
    r = await client.post("/billing/sync", headers=auth(jwt_for(uid)))
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


# ------------------------------------------------------------ with the REST key

async def test_sync_with_the_key_applies_the_active_entitlement(
        client, rc, make_user, jwt_for, profile):
    uid = await make_user()
    end = days(7)  # a 7-day trial
    rc.grant(uid, end)
    r = await client.post("/billing/sync", headers=auth(jwt_for(uid)))
    assert r.status_code == 200
    assert r.json()["plan"] == "pro"
    assert r.json()["plan_expires_at"].startswith(end.strftime("%Y-%m-%dT%H:%M:%S"))
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == end and p["plan_changed_at"] is not None
    (call,) = rc.calls
    assert call.url.path == f"/v1/subscribers/{uid}"
    assert call.headers["authorization"] == f"Bearer {RC_KEY}"


async def test_sync_asks_about_the_caller_only(client, rc, make_user, jwt_for):
    me, other = await make_user(), await make_user()
    rc.grant(other, days(30))
    r = await client.post("/billing/sync", headers=auth(jwt_for(me)))
    assert r.json()["plan"] == "free"  # the other user's purchase is not mine
    assert rc.asked == [str(me)]


async def test_sync_with_the_key_downgrades_when_revenuecat_has_nothing(
        client, rc, make_user, jwt_for, set_plan, profile):
    uid = await make_user()
    await set_plan(uid, "pro", days(20), changed=days(-3))
    r = await client.post("/billing/sync", headers=auth(jwt_for(uid)))
    assert r.json() == {"plan": "free", "plan_expires_at": None}
    assert (await profile(uid))["plan"] == "free"


async def test_sync_with_the_key_never_changes_a_lifetime_plan(
        client, rc, make_user, jwt_for, set_plan):
    uid = await make_user()
    await set_plan(uid, "lifetime")
    r = await client.post("/billing/sync", headers=auth(jwt_for(uid)))
    assert r.json() == {"plan": "lifetime", "plan_expires_at": None}


async def test_sync_with_the_key_lifts_the_save_cap(
        client, rc, make_user, jwt_for, set_plan):
    uid = await make_user()
    await set_plan(uid, "free", limit=1)
    h = auth(jwt_for(uid))
    url = "https://www.instagram.com/reel/{}/"
    assert (await client.post("/saves", json={"text": url.format("S1")}, headers=h)
            ).status_code == 201
    assert (await client.post("/saves", json={"text": url.format("S2")}, headers=h)
            ).status_code == 429
    rc.grant(uid, days(365))
    assert (await client.post("/billing/sync", headers=h)).json()["plan"] == "pro"
    assert (await client.post("/saves", json={"text": url.format("S2")}, headers=h)
            ).status_code == 201


@pytest.mark.parametrize("failure", [
    {"status": 500}, {"status": 401}, {"error": httpx.ConnectError("down")},
    {"error": httpx.ReadTimeout("slow")},
])
async def test_sync_502_when_revenuecat_fails_and_the_plan_is_left_alone(
        client, rc, make_user, jwt_for, set_plan, profile, failure):
    uid = await make_user()
    end = days(20)
    await set_plan(uid, "pro", end, changed=days(-3))
    rc.status = failure.get("status", 200)
    rc.error = failure.get("error")
    r = await client.post("/billing/sync", headers=auth(jwt_for(uid)))
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "BILLING_UNAVAILABLE"
    assert RC_KEY not in r.text
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == end


async def test_sync_accepts_the_201_revenuecat_answers_for_a_new_customer(
        client, rc, make_user, jwt_for):
    uid = await make_user()
    rc.status = 201
    h = auth(jwt_for(uid))
    r = await client.post("/billing/sync", headers=h)
    assert r.status_code == 200 and r.json() == {"plan": "free", "plan_expires_at": None}
    rc.grant(uid, days(30))
    assert (await client.post("/billing/sync", headers=h)).json()["plan"] == "pro"


async def test_a_slow_sync_cannot_overwrite_a_newer_update(
        client, rc, make_user, jwt_for, profile, db, monkeypatch):
    """The sync's lookup overlaps a newer update (a webhook landing first): its reply
    is older than that update, so it must not take the plan back."""
    uid = await make_user()
    end = days(30)

    async def slow_handler(request):
        await asyncio.sleep(0.01)
        async with db.acquire() as con:
            await billing.apply_plan(con, uid, True, end, datetime.now(UTC))
        return httpx.Response(200, json={"subscriber": {"entitlements": {}, "subscriptions": {}}})

    monkeypatch.setattr(
        billing, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(slow_handler)))
    r = await client.post("/billing/sync", headers=auth(jwt_for(uid)))
    assert r.status_code == 200 and r.json()["plan"] == "pro"
    assert (await profile(uid))["plan_expires_at"] == end


# ------------------------------------------------------- the sandbox switch --

@pytest.mark.parametrize("allowed, sandbox, one_time, plan", [
    (True, True, False, "pro"),     # sandbox allowed: a license tester's subscription counts
    (False, True, False, "free"),   # switched off: it does not
    (False, False, False, "pro"),   # a real subscription always counts
    (False, None, False, "pro"),    # RevenueCat said nothing about the purchase: not locked out
    (False, True, True, "free"),    # a sandbox one-time purchase
    (False, False, True, "pro"),
])
async def test_sync_follows_the_sandbox_switch(
        client, rc, make_user, jwt_for, profile, monkeypatch, allowed, sandbox, one_time, plan):
    monkeypatch.setattr(settings(), "revenuecat_allow_sandbox", allowed)
    uid = await make_user()
    rc.grant(uid, None if one_time else days(7), sandbox=sandbox, one_time=one_time)
    r = await client.post("/billing/sync", headers=auth(jwt_for(uid)))
    assert r.status_code == 200 and r.json()["plan"] == plan
    assert (await profile(uid))["plan"] == plan


async def test_switching_sandbox_off_takes_back_a_test_purchase_on_the_next_sync(
        client, rc, make_user, jwt_for, monkeypatch):
    uid = await make_user()
    h = auth(jwt_for(uid))
    rc.grant(uid, days(7), sandbox=True)
    assert (await client.post("/billing/sync", headers=h)).json()["plan"] == "pro"
    monkeypatch.setattr(settings(), "revenuecat_allow_sandbox", False)
    assert (await client.post("/billing/sync", headers=h)).json() == {
        "plan": "free", "plan_expires_at": None}
