"""Database pool + request identity (Part 1).

Two access modes:
- API routes connect with the **user's JWT** (user_jwt client) → RLS scopes
  every row automatically (BACKEND.md §4). Used for reads and the note PATCH.
- The catch path calls `save_reel()` via **service role** (it inserts + enqueues
  on the user's behalf and checks quota counters). Identity is still the
  verified JWT sub — never a client-supplied user_id.
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


async def pool() -> asyncpg.Pool:
    """Lazy asyncpg pool over the Supabase Postgres (pooled port 6543)."""
    global _pool
    if _pool is None:
        s = settings()
        # Supabase pooler URL: same host, port 6543, user postgres.
        host = s.supabase_url.split("//")[1].split(".")[0] + ".supabase.co"
        dsn = (
            f"postgresql://postgres:{s.supabase_service_role_key}"
            f"@aws-0-{_region(host)}.pooler.supabase.com:6543/postgres"
        )
        _pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
    return _pool


def _region(_host: str) -> str:  # pragma: no cover - deployment-specific
    """Project region slug; override via SUPABASE_DB_DSN if needed."""
    import os

    return os.environ.get("SUPABASE_DB_REGION", "ap-south-1")


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
