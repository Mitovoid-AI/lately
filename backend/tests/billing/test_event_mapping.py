"""What an event means on its own (no RevenueCat REST key), and which ids it names.
Pure functions: no database."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.services.billing import PlanChange, plan_changes_from_event, user_ids_in
from tests.billing.helpers import ms

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)
A, B = uuid4(), uuid4()


def event(kind, **fields):
    return {"id": "e1", "type": kind, "app_user_id": str(A), "original_app_user_id": str(A),
            "aliases": [str(A)], "entitlement_ids": ["pro"], **fields}


def changes(ev, entitlement="pro"):
    return plan_changes_from_event(ev, entitlement, NOW)


@pytest.mark.parametrize("kind", ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION",
                                  "NON_RENEWING_PURCHASE", "PRODUCT_CHANGE",
                                  "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT"])
def test_grant_events_give_pro_until_the_event_expiry(kind):
    end = NOW + timedelta(days=30)
    assert changes(event(kind, expiration_at_ms=ms(end))) == [PlanChange(A, True, end)]


def test_a_grant_without_expiry_never_expires():
    assert changes(event("NON_RENEWING_PURCHASE", expiration_at_ms=None)) == [
        PlanChange(A, True, None)]


def test_a_grant_with_an_unreadable_expiry_is_ignored_not_read_as_forever():
    assert changes(event("RENEWAL", expiration_at_ms="soon")) == []
    assert changes(event("RENEWAL", expiration_at_ms=True)) == []


def test_expiration_revokes():
    end = NOW - timedelta(minutes=1)
    assert changes(event("EXPIRATION", expiration_at_ms=ms(end))) == [PlanChange(A, False, end)]


@pytest.mark.parametrize("kind", ["BILLING_ISSUE", "SUBSCRIPTION_PAUSED", "TEST",
                                  "INVOICE_ISSUANCE", "SOMETHING_NEW", None])
def test_other_events_change_nothing(kind):
    assert changes(event(kind, expiration_at_ms=ms(NOW + timedelta(days=1)))) == []


def test_cancellation_keeps_pro_until_expiry():
    assert changes(event("CANCELLATION", expiration_at_ms=ms(NOW + timedelta(days=9)))) == []
    assert changes(event("CANCELLATION", expiration_at_ms=None)) == []


def test_a_cancellation_whose_period_already_ended_revokes():
    ended = NOW - timedelta(hours=1)  # a refund
    assert changes(event("CANCELLATION", expiration_at_ms=ms(ended))) == [
        PlanChange(A, False, ended)]


def test_only_the_configured_entitlement_counts():
    grant = event("INITIAL_PURCHASE", expiration_at_ms=ms(NOW), entitlement_ids=["gold"])
    assert changes(grant) == []
    assert changes(grant, entitlement="gold") == [PlanChange(A, True, NOW)]
    assert changes(event("EXPIRATION", entitlement_ids=["gold"])) == []
    assert len(changes(event("INITIAL_PURCHASE", entitlement_ids=["gold", "pro"]))) == 1


@pytest.mark.parametrize("kind", ["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE", "RENEWAL",
                                  "EXPIRATION", "CANCELLATION"])
def test_a_product_mapped_to_no_entitlement_changes_nothing(kind):
    # RevenueCat sends entitlement_ids = null for such a product: "no entitlement", not
    # "any". Read as a grant with no expiry it would hand out Pro forever.
    gone = ms(NOW - timedelta(hours=1))
    for ids in (None, []):
        assert changes(event(kind, entitlement_ids=ids, expiration_at_ms=None)) == []
        assert changes(event(kind, entitlement_ids=ids, expiration_at_ms=gone)) == []


def test_a_payload_without_entitlement_ids_falls_back_to_the_older_entitlement_id():
    older = event("INITIAL_PURCHASE", entitlement_id="pro", expiration_at_ms=ms(NOW))
    del older["entitlement_ids"]
    assert changes(older) == [PlanChange(A, True, NOW)]
    assert changes(older | {"entitlement_id": "gold"}) == []
    assert changes(older | {"entitlement_id": None}) == []
    del older["entitlement_id"]
    assert changes(older) == []


def test_every_user_the_event_names_gets_the_change():
    anon = "$RCAnonymousID:0123456789abcdef"
    ev = event("INITIAL_PURCHASE", app_user_id=anon, original_app_user_id=anon,
               aliases=[anon, str(A), str(B)])
    assert [c.user_id for c in changes(ev)] == [A, B]


def test_transfer_takes_the_plan_from_the_old_user_only():
    ev = {"type": "TRANSFER", "transferred_from": [str(A)], "transferred_to": [str(B)],
          "app_user_id": str(B)}
    assert changes(ev) == [PlanChange(A, False, None)]


def test_transfer_warns_that_the_new_user_needs_the_rest_key(caplog):
    ev = {"type": "TRANSFER", "transferred_from": [str(A)], "transferred_to": [str(B)]}
    with caplog.at_level("WARNING", logger="app.services.billing"):
        changes(ev)
    assert "REVENUECAT_SECRET_API_KEY" in caplog.text


def test_user_ids_keep_canonical_uuids_only():
    anon = "$RCAnonymousID:abc"
    assert user_ids_in(str(A), [str(B), anon, "nope", None, 7, str(A)], None, anon) == [A, B]
    assert user_ids_in(str(A).upper()) == []  # not the id the app logs in with
    assert user_ids_in(A.hex) == []  # nor a bare hex form
    assert user_ids_in("urn:uuid:" + str(A)) == []
    assert user_ids_in() == [] and user_ids_in([]) == []


def test_user_ids_are_uuid_objects():
    assert user_ids_in(str(A)) == [UUID(str(A))]
