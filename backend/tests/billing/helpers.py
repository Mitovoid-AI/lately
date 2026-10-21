"""Shared pieces of the billing tests: time helpers and a fake RevenueCat."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import unquote

import httpx

WEBHOOK_AUTH = "test-webhook-auth-value"
RC_KEY = "sk_test_revenuecat_key"
RC_BASE = "https://rc.test/v1"


def ms(moment: datetime | None) -> int | None:
    return None if moment is None else int(moment.timestamp() * 1000)


def iso_z(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def days(n: float) -> datetime:
    """A moment `n` days from now (negative = past), in whole seconds."""
    return (datetime.now(UTC) + timedelta(days=n)).replace(microsecond=0)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def reel_url(code: str) -> str:
    return f"https://www.instagram.com/reel/{code}/"


class FakeRevenueCat:
    """RevenueCat's v1 `GET /subscribers/{id}`: one configurable entitlement per user."""

    def __init__(self) -> None:
        self.entitlements: dict[str, dict[str, Any]] = {}
        self.subscriptions: dict[str, dict[str, Any]] = {}  # user -> {product: subscription}
        self.non_subscriptions: dict[str, dict[str, Any]] = {}  # user -> {product: [purchases]}
        self.status = 200  # 201 is what RevenueCat answers when it just created the customer
        self.error: Exception | None = None
        self.calls: list[httpx.Request] = []

    def grant(
        self, user: uuid.UUID, expires: datetime | None, *, sandbox: bool | None = None,
        one_time: bool = False, **extra: Any,
    ) -> None:
        """Give `user` the entitlement. `sandbox` also records the purchase behind it
        (a subscription, or a one-time purchase) with that is_sandbox flag; left None,
        RevenueCat's reply says nothing about the purchase."""
        product = "lately_pro:lifetime" if one_time else "lately_pro:yearly"
        self.entitlements[str(user)] = {
            "expires_date": None if expires is None else iso_z(expires),
            "product_identifier": product, **extra}
        if sandbox is not None and one_time:
            self.non_subscriptions[str(user)] = {
                product: [{"id": "p1", "is_sandbox": sandbox, "store": "play_store"}]}
        elif sandbox is not None:
            self.subscriptions[str(user)] = {
                product: {"is_sandbox": sandbox, "store": "play_store"}}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self.error is not None:
            raise self.error
        if self.status not in (200, 201):
            return httpx.Response(self.status, json={"message": "nope"})
        user = unquote(request.url.path.rsplit("/", 1)[-1])
        entitlement = self.entitlements.get(user)
        return httpx.Response(self.status, json={"subscriber": {
            "entitlements": {} if entitlement is None else {"pro": entitlement},
            "subscriptions": self.subscriptions.get(user, {}),
            "non_subscriptions": self.non_subscriptions.get(user, {})}})

    @property
    def asked(self) -> list[str]:
        """The app user ids RevenueCat was asked about, in call order."""
        return [unquote(r.url.path.rsplit("/", 1)[-1]) for r in self.calls]
