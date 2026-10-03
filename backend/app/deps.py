"""Database pool + request identity (Part 1).

API routes use one service-role pool and **always** filter by the verified
`auth_user_id` (the JWT `sub`, never a client-supplied user_id); RLS policies
are the backstop for any direct client access (BACKEND.md §4).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Annotated, Any

import asyncpg
import httpx
import jwt
from fastapi import Depends, HTTPException, Request

from .config import settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    """Create the asyncpg pool from DATABASE_URL (idempotent; app/worker startup).

    statement_cache_size=0: the Supabase transaction pooler (port 6543) cannot
    keep named prepared statements across transactions.
    """
    global _pool
    if _pool is None:
        s = settings()
        _pool = await asyncpg.create_pool(
            s.database_url,
            min_size=1,
            max_size=s.db_pool_max_size,
            statement_cache_size=0,
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

_jwks_cache: dict[str, Any] = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL = 3600.0


async def _jwks() -> dict[str, Any]:
    s = settings()
    now = time.monotonic()
    if _jwks_cache["keys"] is None or now - _jwks_cache["fetched_at"] > _JWKS_TTL:
        url = f"{s.supabase_url}/auth/v1/.well-known/jwks.json"
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            _jwks_cache["keys"] = resp.json()
        _jwks_cache["fetched_at"] = now
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
        if jwk is None:
            raise HTTPException(401, "token kid not in JWKS")
        claims = jwt.decode(
            token,
            jwt.PyJWK(jwk).key,
            algorithms=["ES256", "RS256"],
            audience=s.supabase_jwt_audience or None,
            options={"verify_aud": bool(s.supabase_jwt_audience)},
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
