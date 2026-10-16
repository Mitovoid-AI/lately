"""Thumbnails kept in Postgres (migration 0011) when Storage can't be written.

`reel_content.thumbnail_path` is one of:
- `https://…`  a remote URL (shown as-is),
- `{sc}.jpg`   an object in the public Storage bucket,
- `db:{sc}`    a row in `public.thumbnails`, served at GET /thumbnails/{sc}.jpg.

For `db:` paths the URL is absolute on the host the app called (the request's
base URL, set per request by `BaseUrlMiddleware`), unless PUBLIC_BASE_URL is set.
Outside a request (worker exports) it stays API-relative.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable
from contextvars import ContextVar

import asyncpg

from ..config import settings

log = logging.getLogger("lately.thumbnails")

PREFIX = "db:"
SHORTCODE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_BYTES = 2_000_000

request_base_url: ContextVar[str] = ContextVar("request_base_url", default="")

LocalWriter = Callable[[str, bytes], Awaitable[str | None]]


def content_type_of(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def is_local(path: str | None) -> bool:
    return bool(path) and path.startswith(PREFIX)  # type: ignore[union-attr]


def local_url(path: str) -> str:
    base = (settings().public_base_url or request_base_url.get()).rstrip("/")
    return f"{base}/thumbnails/{path[len(PREFIX):]}.jpg"


async def put(db: asyncpg.Pool | asyncpg.Connection, shortcode: str, data: bytes) -> str:
    """Upsert the image; returns its `thumbnail_path` (`db:{sc}`)."""
    if not SHORTCODE.match(shortcode):
        raise ValueError(f"bad shortcode {shortcode!r}")
    kind = content_type_of(data)
    if kind is None or len(data) > MAX_BYTES:
        raise ValueError("not an image, or too large")
    await db.execute(
        """insert into public.thumbnails (shortcode, data, content_type)
           values ($1, $2, $3)
           on conflict (shortcode) do update
             set data = excluded.data, content_type = excluded.content_type, updated_at = now()""",
        shortcode, data, kind)
    return PREFIX + shortcode


async def get(db: asyncpg.Pool | asyncpg.Connection, shortcode: str
              ) -> tuple[bytes, str] | None:
    if not SHORTCODE.match(shortcode):
        return None
    row = await db.fetchrow(
        "select data, content_type from public.thumbnails where shortcode = $1", shortcode)
    return (bytes(row["data"]), row["content_type"]) if row else None


def writer(db: asyncpg.Pool | None = None) -> LocalWriter:
    """A ThumbnailStore `local` writer. Without `db` it uses the process pool
    (app.deps) and gives up (None → remote URL kept) when there is none."""

    async def write(shortcode: str, data: bytes) -> str | None:
        target = db
        if target is None:
            from ..deps import pool

            try:
                target = pool()
            except RuntimeError:
                return None
        try:
            return await put(target, shortcode, data)
        except (ValueError, asyncpg.PostgresError, OSError) as exc:
            log.warning("thumbnail %s not stored: %s", shortcode, exc)
            return None

    return write


class BaseUrlMiddleware:
    """Remembers each request's base URL for `local_url` (pure ASGI, so the
    context variable is visible to the endpoint)."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        from starlette.requests import Request

        token = request_base_url.set(str(Request(scope).base_url).rstrip("/"))
        try:
            await self.app(scope, receive, send)
        finally:
            request_base_url.reset(token)
