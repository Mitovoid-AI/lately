"""Bearer-token check: tolerates a little clock difference with Supabase, no more;
the JWKS cache rides out a failed refresh and picks up a rotated key."""

import time

import httpx
import jwt
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import deps

_REAL_JWKS = deps._jwks  # conftest swaps in a fake per test; these tests need the real one


async def _request_with_token(signing_key, issued_ahead: int) -> Request:
    kid = (await deps._jwks())["keys"][0]["kid"]
    iat = int(time.time()) + issued_ahead
    token = jwt.encode({"sub": "user-1", "aud": "authenticated", "iat": iat, "exp": iat + 3600},
                       signing_key, algorithm="ES256", headers={"kid": kid})
    return Request({"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]})


async def test_token_from_a_clock_seconds_ahead_is_accepted(_signing_key):
    request = await _request_with_token(_signing_key, issued_ahead=30)
    user = await deps.get_current_user(request)
    assert user.id == "user-1"


async def test_token_from_a_clock_minutes_ahead_is_rejected(_signing_key):
    request = await _request_with_token(_signing_key, issued_ahead=300)
    with pytest.raises(HTTPException) as err:
        await deps.get_current_user(request)
    assert err.value.status_code == 401


# ------------------------------------------------------------------- JWKS cache

@pytest.fixture
def real_jwks(monkeypatch, _signing_key):
    """The real _jwks() over a fake Supabase endpoint. `state["keys"]` is what it
    serves, `state["fail"]` makes it answer 500, `state["calls"]` counts fetches."""
    public = jwt.algorithms.ECAlgorithm.to_jwk(_signing_key.public_key(), as_dict=True)
    state = {"calls": 0, "fail": False, "keys": [public | {"kid": "k1", "alg": "ES256"}]}

    def handler(request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        if state["fail"]:
            return httpx.Response(500)
        return httpx.Response(200, json={"keys": state["keys"]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(deps.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(deps, "_jwks", _REAL_JWKS)
    monkeypatch.setattr(deps, "_jwks_cache",
                        {"keys": None, "fetched_at": 0.0, "tried_at": float("-inf")})
    state["public"] = public
    return state


def _bearer(signing_key, kid: str) -> Request:
    now = int(time.time())
    token = jwt.encode({"sub": "user-1", "aud": "authenticated", "iat": now, "exp": now + 3600},
                       signing_key, algorithm="ES256", headers={"kid": kid})
    return Request({"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]})


async def test_expired_cache_is_kept_when_the_refresh_fails(real_jwks, _signing_key):
    assert (await deps.get_current_user(_bearer(_signing_key, "k1"))).id == "user-1"
    assert real_jwks["calls"] == 1
    deps._jwks_cache["fetched_at"] -= deps._JWKS_TTL + 1  # TTL lapsed
    deps._jwks_cache["tried_at"] -= deps._JWKS_TTL + 1
    real_jwks["fail"] = True
    assert (await deps.get_current_user(_bearer(_signing_key, "k1"))).id == "user-1"
    assert real_jwks["calls"] == 2
    # The failed refresh is not retried on every request.
    assert (await deps.get_current_user(_bearer(_signing_key, "k1"))).id == "user-1"
    assert real_jwks["calls"] == 2


async def test_no_cached_keys_and_jwks_down_is_503(real_jwks, _signing_key):
    real_jwks["fail"] = True
    with pytest.raises(HTTPException) as err:
        await deps.get_current_user(_bearer(_signing_key, "k1"))
    assert err.value.status_code == 503
    assert err.value.detail["error"]["code"] == "SERVER"


async def test_unknown_kid_refetches_once_then_is_rate_limited(real_jwks, _signing_key):
    await deps.get_current_user(_bearer(_signing_key, "k1"))
    deps._jwks_cache["tried_at"] -= 120  # the first fetch was a while ago
    # Supabase rotated to k2: the first k2 token triggers one refetch and verifies.
    real_jwks["keys"] = [real_jwks["public"] | {"kid": "k2", "alg": "ES256"}]
    assert (await deps.get_current_user(_bearer(_signing_key, "k2"))).id == "user-1"
    assert real_jwks["calls"] == 2
    # Made-up kids right after cannot force more fetches.
    for _ in range(3):
        with pytest.raises(HTTPException) as err:
            await deps.get_current_user(_bearer(_signing_key, "made-up"))
        assert err.value.status_code == 401
    assert real_jwks["calls"] == 2
