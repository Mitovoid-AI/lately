"""POST /webhooks/revenuecat without a RevenueCat REST key: the event's own fields decide."""

import asyncio
import hashlib
import hmac
import json
import time

import pytest

from app.config import settings
from tests.billing.helpers import WEBHOOK_AUTH, auth, days, reel_url

pytestmark = pytest.mark.db

SIGNING_SECRET = "whsec_test"
SIGNATURE_HEADER = "X-RevenueCat-Webhook-Signature"


def sign(raw: bytes, t: float | None = None, secret: str = SIGNING_SECRET) -> str:
    t = int(time.time() if t is None else t)
    return f"t={t},v1=" + hmac.new(
        secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()


async def events(db):
    return await db.fetch("select * from public.billing_events order by received_at")


# ------------------------------------------------------------------- guards --

async def test_webhook_is_disabled_without_a_configured_auth_value(client):
    r = await client.post("/webhooks/revenuecat", json={"event": {"id": "e", "type": "TEST"}},
                          headers={"Authorization": ""})
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


async def test_webhook_401_with_missing_or_wrong_auth(send, make_event, make_user, db):
    body = make_event("INITIAL_PURCHASE", await make_user())
    for bad in (None, "nope", WEBHOOK_AUTH + "x", WEBHOOK_AUTH[:-1], WEBHOOK_AUTH.upper()):
        r = await send(body, auth=bad)
        assert r.status_code == 401, bad
        assert r.json()["error"]["code"] == "UNAUTHORIZED"
        assert WEBHOOK_AUTH not in r.text
    assert await events(db) == []


async def test_a_user_jwt_does_not_open_the_webhook(send, make_event, make_user, jwt_for, db):
    uid = await make_user()
    r = await send(make_event("INITIAL_PURCHASE", uid), auth=f"Bearer {jwt_for(uid)}")
    assert r.status_code == 401
    assert await events(db) == []


@pytest.mark.parametrize("raw", [
    b"", b"not json", b"[]", b"null", b'{"api_version":"1.0"}', b'{"event":null}',
    b'{"event":[]}', b'{"event":"x"}', b'{"event":{"type":"TEST"}}',
    b'{"event":{"id":"e1"}}', b'{"event":{"id":"","type":"TEST"}}',
    b'{"event":{"id":7,"type":"TEST"}}', b'{"event":{"id":"e1","type":null}}', b"\xff\xfe",
])
async def test_webhook_400_on_a_malformed_body(send, db, raw):
    r = await send(raw=raw)
    assert r.status_code == 400 and r.json()["error"]["code"] == "BAD_REQUEST"
    assert await events(db) == []


async def test_signature_is_required_when_a_signing_secret_is_set(
        send, make_event, make_user, monkeypatch, profile):
    monkeypatch.setattr(settings(), "revenuecat_webhook_signing_secret", SIGNING_SECRET)
    uid = await make_user()
    raw = json.dumps(make_event("INITIAL_PURCHASE", uid, expires=days(30))).encode()

    for header in ("", "garbage", sign(raw, secret="other"),
                   sign(raw, t=time.time() - 400), sign(raw + b" ")):
        r = await send(raw=raw, headers={SIGNATURE_HEADER: header})
        assert r.status_code == 401, header
    assert (await profile(uid))["plan"] == "free"

    r = await send(raw=raw, headers={SIGNATURE_HEADER: sign(raw)})
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert (await profile(uid))["plan"] == "pro"


async def test_the_signature_does_not_replace_the_auth_value(
        send, make_event, make_user, monkeypatch):
    monkeypatch.setattr(settings(), "revenuecat_webhook_signing_secret", SIGNING_SECRET)
    raw = json.dumps(make_event("TEST", await make_user())).encode()
    r = await send(raw=raw, auth="wrong", headers={SIGNATURE_HEADER: sign(raw)})
    assert r.status_code == 401


# ------------------------------------------------------------------- events --

async def test_initial_purchase_grants_pro_and_lifts_the_save_cap(
        client, send, make_event, make_user, jwt_for, profile, set_plan, db):
    uid = await make_user()
    await set_plan(uid, "free", limit=1)
    h = auth(jwt_for(uid))
    assert (await client.post("/saves", json={"text": reel_url("B1")}, headers=h)
            ).status_code == 201
    capped = await client.post("/saves", json={"text": reel_url("B2")}, headers=h)
    assert capped.status_code == 429 and capped.json()["error"]["code"] == "QUOTA_EXCEEDED"

    end, at = days(365), days(0)
    body = make_event("INITIAL_PURCHASE", uid, expires=end, at=at, period_type="TRIAL")
    r = await send(body)
    assert r.status_code == 200 and r.json() == {"status": "ok"}

    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == end
    assert p["plan_changed_at"] == at
    for code in ("B2", "B3"):
        assert (await client.post("/saves", json={"text": reel_url(code)}, headers=h)
                ).status_code == 201
    (row,) = await events(db)
    assert row["id"] == body["event"]["id"] and row["type"] == "INITIAL_PURCHASE"
    assert row["app_user_id"] == str(uid) and row["environment"] == "PRODUCTION"
    assert row["processed_at"] is not None
    assert json.loads(row["payload"])["event"]["period_type"] == "TRIAL"


async def test_a_purchase_without_an_expiry_is_pro_with_no_end(
        send, make_event, make_user, profile):
    uid = await make_user()
    await send(make_event("NON_RENEWING_PURCHASE", uid, expires=None))
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] is None


