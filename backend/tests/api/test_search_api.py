"""GET /search: real JWT, real database, fake embedders (no paid calls)."""

from __future__ import annotations

import asyncio

import pytest

from app.deps import get_embedder
from app.main import app
from app.routers import search as search_router
from app.search.embed import FakeEmbedder
from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def seeded_api_user(db, make_user):
    uid = await make_user()
    for card in CARDS.values():
        await seed_card(db, uid, card, FakeEmbedder())
    app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
    search_router.QUERY_CACHE.clear()
    yield uid
    app.dependency_overrides.pop(get_embedder, None)
    search_router.QUERY_CACHE.clear()


class CountingEmbedder(FakeEmbedder):
    def __init__(self):
        self.calls = 0

    async def embed(self, texts, task):
        self.calls += 1
        return await super().embed(texts, task)


class FailingEmbedder:
    async def embed(self, texts, task):
        raise TimeoutError("embeddings provider down")


class SlowEmbedder:
    async def embed(self, texts, task):
        await asyncio.sleep(30)
        raise AssertionError("should have been cancelled")


async def _search(client, uid, jwt_for, **params):
    return await client.get("/search", params=params, headers=auth(jwt_for(uid)))


async def test_get_search_returns_card_fields_and_why(client, seeded_api_user, jwt_for):
    r = await _search(client, seeded_api_user, jwt_for, q="manali treks")
    assert r.status_code == 200
    top = r.json()[0]
    save = top["save"]
    assert save["title"].startswith("Hampta Pass")
    assert save["thumbnail_url"].endswith("/thumbnails/MANALI1.jpg")
    assert save["source_url"] == "https://www.instagram.com/reel/MANALI1/"
    assert save["shortcode"] == "MANALI1" and save["status"] == "enriched"
    assert "📍 Manali" in top["why"]
    assert "keyword" in top["matched_by"]


async def test_get_search_401_without_token(client):
    r = await client.get("/search", params={"q": "manali"})
    assert r.status_code == 401


async def test_get_search_works_without_embedder(client, seeded_api_user, jwt_for):
    app.dependency_overrides[get_embedder] = lambda: None
    r = await _search(client, seeded_api_user, jwt_for, q="manali treks")
    assert r.status_code == 200
    body = r.json()
    assert body[0]["save"]["shortcode"] == "MANALI1"
    assert all("meaning" not in h["matched_by"] for h in body)


async def test_get_search_embedder_failure_degrades(client, seeded_api_user, jwt_for, db):
    app.dependency_overrides[get_embedder] = lambda: FailingEmbedder()
    r = await _search(client, seeded_api_user, jwt_for, q="manali treks")
    assert r.status_code == 200
    assert r.json()[0]["save"]["shortcode"] == "MANALI1"
    row = await db.fetchrow(
        "select door, outcome, duration_ms from public.metrics where stage = 'search' "
        "order by id desc limit 1")
    assert row["door"] == "api" and row["outcome"] == "no_embed"
    assert row["duration_ms"] >= 0


async def test_get_search_slow_embedder_is_dropped(client, seeded_api_user, jwt_for,
                                                   monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings(), "search_embed_timeout_seconds", 0.2)
    app.dependency_overrides[get_embedder] = lambda: SlowEmbedder()
    r = await asyncio.wait_for(_search(client, seeded_api_user, jwt_for, q="manali treks"), 10)
    assert r.status_code == 200
    body = r.json()
    assert body[0]["save"]["shortcode"] == "MANALI1"
    assert all("meaning" not in h["matched_by"] for h in body)


async def test_get_search_metrics_ok_with_embedder(client, seeded_api_user, jwt_for, db):
    r = await _search(client, seeded_api_user, jwt_for, q="mountain reel")
    assert r.status_code == 200
    assert "meaning" in r.json()[0]["matched_by"]
    assert await db.fetchval(
        "select outcome from public.metrics where stage = 'search' order by id desc limit 1"
    ) == "ok"


async def test_get_search_category_filter(client, seeded_api_user, jwt_for):
    r = await _search(client, seeded_api_user, jwt_for, q="github", category="Dev & Tools")
    assert r.status_code == 200
    codes = {h["save"]["shortcode"] for h in r.json()}
    assert codes and codes <= {"GITHUB1", "JOBS1"}


async def test_get_search_limit(client, seeded_api_user, jwt_for):
    r = await _search(client, seeded_api_user, jwt_for, q="manali", limit=1)
    assert r.status_code == 200 and len(r.json()) == 1
    for bad in (0, 51):
        r = await _search(client, seeded_api_user, jwt_for, q="manali", limit=bad)
        assert r.status_code == 422


async def test_get_search_noise_only_query_returns_200(client, seeded_api_user, jwt_for):
    r = await _search(client, seeded_api_user, jwt_for, q="reel")
    assert r.status_code == 200 and isinstance(r.json(), list)


async def test_get_search_junk_query_returns_200(client, seeded_api_user, jwt_for):
    r = await _search(client, seeded_api_user, jwt_for, q='c++ 🚀 "rooftop" -cafe')
    assert r.status_code == 200


async def test_get_search_q_too_long_422(client, seeded_api_user, jwt_for):
    r = await _search(client, seeded_api_user, jwt_for, q="a" * 201)
    assert r.status_code == 422
    r = await _search(client, seeded_api_user, jwt_for, q="")
    assert r.status_code == 422


async def test_get_search_no_saves_returns_empty(client, make_user, jwt_for):
    app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
    try:
        r = await _search(client, await make_user(), jwt_for, q="manali")
    finally:
        app.dependency_overrides.pop(get_embedder, None)
    assert r.status_code == 200 and r.json() == []


async def test_get_search_scoped_to_user(client, seeded_api_user, make_user, jwt_for):
    other = await make_user()
    r = await _search(client, other, jwt_for, q="manali treks")
    assert r.status_code == 200 and r.json() == []


async def test_query_embedding_is_cached(client, seeded_api_user, jwt_for):
    counting = CountingEmbedder()
    app.dependency_overrides[get_embedder] = lambda: counting
    for _ in range(2):
        r = await _search(client, seeded_api_user, jwt_for, q="manali treks")
        assert r.status_code == 200
    assert counting.calls == 1
