"""Billing test setup: settings pinned to "feature off", no real RevenueCat call,
and helpers to build and post webhook events.

Tests that need the webhook enabled use `send`; tests of the REST-key path add
`rc`, a fake RevenueCat behind httpx.MockTransport.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from app.config import settings
from app.services import billing
from tests.billing.helpers import RC_BASE, RC_KEY, WEBHOOK_AUTH, FakeRevenueCat, ms


def _refuse(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"unexpected RevenueCat call in a test: {request.method} {request.url}")


@pytest.fixture(autouse=True)
def _billing_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """Whatever backend/.env says, tests start with billing off and no network."""
    s = settings()
    monkeypatch.setattr(s, "revenuecat_webhook_auth", "")
    monkeypatch.setattr(s, "revenuecat_webhook_signing_secret", "")
    monkeypatch.setattr(s, "revenuecat_secret_api_key", "")
    monkeypatch.setattr(s, "revenuecat_entitlement_id", "pro")
    monkeypatch.setattr(s, "revenuecat_allow_sandbox", True)
    monkeypatch.setattr(s, "revenuecat_api_base_url", RC_BASE)
    monkeypatch.setattr(
        billing, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(_refuse)))


@pytest.fixture
def rc(monkeypatch: pytest.MonkeyPatch) -> FakeRevenueCat:
    """The REST key is set (the backend asks RevenueCat), answered by a fake."""
    fake = FakeRevenueCat()
    monkeypatch.setattr(settings(), "revenuecat_secret_api_key", RC_KEY)
    monkeypatch.setattr(
        billing, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
    return fake


@pytest.fixture
def make_event() -> Callable[..., dict[str, Any]]:
    """A webhook body like RevenueCat sends. Pass `user` for the usual ids, or
    override any event field by keyword."""

    def _make_event(
        kind: str, user: uuid.UUID | str | None = None, *, expires: datetime | None = None,
        at: datetime | None = None, **fields: Any,
    ) -> dict[str, Any]:
        event: dict[str, Any] = {
            "id": str(uuid.uuid4()), "type": kind,
            "event_timestamp_ms": ms(at or datetime.now(UTC)),
            "expiration_at_ms": ms(expires), "entitlement_ids": ["pro"],
            "environment": "PRODUCTION", "product_id": "lately_pro:yearly"}
        if user is not None:
            event |= {"app_user_id": str(user), "original_app_user_id": str(user),
                      "aliases": [str(user)]}
        event |= fields
        return {"api_version": "1.0", "event": event}

    return _make_event


@pytest.fixture
def send(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch):
    """POST a body to the webhook with the webhook enabled. `auth=None` sends no
    Authorization header; `raw` replaces the serialized body."""
    monkeypatch.setattr(settings(), "revenuecat_webhook_auth", WEBHOOK_AUTH)

    async def _send(
        body: Any = None, *, auth: str | None = WEBHOOK_AUTH,
        headers: dict[str, str] | None = None, raw: bytes | None = None,
    ) -> httpx.Response:
        sent = {"Content-Type": "application/json"} | ({"Authorization": auth} if auth else {})
        return await client.post(
            "/webhooks/revenuecat", headers=sent | (headers or {}),
            content=raw if raw is not None else json.dumps(body).encode())

    return _send


@pytest.fixture
def profile(db):
    async def _profile(user: uuid.UUID):
        return await db.fetchrow(
            "select plan, plan_expires_at, plan_changed_at from public.profiles where id = $1",
            user)

    return _profile


@pytest.fixture
def set_plan(db) -> Callable[..., Awaitable[None]]:
    """Put a profile on a plan directly (the state a past purchase left behind)."""

    async def _set_plan(
        user: uuid.UUID, plan: str, expires: datetime | None = None,
        changed: datetime | None = None, limit: int | None = None,
    ) -> None:
        await db.execute(
            "update public.profiles set plan = $2, plan_expires_at = $3, plan_changed_at = $4,"
            " saves_free_limit = coalesce($5, saves_free_limit) where id = $1",
            user, plan, expires, changed, limit)

    return _set_plan
