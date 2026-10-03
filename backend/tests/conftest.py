"""Shared test setup.

DB-marked tests run against TEST_DATABASE_URL, resolved in this order:
env var → backend/.env → the local Supabase CLI default. Today that is the
online dev project, which is disposable: tests truncate its tables. Never
point TEST_DATABASE_URL at qa or prod data.

Env defaults are set at import, before `app.config.settings()` is first
called, so the app under test can only ever see the test database.
"""

from __future__ import annotations

import os
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import asyncpg
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from dotenv import dotenv_values

_LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

# Users made by `make_user` share this domain so every run can clean them up.
TEST_EMAIL_DOMAIN = "lately.test"


def _test_database_url() -> str:
    if url := os.environ.get("TEST_DATABASE_URL"):
        return url
    if _ENV_FILE.exists() and (url := dotenv_values(_ENV_FILE).get("TEST_DATABASE_URL")):
        return url
    return _LOCAL_DB


TEST_DATABASE_URL = _test_database_url()
os.environ["TEST_DATABASE_URL"] = TEST_DATABASE_URL
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("SUPABASE_JWT_AUDIENCE", "authenticated")

_TRUNCATE = (
    "truncate public.jobs, public.jobs_dead, public.metrics, public.reels, "
    "public.reel_content, public.profiles restart identity cascade"
)


@pytest.fixture
async def db() -> AsyncIterator[asyncpg.Pool]:
    try:
        pool = await asyncpg.create_pool(
            TEST_DATABASE_URL, min_size=1, max_size=12, statement_cache_size=0, timeout=15
        )
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        msg = (
            f"test database unreachable ({type(exc).__name__}: {exc}) — set "
            "TEST_DATABASE_URL in backend/.env, or run `supabase start`"
        )
        if os.environ.get("REQUIRE_DB") == "1":
            pytest.fail(msg)
        pytest.skip(msg)
    try:
        try:
            await pool.execute(_TRUNCATE)
        except asyncpg.UndefinedTableError:
            pass  # schema not migrated yet; the test itself reports what is missing
        await pool.execute(
            "delete from auth.users where email like $1", f"%@{TEST_EMAIL_DOMAIN}"
        )
        yield pool
    finally:
        await pool.close()


@pytest.fixture
def make_user(db: asyncpg.Pool) -> Callable[..., Awaitable[uuid.UUID]]:
    async def _make_user(email: str | None = None) -> uuid.UUID:
        uid = uuid.uuid4()
        await db.execute(
            "insert into auth.users (id, email, aud, role) "
            "values ($1, $2, 'authenticated', 'authenticated')",
            uid,
            email or f"{uid.hex[:12]}@{TEST_EMAIL_DOMAIN}",
        )
        return uid

    return _make_user


# ---------------------------------------------------------------- API auth --
# A P-256 key pair generated per test session stands in for Supabase Auth's
# signing key, so no key is ever committed. The app's JWKS fetch is patched to
# return its public half; verification itself runs the real code path.

_TEST_KID = "test-kid"


@pytest.fixture(scope="session")
def _signing_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(autouse=True)
def _test_jwks(monkeypatch: pytest.MonkeyPatch, _signing_key: ec.EllipticCurvePrivateKey) -> None:
    from app import deps

    public_jwk: dict[str, Any] = jwt.algorithms.ECAlgorithm.to_jwk(
        _signing_key.public_key(), as_dict=True
    )
    public_jwk |= {"kid": _TEST_KID, "alg": "ES256", "use": "sig"}

    async def fake_jwks() -> dict[str, Any]:
        return {"keys": [public_jwk]}

    monkeypatch.setattr(deps, "_jwks", fake_jwks)


@pytest.fixture
def jwt_for(_signing_key: ec.EllipticCurvePrivateKey) -> Callable[[uuid.UUID], str]:
    def _jwt_for(user_id: uuid.UUID) -> str:
        now = int(time.time())
        claims = {"sub": str(user_id), "aud": "authenticated", "role": "authenticated",
                  "iat": now, "exp": now + 3600}
        return jwt.encode(claims, _signing_key, algorithm="ES256", headers={"kid": _TEST_KID})

    return _jwt_for


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    # ASGITransport does not run the app lifespan, so the pool is opened here.
    from app.deps import close_pool, init_pool
    from app.main import app

    await init_pool()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as c:
            yield c
    finally:
        await close_pool()
