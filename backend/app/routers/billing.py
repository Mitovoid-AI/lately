"""Billing router — Lately Pro (RevenueCat on Google Play Billing, migration 0013).

POST /webhooks/revenuecat  RevenueCat -> backend. No user JWT; guarded by the
    Authorization header value configured in the RevenueCat dashboard
    (REVENUECAT_WEBHOOK_AUTH, compared in constant time; empty = disabled, 404)
    and, when REVENUECAT_WEBHOOK_SIGNING_SECRET is set, an HMAC signature.
    Each event id is stored once (billing_events), so a redelivery is a no-op.
    With REVENUECAT_SECRET_API_KEY set the backend asks RevenueCat for the truth
    (before any transaction opens, so a slow RevenueCat never holds a pooled
    connection); if that call fails nothing is stored and the answer is 503, so
    RevenueCat retries the event.
POST /billing/sync         the app, right after a purchase or restore. Reads the
    caller's entitlement from RevenueCat (key set) and answers with the effective
    plan; without the key it only reports what the profile already says.

Never log the Authorization header, the signing secret or the API key.
"""

from __future__ import annotations

import hmac
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..config import settings
from ..deps import CurrentUser, pool
from ..models import PlanOut, api_error
from ..services import billing

log = logging.getLogger(__name__)

router = APIRouter(tags=["billing"])

_INSERT_EVENT_SQL = """
insert into public.billing_events (id, type, app_user_id, environment, payload)
values ($1, $2, $3, $4, $5::jsonb)
on conflict (id) do nothing
returning id
"""

_SEEN_EVENT_SQL = "select exists (select 1 from public.billing_events where id = $1)"

_PLAN_SQL = f"""
select {billing.EFFECTIVE_PLAN_SQL} as plan, {billing.EFFECTIVE_EXPIRY_SQL} as plan_expires_at
from public.profiles p where p.id = $1
"""


def _unavailable() -> HTTPException:
    return api_error(503, "BILLING_UNAVAILABLE", "Could not reach the billing service.")


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


@router.post("/webhooks/revenuecat")
async def revenuecat_webhook(request: Request) -> dict[str, str]:
    s = settings()
    if not s.revenuecat_webhook_auth:
        raise api_error(404, "NOT_FOUND", "Not found.")
    given = request.headers.get("authorization", "")
    if not hmac.compare_digest(given.encode(), s.revenuecat_webhook_auth.encode()):
        raise api_error(401, "UNAUTHORIZED", "Invalid webhook credentials.")

    raw = await request.body()  # the signature covers these exact bytes
    if s.revenuecat_webhook_signing_secret and not billing.verify_signature(
            s.revenuecat_webhook_signing_secret,
            request.headers.get("x-revenuecat-webhook-signature"), raw, time.time()):
        raise api_error(401, "UNAUTHORIZED", "Invalid webhook signature.")

    try:
        payload = json.loads(raw)
        event = payload["event"]
        event_id, event_type = _text(event["id"]), _text(event["type"])
    except (ValueError, KeyError, TypeError):
        event = event_id = event_type = None
    if not isinstance(event, dict) or event_id is None or event_type is None:
        raise api_error(400, "BAD_REQUEST", "Malformed RevenueCat event.")

    environment = _text(event.get("environment"))
    # Sandbox events (Play license testers) are recorded but change nothing when switched off.
    ignore = not s.revenuecat_allow_sandbox and (environment or "").upper() == "SANDBOX"

    db = pool()
    if s.revenuecat_secret_api_key and not ignore and await db.fetchval(_SEEN_EVENT_SQL, event_id):
        return {"status": "duplicate"}  # a redelivery: skip the RevenueCat lookups

    # Everything slow happens before the transaction opens, so no pooled connection is
    # held while RevenueCat is asked. A failure stores nothing: the retry is processed.
    users = await billing.existing_profile_ids(db, billing.event_user_ids(event))
    changes: list[billing.PlanChange] = []
    changed_at = datetime.now(UTC)
    if users and not ignore:
        try:
            changes, changed_at = await billing.resolve_plan_changes(event, users)
        except billing.BillingUnavailable as exc:
            log.warning("revenuecat event %s deferred: %s", event_id, exc)
            raise _unavailable() from exc

    # An event that names no existing account (a deleted user's later renewal, an
    # anonymous id, the dashboard's test event) is kept without its payload, so nothing
    # personal outlives the account; the id still makes redeliveries a no-op.
    if users:
        app_user_id, stored = _text(event.get("app_user_id")), payload
    else:
        log.info("revenuecat %s event %s names no known account; payload not stored",
                 event_type, event_id)
        app_user_id, stored = None, {"event": {"id": event_id, "type": event_type}}

    async with db.acquire() as con, con.transaction():
        inserted = await con.fetchval(
            _INSERT_EVENT_SQL, event_id, event_type, app_user_id, environment,
            json.dumps(stored))
        if inserted is None:
            return {"status": "duplicate"}
        await billing.apply_changes(con, changes, changed_at)
        await con.execute(
            "update public.billing_events set processed_at = now() where id = $1", event_id)
    return {"status": "ignored" if ignore else "ok"}


@router.post("/billing/sync", response_model=PlanOut)
async def sync_plan(user: CurrentUser) -> PlanOut:
    uid = uuid.UUID(user.id)
    state = None
    asked = bool(settings().revenuecat_secret_api_key)
    started = datetime.now(UTC)  # before the lookup: a newer update elsewhere keeps its place
    if asked:
        try:
            state = await billing.fetch_entitlement(str(uid), started)
        except billing.BillingUnavailable as exc:
            log.warning("billing sync for user %s failed: %s", uid, exc)
            raise api_error(502, "BILLING_UNAVAILABLE",
                            "Could not check your subscription right now. Try again.") from exc

    async with pool().acquire() as con:
        row = await con.fetchrow(_PLAN_SQL, uid)
        if row is None:
            # Same as GET /me: build a missing profile row now.
            await con.execute("select public.sync_profile($1)", uid)
            row = await con.fetchrow(_PLAN_SQL, uid)
        if row is None:
            raise api_error(404, "NOT_FOUND", "Account not found.")
        if asked:
            await billing.apply_plan(
                con, uid, state is not None and state.active,
                state.expires_at if state is not None else None, started)
            row = await con.fetchrow(_PLAN_SQL, uid)
            assert row is not None
    return PlanOut(plan=row["plan"], plan_expires_at=row["plan_expires_at"])
