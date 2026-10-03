"""Lately backend API — Part 1.

FastAPI app: catch path only. The API never touches Instagram or an AI API;
that happens in the worker (PIPELINE.md §3).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .deps import close_pool, init_pool
from .routers import saves


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield
    await close_pool()


app = FastAPI(title="Lately API", version="0.1.0", lifespan=lifespan)
app.include_router(saves.router)


@app.get("/healthz", tags=["ops"])
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
