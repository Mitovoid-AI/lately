"""CORS: the Expo web dev servers (.claude/launch.json: 8081 web, 8082 demo,
8083 live) may call the API from the browser; other origins may not."""

import httpx
import pytest

from app.main import app


async def preflight(origin: str) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://test") as c:
        return await c.options("/saves", headers={"Origin": origin,
                                                  "Access-Control-Request-Method": "GET"})


@pytest.mark.parametrize("port", [8081, 8082, 8083])
async def test_expo_web_dev_origins_are_allowed(port):
    origin = f"http://localhost:{port}"
    r = await preflight(origin)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin


async def test_other_origins_are_refused():
    r = await preflight("https://evil.example")
    assert "access-control-allow-origin" not in r.headers