async def test_expiration_revokes_pro(send, make_event, make_user, profile):
    uid = await make_user()
    await send(make_event("INITIAL_PURCHASE", uid, expires=days(-1), at=days(-30)))
    assert (await profile(uid))["plan"] == "pro"
    ended = days(-0.01)
    r = await send(make_event("EXPIRATION", uid, expires=ended, at=days(0)))
    assert r.status_code == 200
    p = await profile(uid)
    assert p["plan"] == "free" and p["plan_expires_at"] == ended


async def test_cancellation_keeps_pro_until_it_expires(send, make_event, make_user, profile):
    uid = await make_user()
    end = days(20)
    await send(make_event("INITIAL_PURCHASE", uid, expires=end, at=days(-10)))
    r = await send(make_event("CANCELLATION", uid, expires=end, at=days(-1),
                              cancel_reason="UNSUBSCRIBE"))
    assert r.status_code == 200
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == end


async def test_a_cancellation_that_already_ended_revokes_pro(
        send, make_event, make_user, profile):
    uid = await make_user()
    await send(make_event("INITIAL_PURCHASE", uid, expires=days(20), at=days(-10)))
    await send(make_event("CANCELLATION", uid, expires=days(-0.01), at=days(0),
                          cancel_reason="CUSTOMER_SUPPORT"))
    assert (await profile(uid))["plan"] == "free"


@pytest.mark.parametrize("kind", ["BILLING_ISSUE", "SUBSCRIPTION_PAUSED", "TEST",
                                  "SUBSCRIBER_ALIAS", "SOME_FUTURE_TYPE"])
async def test_events_that_change_nothing_are_recorded_and_acknowledged(
        send, make_event, make_user, profile, db, kind):
    uid = await make_user()
    end = days(20)
    await send(make_event("INITIAL_PURCHASE", uid, expires=end, at=days(-5)))
    r = await send(make_event(kind, uid, expires=days(-3), at=days(-1)))
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == end
    recorded = await events(db)
    assert {e["type"] for e in recorded} == {"INITIAL_PURCHASE", kind}
    assert all(e["processed_at"] is not None for e in recorded)


async def test_a_duplicate_event_id_is_not_processed_twice(
        send, make_event, make_user, profile, db):
    uid = await make_user()
    body = make_event("INITIAL_PURCHASE", uid, expires=days(30))
    assert (await send(body)).json() == {"status": "ok"}
    # Take the plan away behind its back: a second processing would give it back.
    await db.execute("update public.profiles set plan = 'free' where id = $1", uid)
    r = await send(body)
    assert r.status_code == 200 and r.json() == {"status": "duplicate"}
    assert (await profile(uid))["plan"] == "free"
    assert len(await events(db)) == 1


