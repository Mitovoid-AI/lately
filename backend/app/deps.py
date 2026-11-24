"""Database pool + request identity (Part 1).

API routes use one service-role pool and **always** filter by the verified
`auth_user_id` (the JWT `sub`, never a client-supplied user_id); RLS policies
are the backstop for any direct client access (BACKEND.md §4).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, timedelta, timezone
from typing import Annotated, Any

import asyncpg
import httpx
import jwt
from fastapi import Depends, Header, HTTPException, Request

from .config import settings
from .search.embed import Embedder, OpenAIEmbedder

log = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    """Create the asyncpg pool from DATABASE_URL (idempotent; app/worker startup).

    statement_cache_size=0: the Supabase transaction pooler (port 6543) cannot
    keep named prepared statements across transactions. command_timeout: a
    query whose reply never comes fails instead of hanging its caller.
    """
    global _pool
    if _pool is None:
        s = settings()
        _pool = await asyncpg.create_pool(
            s.database_url,
            min_size=1,
            max_size=s.db_pool_max_size,
            statement_cache_size=0,
            command_timeout=s.db_command_timeout_seconds,
        )
    return _pool


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("pool not initialised — call init_pool()")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


# ---------------------------------------------------------------- identity --

_jwks_cache: dict[str, Any] = {"keys": None, "fetched_at": 0.0, "tried_at": float("-inf")}
_JWKS_TTL = 3600.0
# With keys cached, a refetch (after a failed refresh, or for an unknown kid) is
# tried at most this often, so a Supabase outage or a stream of tokens with made-up
# kids cannot cost a JWKS fetch per request.
_JWKS_RETRY_SECONDS = 60.0
# Supabase's clock and this host's drift apart by seconds; without slack a token
# used right after sign-in fails "not yet valid (iat)" and the app signs out.
_CLOCK_SKEW_SECONDS = 60


async def _jwks(force: bool = False) -> dict[str, Any]:
    """The project's JWKS, cached for _JWKS_TTL. A refresh that fails keeps the
    cached keys in use; with nothing cached it is a 503. `force` refetches before
    the TTL (a token signed with a key we don't know yet: rotation)."""
    s = settings()
    now = time.monotonic()
    cached = _jwks_cache["keys"]
    due = cached is None or force or now - _jwks_cache["fetched_at"] > _JWKS_TTL
    if due and (cached is None or now - _jwks_cache["tried_at"] >= _JWKS_RETRY_SECONDS):
        _jwks_cache["tried_at"] = now
        url = f"{s.supabase_url}/auth/v1/.well-known/jwks.json"
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                _jwks_cache["keys"] = resp.json()
            _jwks_cache["fetched_at"] = now
        except (httpx.HTTPError, ValueError) as exc:
            if cached is None:
                raise HTTPException(503, {"error": {
                    "code": "SERVER", "message": "Sign-in can't be checked right now. Try again."}}
                ) from exc
            log.warning("JWKS refresh failed (%s); using the cached keys", type(exc).__name__)
    return _jwks_cache["keys"]


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None = None


async def get_current_user(request: Request) -> AuthUser:
    """Verify the Supabase JWT against the project JWKS (BACKEND.md §3).

    Security-critical: signature + audience always verified; identity comes
    only from the `sub` claim.
    """
    auth = request.headers.get("authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "missing bearer token")
    s = settings()
    try:
        # Pick the JWKS key by the token's kid, then verify fully.
        kid = jwt.get_unverified_header(token).get("kid")
        keys = (await _jwks()).get("keys", [])
        jwk = next((k for k in keys if k.get("kid") == kid), None)
        if jwk is None:  # maybe a newly rotated key: refetch (rate-limited) once
            keys = (await _jwks(force=True)).get("keys", [])
            jwk = next((k for k in keys if k.get("kid") == kid), None)
        if jwk is None:
            raise HTTPException(401, "token kid not in JWKS")
        claims = jwt.decode(
            token,
            jwt.PyJWK(jwk).key,
            algorithms=["ES256", "RS256"],
            audience=s.supabase_jwt_audience or None,
            options={"verify_aud": bool(s.supabase_jwt_audience)},
            leeway=_CLOCK_SKEW_SECONDS,
        )
    except HTTPException:
        raise
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"invalid token: {e}") from e
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(401, "token missing sub")
    return AuthUser(id=str(sub), email=claims.get("email"))


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]


# ---------------------------------------------------------------- timezone --

def client_timezone(x_timezone_offset: Annotated[str | None, Header()] = None) -> timezone:
    """The app's `X-Timezone-Offset`: minutes east of UTC (India = 330), for
    "today"-style day boundaries. Missing, not a whole number, or outside
    -720..840 (UTC-12..UTC+14) = UTC."""
    try:
        minutes = int(x_timezone_offset or "")
    except ValueError:
        return UTC
    if not -720 <= minutes <= 840:
        return UTC
    return timezone(timedelta(minutes=minutes))


ClientTimezone = Annotated[timezone, Depends(client_timezone)]


# --------------------------------------------------------------- embedder --
# One shared client per process; None when no key is set (search then runs
# keyword + fuzzy only). Tests override it via app.dependency_overrides.

_embedder: OpenAIEmbedder | None = None


def get_embedder() -> Embedder | None:
    """The query embedder from the EMBEDDINGS_* settings (SEARCH.md §3)."""
    global _embedder
    s = settings()
    if not s.embeddings_api_key:
        return None
    if _embedder is None:
        _embedder = OpenAIEmbedder(s.embeddings_api_key, s.embeddings_base_url,
                                   s.embeddings_model, s.embeddings_dimensions)
    return _embedder
