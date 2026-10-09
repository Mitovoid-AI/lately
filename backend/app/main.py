"""Lately backend API — Part 1.

FastAPI app: catch path only. The API never touches Instagram or an AI API;
that happens in the worker (PIPELINE.md §3).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .deps import close_pool, init_pool
from .routers import me, saves
from .routers import stacks  # workstream A


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield
    await close_pool()


app = FastAPI(title="Lately API", version="0.1.0", lifespan=lifespan)
app.include_router(saves.router)
app.include_router(me.router)
app.include_router(stacks.router)

# The web build calls the API from another origin (Expo web on :8081/:8082 in dev).
# Native apps send no Origin header and are unaffected. Auth is the bearer token,
# never cookies, so credentials stay off.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings().cors_origin_list,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(StarletteHTTPException)
async def error_shape(request: Request, exc: StarletteHTTPException) -> Response:
    """Routes raise HTTPException(status, {"error": {...}}); send that body as-is
    (the spec's error shape) instead of FastAPI's {"detail": ...} wrapper."""
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(exc.detail, status_code=exc.status_code, headers=exc.headers)
    return await http_exception_handler(request, exc)


@app.get("/healthz", tags=["ops"])
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