async def test_two_simultaneous_deliveries_of_one_event_process_it_once(
        send, make_event, make_user, profile, db):
    uid = await make_user()
    body = make_event("INITIAL_PURCHASE", uid, expires=days(30))
    first, second = await asyncio.gather(send(body), send(body))
    assert sorted([first.json()["status"], second.json()["status"]]) == ["duplicate", "ok"]
    assert (await profile(uid))["plan"] == "pro" and len(await events(db)) == 1


async def test_an_older_event_arriving_late_is_ignored(send, make_event, make_user, profile):
    uid = await make_user()
    newer_end, newer_at = days(60), days(-1)
    await send(make_event("RENEWAL", uid, expires=newer_end, at=newer_at))

    # Delivered out of order: sent before the renewal above.
    await send(make_event("RENEWAL", uid, expires=days(30), at=days(-20)))
    p = await profile(uid)
    assert p["plan"] == "pro" and p["plan_expires_at"] == newer_end
    assert p["plan_changed_at"] == newer_at

    await send(make_event("EXPIRATION", uid, expires=days(-20), at=days(-25)))
    assert (await profile(uid))["plan"] == "pro"

    await send(make_event("EXPIRATION", uid, expires=days(0), at=days(0)))  # newer: applies
    assert (await profile(uid))["plan"] == "free"


async def test_a_lifetime_plan_is_never_changed(send, make_event, make_user, profile, set_plan):
    uid = await make_user()
    await set_plan(uid, "lifetime")
    for kind in ("EXPIRATION", "INITIAL_PURCHASE", "RENEWAL"):
        r = await send(make_event(kind, uid, expires=days(-2), at=days(0)))
        assert r.status_code == 200
    p = await profile(uid)
    assert p["plan"] == "lifetime" and p["plan_expires_at"] is None


async def test_a_manual_grant_pinned_with_infinity_ignores_every_event(
        send, make_event, make_user, profile, db):
    uid = await make_user()
    await db.execute("update public.profiles set plan = 'pro', plan_changed_at = 'infinity' "
                     "where id = $1", uid)
    await send(make_event("EXPIRATION", uid, expires=days(-2), at=days(0)))
    assert (await profile(uid))["plan"] == "pro"


async def test_anonymous_and_unknown_ids_change_nothing(
        send, make_event, make_user, profile, db):
    uid = await make_user()
    profiles_before = await db.fetchval("select count(*) from public.profiles")
    anon = "$RCAnonymousID:0a1b2c3d4e5f"
    r = await send(make_event("INITIAL_PURCHASE", anon, expires=days(30), aliases=[anon]))
    assert r.status_code == 200
    ghost = "6f1c2b1e-0000-4000-8000-00000000dead"  # a UUID with no profile
    r = await send(make_event("INITIAL_PURCHASE", ghost, expires=days(30)))
    assert r.status_code == 200
    assert await db.fetchval("select count(*) from public.profiles") == profiles_before
    assert (await profile(uid))["plan"] == "free"
    # Still recorded, but without anything about the purchase: no account owns it.
    recorded = await events(db)
    assert len(recorded) == 2
    for row in recorded:
        assert row["app_user_id"] is None
        assert json.loads(row["payload"]) == {"event": {"id": row["id"], "type": row["type"]}}


async def test_an_event_after_the_account_was_deleted_keeps_no_payload(
        client, send, make_event, make_user, jwt_for, db):
    gone = await make_user()
    before = make_event("INITIAL_PURCHASE", gone, expires=days(30))
    assert (await send(before)).status_code == 200
    assert (await client.delete("/me", headers=auth(jwt_for(gone)))).status_code == 204

    # The Play subscription keeps renewing, and RevenueCat keeps telling us.
    after = make_event("RENEWAL", gone, expires=days(60), price=3.99, country_code="US",
                       transaction_id="GPA.1234-5678")
    r = await send(after)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    (row,) = await events(db)
    assert row["id"] == after["event"]["id"] and row["type"] == "RENEWAL"
    assert row["app_user_id"] is None and row["processed_at"] is not None
    assert "GPA.1234-5678" not in row["payload"] and str(gone) not in row["payload"]
    assert (await send(after)).json() == {"status": "duplicate"}  # redelivery still a no-op


