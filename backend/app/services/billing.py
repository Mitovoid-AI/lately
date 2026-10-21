"""Billing service — RevenueCat webhooks and plan updates (Lately Pro, migration 0013).

RevenueCat reports what a user bought; this module turns that into
profiles.plan / plan_expires_at / plan_changed_at. The RevenueCat App User ID
is the Supabase user UUID, so events map straight onto profiles.

Two modes, picked by REVENUECAT_SECRET_API_KEY:
- key set: for every candidate user the backend asks RevenueCat's REST API for
  the entitlement and trusts that, not the event fields. Event type no longer
  matters, so TRANSFER and out-of-order deliveries are handled too.
- no key: the event's own fields decide (the table in `plan_changes_from_event`).
  A TRANSFER can only take the plan away from the old user; granting the new
  one needs the key.
Nothing here inserts profiles, and a `lifetime` plan is never changed.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote
from uuid import UUID

import asyncpg
import httpx

from ..config import settings

log = logging.getLogger(__name__)

SIGNATURE_TOLERANCE_S = 300
REQUEST_TIMEOUT_S = 10.0

# SQL for the plan a user effectively has right now (an expired pro reads as
# free, like save_reel() treats it) and its expiry, which only a pro row has.
# Both expect the profiles table aliased as `p`.
EFFECTIVE_PLAN_SQL = (
    "case when public.has_paid_plan(p.plan, p.plan_expires_at) then p.plan else 'free' end"
)
EFFECTIVE_EXPIRY_SQL = (
    "case when p.plan = 'pro' and public.has_paid_plan(p.plan, p.plan_expires_at) "
    "then p.plan_expires_at end"
)

# Event types, https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
GRANT_EVENTS = frozenset({
    "INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "NON_RENEWING_PURCHASE",
    "PRODUCT_CHANGE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT",
})
REVOKE_EVENTS = frozenset({"EXPIRATION"})
# CANCELLATION (auto-renew off, paid until expiry), BILLING_ISSUE, SUBSCRIPTION_PAUSED,
# TEST and anything unknown change nothing.


class BillingUnavailable(Exception):
    """RevenueCat could not be reached, refused the request, or sent an unreadable reply."""


@dataclass(frozen=True)
class EntitlementState:
    active: bool
    expires_at: datetime | None  # None = never expires


@dataclass(frozen=True)
class PlanChange:
    user_id: UUID
    active: bool
    expires_at: datetime | None


# ---------------------------------------------------------------- signature --

def parse_signature(header: str | None) -> tuple[int, str]:
    """Split `t=<unix>,v1=<hex>` into (t, v1). Raises ValueError when malformed."""
    parts: dict[str, str] = {}
    for item in (header or "").split(","):
        key, sep, value = item.strip().partition("=")
        if sep:
            parts.setdefault(key, value)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        raise ValueError("signature has no valid timestamp") from None
    if not parts.get("v1"):
        raise ValueError("signature has no v1 value")
    return t, parts["v1"]


def verify_signature(secret: str, header: str | None, raw: bytes, now: float) -> bool:
    """True when `header` is HMAC-SHA256(secret, f"{t}.{raw body}") and t is within
    five minutes of `now` (unix seconds). Compared in constant time over the raw bytes."""
    try:
        t, v1 = parse_signature(header)
    except ValueError:
        return False
    if abs(now - t) > SIGNATURE_TOLERANCE_S:
        return False
    expected = hmac.new(secret.encode(), str(t).encode() + b"." + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), v1.lower().encode())


# ----------------------------------------------------------- RevenueCat REST --

def _client() -> httpx.AsyncClient:
    # A function so tests can swap in a client with a fake transport.
    return httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S)


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _is_sandbox_purchase(subscriber: dict[str, Any], product_id: Any) -> bool:
    """Whether the purchase behind an entitlement was made in the sandbox. Anything
    unclear counts as a real purchase, so a paying customer is never locked out by
    a missing field."""
    if not isinstance(product_id, str):
        return False
    subscriptions, one_time = subscriber.get("subscriptions"), subscriber.get("non_subscriptions")
    subscription = subscriptions.get(product_id) if isinstance(subscriptions, dict) else None
    if isinstance(subscription, dict):
        return subscription.get("is_sandbox") is True
    purchases = one_time.get(product_id) if isinstance(one_time, dict) else None
    return isinstance(purchases, list) and bool(purchases) and all(
        isinstance(p, dict) and p.get("is_sandbox") is True for p in purchases)


async def fetch_entitlement(
    app_user_id: str, now: datetime | None = None
) -> EntitlementState | None:
    """The configured entitlement of one RevenueCat customer, or None when the
    customer never had it. Active = no expiry, or an expiry (or billing grace
    period end) in the future. Raises BillingUnavailable on any failure; the
    caller decides what that means. Note this endpoint creates the customer in
    RevenueCat when it does not exist yet (answering 201), which is harmless.
    With REVENUECAT_ALLOW_SANDBOX off, an entitlement bought in the sandbox (a
    Play license tester) reads as never had."""
    s = settings()
    now = now or datetime.now(UTC)
    url = f"{s.revenuecat_api_base_url.rstrip('/')}/subscribers/{quote(app_user_id, safe='')}"
    try:
        async with _client() as http:
            resp = await http.get(
                url,
                headers={"Authorization": f"Bearer {s.revenuecat_secret_api_key}",
                         "Accept": "application/json"})
    except httpx.HTTPError as exc:
        raise BillingUnavailable(f"RevenueCat request failed: {type(exc).__name__}") from exc
    if resp.status_code not in (200, 201):  # 201: the customer was just created
        raise BillingUnavailable(f"RevenueCat answered HTTP {resp.status_code}")
    try:
        subscriber = resp.json()["subscriber"]
        entitlements = subscriber["entitlements"]
        if not isinstance(entitlements, dict):
            raise TypeError("entitlements is not an object")
    except (ValueError, KeyError, TypeError) as exc:
        raise BillingUnavailable("RevenueCat sent an unreadable reply") from exc

    entitlement = entitlements.get(s.revenuecat_entitlement_id)
    if not isinstance(entitlement, dict):
        return None
    if not s.revenuecat_allow_sandbox and _is_sandbox_purchase(
            subscriber, entitlement.get("product_identifier")):
        return None
    raw_expiry = entitlement.get("expires_date")
    if raw_expiry is None:
        return EntitlementState(active=True, expires_at=None)
    expires_at = _parse_iso(raw_expiry)
    if expires_at is None:
        raise BillingUnavailable("RevenueCat sent an unreadable expiry")
    grace = _parse_iso(entitlement.get("grace_period_expires_date"))
    if grace is not None and grace > expires_at:  # billing retry: RevenueCat keeps access on
        expires_at = grace
    return EntitlementState(active=expires_at > now, expires_at=expires_at)


async def _fetch_all(user_ids: list[UUID], now: datetime) -> list[EntitlementState | None]:
    """Concurrent lookups, so a webhook with several users stays far inside
    RevenueCat's 60 s limit. The first failure is raised once all have finished."""
    results = await asyncio.gather(
        *(fetch_entitlement(str(u), now) for u in user_ids), return_exceptions=True)
    states: list[EntitlementState | None] = []
    for result in results:
        if isinstance(result, BaseException):
            raise result
        states.append(result)
    return states


