"""Lately backend API — Part 1.

FastAPI app: catch path only. The API never touches Instagram or an AI API;
that happens in the worker (PIPELINE.md §3).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import settings
from .deps import close_pool, init_pool
from .routers import admin as admin_router  # workstream A
from .routers import billing as billing_router
from .routers import curated as curated_router  # workstream A
from .routers import instagram as instagram_router
from .routers import me, saves
from .routers import search as search_router
from .routers import stacks as stacks_router  # workstream A
from .routers import thumbnails as thumbnails_router
from .routers.saves import retries_router  # workstream A
from .services.thumbnails import BaseUrlMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield
    await close_pool()


app = FastAPI(title="Lately API", version="0.1.0", lifespan=lifespan)
app.include_router(saves.router)
app.include_router(me.router)
app.include_router(search_router.router)
app.include_router(stacks_router.router)
app.include_router(retries_router)
app.include_router(curated_router.router)
app.include_router(admin_router.router)
app.include_router(billing_router.router)
app.include_router(thumbnails_router.router)
app.include_router(instagram_router.router)

MAX_BODY_BYTES = 128 * 1024


class BodySizeLimit:
    """Refuse request bodies over `max_bytes` with 413 before a route sees them:
    up front when Content-Length says so, else by reading the (chunked) body here
    and counting. A body within the limit is handed on unchanged."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def _refuse(self, scope: Scope, receive: Receive, send: Send) -> None:
        body = {"error": {"code": "TOO_LARGE", "message": "That request is too large."}}
        await JSONResponse(body, status_code=413)(scope, receive, send)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope["headers"]:
            if name == b"content-length" and value.isdigit() and int(value) > self.max_bytes:
                await self._refuse(scope, receive, send)
                return
        chunks: list[bytes] = []
        size = 0
        first: Message | None = None  # a disconnect before the body ended
        while True:
            message = await receive()
            if message["type"] != "http.request":
                first = message
                break
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await self._refuse(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        pending = [first or {"type": "http.request", "body": b"".join(chunks), "more_body": False}]

        async def replay() -> Message:
            return pending.pop() if pending else await receive()

        await self.app(scope, replay, send)


# Innermost of the middlewares below, so a 413 still carries the CORS headers.
app.add_middleware(BodySizeLimit)

# The web build calls the API from another origin (Expo web on :8081/:8082 in dev).
# Native apps send no Origin header and are unaffected. Auth is the bearer token,
# never cookies, so credentials stay off.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings().cors_origin_list,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Timezone-Offset"],
)
# Thumbnails kept in Postgres are linked on the host each request came in on.
app.add_middleware(BaseUrlMiddleware)


@app.exception_handler(StarletteHTTPException)
async def error_shape(request: Request, exc: StarletteHTTPException) -> Response:
    """Routes raise HTTPException(status, {"error": {...}}); send that body as-is
    (the spec's error shape) instead of FastAPI's {"detail": ...} wrapper."""
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(exc.detail, status_code=exc.status_code, headers=exc.headers)
    return await http_exception_handler(request, exc)


@app.exception_handler(RequestValidationError)
async def validation_error_shape(request: Request, exc: RequestValidationError) -> Response:
    """A 422 in the spec's error shape, naming the first bad field. The input
    itself is never echoed back (FastAPI's default body repeats it)."""
    errors = exc.errors()
    err = errors[0] if errors else {}
    if err.get("type") == "json_invalid":
        message = "The request body is not valid JSON."
    else:
        where = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path", "header")]
        field = ".".join(where) or "request body"
        missing = err.get("type") == "missing"
        message = f"{field} is required." if missing else f"{field} is not valid."
    return JSONResponse({"error": {"code": "BAD_REQUEST", "message": message}}, status_code=422)


@app.get("/healthz", tags=["ops"])
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