async def test_aliases_and_the_original_id_resolve_to_the_account(
        send, make_event, make_user, profile):
    anon = "$RCAnonymousID:0a1b2c3d4e5f"
    via_alias, via_original = await make_user(), await make_user()
    r = await send(make_event("INITIAL_PURCHASE", anon, expires=days(30),
                              aliases=[anon, str(via_alias)]))
    assert r.status_code == 200 and (await profile(via_alias))["plan"] == "pro"

    r = await send(make_event("INITIAL_PURCHASE", anon, expires=days(30), aliases=[anon],
                              original_app_user_id=str(via_original)))
    assert r.status_code == 200 and (await profile(via_original))["plan"] == "pro"


async def test_an_event_for_another_entitlement_changes_nothing(
        send, make_event, make_user, profile):
    uid = await make_user()
    await send(make_event("INITIAL_PURCHASE", uid, expires=days(30), entitlement_ids=["gold"]))
    assert (await profile(uid))["plan"] == "free"
    # RevenueCat sends null for a product mapped to no entitlement: nothing to unlock,
    # even when the event has no expiry (a one-time purchase that would last forever).
    for ids in (None, []):
        await send(make_event("NON_RENEWING_PURCHASE", uid, expires=None, entitlement_ids=ids))
        await send(make_event("INITIAL_PURCHASE", uid, expires=days(30), entitlement_ids=ids))
    assert (await profile(uid))["plan"] == "free"
    await send(make_event("INITIAL_PURCHASE", uid, expires=days(30), entitlement_ids=["pro"]))
    assert (await profile(uid))["plan"] == "pro"


async def test_transfer_without_the_rest_key_only_removes_the_old_users_plan(
        send, make_event, make_user, profile, caplog):
    old, new = await make_user(), await make_user()
    await send(make_event("INITIAL_PURCHASE", old, expires=days(30), at=days(-5)))
    body = make_event("TRANSFER", None, at=days(0), transferred_from=[str(old)],
                      transferred_to=[str(new)], app_user_id=str(new))
    with caplog.at_level("WARNING", logger="app.services.billing"):
        r = await send(body)
    assert r.status_code == 200
    assert (await profile(old))["plan"] == "free"
    assert (await profile(new))["plan"] == "free"  # needs the REST key
    assert "REVENUECAT_SECRET_API_KEY" in caplog.text


async def test_sandbox_purchases_count_by_default(send, make_event, make_user, profile):
    uid = await make_user()
    await send(make_event("INITIAL_PURCHASE", uid, expires=days(7), environment="SANDBOX"))
    assert (await profile(uid))["plan"] == "pro"


async def test_sandbox_events_are_recorded_but_ignored_when_switched_off(
        send, make_event, make_user, profile, db, monkeypatch):
    monkeypatch.setattr(settings(), "revenuecat_allow_sandbox", False)
    uid = await make_user()
    r = await send(make_event("INITIAL_PURCHASE", uid, expires=days(7), environment="SANDBOX"))
    assert r.status_code == 200 and r.json() == {"status": "ignored"}
    assert (await profile(uid))["plan"] == "free"
    (row,) = await events(db)
    assert row["environment"] == "SANDBOX" and row["processed_at"] is not None

    r = await send(make_event("INITIAL_PURCHASE", uid, expires=days(7)))  # production
    assert r.json() == {"status": "ok"} and (await profile(uid))["plan"] == "pro"


async def test_the_dashboard_test_event_is_acknowledged(send, make_event, db):
    r = await send(make_event("TEST", "test-user-id", entitlement_ids=None))
    assert r.status_code == 200
    (row,) = await events(db)
    assert row["type"] == "TEST"