# --------------------------------------------------------------- plan writes --

_APPLY_SQL = """
with upd as (
  update public.profiles
     set plan = $2, plan_expires_at = $3, plan_changed_at = $4
   where id = $1 and plan <> 'lifetime'
     and (plan_changed_at is null or plan_changed_at <= $4)
  returning plan)
select coalesce((select plan from upd), (select plan from public.profiles where id = $1))
"""


async def apply_plan(
    con: asyncpg.Connection, user_id: UUID, active: bool,
    expires_at: datetime | None, changed_at: datetime,
) -> str | None:
    """Set a user's plan to pro (active) or free. Skipped for a `lifetime` plan and
    when `changed_at` is older than the update that last set the plan (a stale,
    out-of-order event; plan_changed_at = 'infinity' by hand pins a manual grant).
    Returns the plan the profile has afterwards, or None when there is no such
    profile (nothing is ever inserted)."""
    plan: str | None = await con.fetchval(
        _APPLY_SQL, user_id, "pro" if active else "free", expires_at, changed_at)
    return plan


# ------------------------------------------------------------ event decoding --

def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _event_entitlements(event: dict[str, Any]) -> list[Any]:
    """The entitlements an event's product unlocks. `entitlement_ids` is null when
    the product is mapped to none, which means no entitlement, not any. Only a
    payload without that field (older ones) falls back to `entitlement_id`."""
    if "entitlement_ids" in event:
        return _as_list(event["entitlement_ids"])
    return _as_list(event.get("entitlement_id"))


def user_ids_in(*values: Any) -> list[UUID]:
    """Every value that is exactly a canonical (lowercase) UUID string, once, in order.
    RevenueCat anonymous ids ($RCAnonymousID:...) and anything else are dropped."""
    found: list[UUID] = []
    for value in (v for raw in values for v in _as_list(raw)):
        if not isinstance(value, str):
            continue
        try:
            parsed = UUID(value)
        except ValueError:
            continue
        if str(parsed) == value and parsed not in found:
            found.append(parsed)
    return found


