"""Request-level guards that need no database: 422s in the API's error shape
(GitHub #9), the 128 KB body cap (#10) and the X-Timezone-Offset header (#11)."""

import uuid
from datetime import UTC, timedelta

import httpx
import pytest

from app.deps import client_timezone
from app.main import MAX_BODY_BYTES, app


@pytest.fixture
async def api():
    # No lifespan, no pool: every request here is answered before a route touches the DB.
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://test") as c:
        yield c


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------- 422 error shape

@pytest.mark.parametrize("body,message", [
    ({"text": ""}, "text is not valid."),
    ({}, "text is required."),
    ({"text": "https://www.instagram.com/reel/X1/", "channel": "carrier-pigeon"},
     "channel is not valid."),
])
async def test_validation_errors_use_the_api_error_shape(api, jwt_for, body, message):
    r = await api.post("/saves", json=body, headers=auth(jwt_for(uuid.uuid4())))
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "BAD_REQUEST", "message": message}}


async def test_validation_errors_never_echo_the_input(api, jwt_for):
    secret = "sk-live-do-not-echo-me"
    r = await api.post("/saves", json={"text": "x", "channel": secret},
                       headers=auth(jwt_for(uuid.uuid4())))
    assert r.status_code == 422 and secret not in r.text


async def test_bad_json_and_bad_query_params(api, jwt_for):
    h = auth(jwt_for(uuid.uuid4()))
    r = await api.post("/saves", content=b'{"text": ',
                       headers=h | {"Content-Type": "application/json"})
    assert r.status_code == 422
    assert r.json()["error"] == {"code": "BAD_REQUEST",
                                 "message": "The request body is not valid JSON."}
    r = await api.get("/search", params={"q": "momos", "limit": 0}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["message"] == "limit is not valid."


# ------------------------------------------------------------------ body limit

async def test_body_over_the_limit_by_content_length_is_413(api):
    r = await api.post("/saves", json={"text": "x" * (MAX_BODY_BYTES + 1)})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "TOO_LARGE"


async def test_chunked_body_over_the_limit_is_413(api):
    async def chunks():
        for _ in range(3):
            yield b"x" * (64 * 1024)

    r = await api.post("/saves", content=chunks(), headers={"Content-Type": "application/json"})
    assert "content-length" not in r.request.headers  # really streamed
    assert r.status_code == 413 and r.json()["error"]["code"] == "TOO_LARGE"


async def test_chunked_body_within_the_limit_reaches_the_route(api, jwt_for):
    async def chunks():
        yield b'{"text": '
        yield b'""}'

    r = await api.post("/saves", content=chunks(),
                       headers=auth(jwt_for(uuid.uuid4())) | {"Content-Type": "application/json"})
    # The route parsed the body: the empty text is what it refused.
    assert r.status_code == 422 and r.json()["error"]["message"] == "text is not valid."


# ------------------------------------------------------------ X-Timezone-Offset

@pytest.mark.parametrize("header,minutes", [
    ("330", 330), ("-300", -300), ("840", 840), ("-720", -720), (" 60 ", 60),
    (None, 0), ("", 0), ("841", 0), ("-721", 0), ("5.5", 0), ("IST", 0),
])
def test_timezone_offset_header(header, minutes):
    tz = client_timezone(header)
    assert tz.utcoffset(None) == timedelta(minutes=minutes)
    if minutes == 0:
        assert tz == UTC
