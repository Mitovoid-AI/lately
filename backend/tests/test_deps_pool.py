"""The asyncpg pool: built from DATABASE_URL once, at startup."""

import os

import pytest

from app import deps


async def test_init_pool_uses_database_url_and_disables_statement_cache(monkeypatch):
    captured = {}
    async def fake_create_pool(dsn, **kw): captured.update(dsn=dsn, **kw); return object()
    monkeypatch.setattr(deps.asyncpg, "create_pool", fake_create_pool)
    monkeypatch.setattr(deps, "_pool", None)
    await deps.init_pool()
    assert captured["dsn"] == os.environ["DATABASE_URL"]
    assert captured["statement_cache_size"] == 0


def test_pool_before_init_raises(monkeypatch):
    monkeypatch.setattr(deps, "_pool", None)
    with pytest.raises(RuntimeError, match="init_pool"):
        deps.pool()