def _ms_to_datetime(value: Any) -> datetime | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, UTC)
    except (OverflowError, OSError, ValueError):
        return None


def event_user_ids(event: dict[str, Any]) -> list[UUID]:
    """Users an event can concern: app_user_id, original_app_user_id, aliases and,
    for a TRANSFER, the users it moved the purchase from and to."""
    return user_ids_in(
        event.get("app_user_id"), event.get("original_app_user_id"), event.get("aliases"),
        event.get("transferred_from"), event.get("transferred_to"))


def event_timestamp(event: dict[str, Any], now: datetime) -> datetime:
    return _ms_to_datetime(event.get("event_timestamp_ms")) or now


def plan_changes_from_event(
    event: dict[str, Any], entitlement_id: str, now: datetime
) -> list[PlanChange]:
    """What an event says on its own (no RevenueCat REST key). Profiles that do not
    exist are filtered out later, by resolve_plan_changes()."""
    kind = event.get("type")
    if kind == "TRANSFER":
        if user_ids_in(event.get("transferred_to")):
            log.warning("revenuecat TRANSFER: the new user's plan is only synced with "
                        "REVENUECAT_SECRET_API_KEY set; they get Pro on their next sync")
        return [PlanChange(u, False, None) for u in user_ids_in(event.get("transferred_from"))]

    if entitlement_id not in _event_entitlements(event):
        return []  # a product that unlocks something else, or nothing
    users = user_ids_in(
        event.get("app_user_id"), event.get("original_app_user_id"), event.get("aliases"))

    if kind in GRANT_EVENTS:
        expires_at = _ms_to_datetime(event.get("expiration_at_ms"))
        if event.get("expiration_at_ms") is not None and expires_at is None:
            log.warning("revenuecat %s: unreadable expiration_at_ms, ignored", kind)
            return []  # never read bad data as "no expiry"
        return [PlanChange(u, True, expires_at) for u in users]
    if kind in REVOKE_EVENTS:
        return [PlanChange(u, False, _ms_to_datetime(event.get("expiration_at_ms")))
                for u in users]
    if kind == "CANCELLATION":
        # Auto-renew went off; the user stays paid until expiry. A cancellation whose
        # paid period has already ended (a refund) is the exception.
        ended = _ms_to_datetime(event.get("expiration_at_ms"))
        if ended is not None and ended <= now:
            return [PlanChange(u, False, ended) for u in users]
    return []


async def existing_profile_ids(
    db: asyncpg.Pool | asyncpg.Connection, ids: Iterable[UUID]
) -> list[UUID]:
    wanted = list(ids)
    if not wanted:
        return []
    rows = await db.fetch("select id from public.profiles where id = any($1::uuid[])", wanted)
    present = {r["id"] for r in rows}
    return [u for u in wanted if u in present]


async def resolve_plan_changes(
    event: dict[str, Any], users: list[UUID], now: datetime | None = None
) -> tuple[list[PlanChange], datetime]:
    """What one RevenueCat event does to `users` (the profiles that exist), and the
    timestamp that orders it against other plan updates. It takes no database
    connection: with REVENUECAT_SECRET_API_KEY set RevenueCat is asked here, which
    can be slow, so the caller must not hold a pooled connection meanwhile. Raises
    BillingUnavailable when RevenueCat could not be asked (the caller then stores
    nothing and has the event retried)."""
    s = settings()
    now = now or datetime.now(UTC)
    if s.revenuecat_secret_api_key:
        # `now` is taken before the requests go out: a reply is at least that fresh, so a
        # lookup that overlaps a newer one (a sync, another webhook) cannot overwrite it.
        states = await _fetch_all(users, now)
        return [PlanChange(user_id, state is not None and state.active,
                           state.expires_at if state is not None else None)
                for user_id, state in zip(users, states, strict=True)], now
    known = set(users)
    changes = plan_changes_from_event(event, s.revenuecat_entitlement_id, now)
    return [c for c in changes if c.user_id in known], event_timestamp(event, now)


async def apply_changes(
    con: asyncpg.Connection, changes: Iterable[PlanChange], changed_at: datetime
) -> dict[UUID, str]:
    """Write the changes; returns each touched user's resulting plan."""
    applied: dict[UUID, str] = {}
    for change in changes:
        plan = await apply_plan(con, change.user_id, change.active, change.expires_at, changed_at)
        if plan is not None:
            applied[change.user_id] = plan
    return applied
