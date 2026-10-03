"""Lately backend self-check + debug logger.

Run from backend/ with the venv active:

    python scripts/debug.py                 # safe checks (no network, no DB writes)
    python scripts/debug.py --live          # + DB checks (read-only: tables, queue depth)
    python scripts/debug.py --api http://localhost:8000   # + hit a running API
    python scripts/debug.py --log-level DEBUG
    python scripts/debug.py --live --api http://localhost:8000

Every run writes a timestamped log to logs/ so you can attach it to a bug
report later. Exit code: 0 = all checks passed, 1 = at least one failed.

What it checks:
  config  — env vars parse, required keys present, AI keys flagged if absent
  urls    — pure URL helpers: extract, shortcode, share-link, tracking strip
  stages  — worker stage graph complete, chain terminates, no unknown stage
  auth    — missing token is rejected (401) without any network call
  db      — (live) pool connects, 0003 tables + RPCs exist, queue depth stats
  api     — (live, --api) /healthz, route table, auth actually enforced on /saves

Read-only by design: this script never inserts, updates, or claims jobs.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

# Make `app` importable when running as a plain script (scripts/ is sys.path[0]).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

log = logging.getLogger("lately.debug")

RESULTS: list[tuple[str, str, float]] = []  # (check, PASS/FAIL/SKIP, seconds)


# --------------------------------------------------------------------- setup --

def setup_logging(level: str) -> Path:
    """Console + timestamped file logger. Returns the log file path."""
    # Windows consoles default to cp1252; box-drawing glyphs would crash emit().
    with contextlib.suppress(Exception):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logs_dir = Path(__file__).resolve().parents[1] / "logs"
    logs_dir.mkdir(exist_ok=True)
    logfile = logs_dir / f"debug-{datetime.now():%Y%m%d-%H%M%S}.log"

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s", "%H:%M:%S"
    )
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    root.addHandler(console)

    file_handler = logging.FileHandler(logfile, encoding="utf-8")
    file_handler.setFormatter(
        logging.Formatter(
            "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"
        )
    )
    root.addHandler(file_handler)

    # Chatty libs down a notch in the file log too.
    for noisy in ("httpx", "httpcore", "asyncpg"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return logfile


def check(name: str):
    """Decorator that runs an async check, times it, logs outcome, never crashes."""

    def wrap(fn):
        async def run() -> None:
            started = time.perf_counter()
            log.info("── check: %s ──", name)
            try:
                await fn()
                RESULTS.append((name, "PASS", time.perf_counter() - started))
            except Skip as exc:
                log.warning("SKIP: %s", exc)
                RESULTS.append((name, "SKIP", time.perf_counter() - started))
            except Exception as exc:  # noqa: BLE001 — a failing check must not stop the rest
                log.exception("FAIL: %s", exc)
                RESULTS.append((name, "FAIL", time.perf_counter() - started))

        return run

    return wrap


class Skip(Exception):
    """Raise inside a check to mark it skipped (e.g. missing --live flag)."""


def expect(label: str, actual: object, wanted: object) -> None:
    if actual != wanted:
        raise AssertionError(f"{label}: got {actual!r}, want {wanted!r}")
    log.info("  ✓ %s = %r", label, actual)


# ------------------------------------------------------------------- checks --

@check("config")
async def check_config() -> None:
    from app.config import Settings

    try:
        s = Settings()
    except Exception as exc:  # ValidationError — list what's missing
        missing = [
            e["loc"][0] for e in getattr(exc, "errors", lambda: [])()
            if e.get("type", "").startswith("missing")
        ]
        if missing:
            raise Skip(f"env vars missing: {missing} (copy .env.example → .env)") from exc
        raise
    log.info("  supabase_url = %s", s.supabase_url)
    log.info("  service_role_key = %s…%s (len %d)",
             s.supabase_service_role_key[:6], s.supabase_service_role_key[-4:],
             len(s.supabase_service_role_key))
    log.info("  jwt_audience = %r (empty = audience check skipped)", s.supabase_jwt_audience)
    log.info("  rate_limit_per_hour = %d, worker_poll = %ss",
             s.rate_limit_per_hour, s.worker_poll_interval_seconds)
    log.info("  AI keys: groq=%s gemini=%s",
             "set" if s.groq_api_key else "ABSENT (cards stay partial — fine for Part 1)",
             "set" if s.gemini_api_key else "ABSENT (fine for Part 1)")
    if not s.supabase_service_role_key.startswith("ey"):
        log.warning("  service_role_key doesn't look like a JWT — double-check it")


@check("urls (pure helpers)")
async def check_urls() -> None:
    from app.urls import (
        extract_instagram_url, is_share_link, normalize_shared_text,
        parse_shortcode, strip_tracking_params,
    )

    expect("extract from shared text",
           extract_instagram_url("lol look at this https://www.instagram.com/reel/Cx1y2z3/?igsh=abc dead"),
           "https://www.instagram.com/reel/Cx1y2z3/?igsh=abc")
    expect("extract returns None without link",
           extract_instagram_url("no link here"), None)
    expect("shortcode /reel/", parse_shortcode("https://instagram.com/reel/Cx1y2z3/"), "Cx1y2z3")
    expect("shortcode /reels/", parse_shortcode("https://www.instagram.com/reels/AbCdEf_-1/"), "AbCdEf_-1")
    expect("shortcode /p/", parse_shortcode("https://instagram.com/p/DpQrSt9/"), "DpQrSt9")
    expect("share link has no shortcode yet",
           parse_shortcode("https://www.instagram.com/share/reel/ABC123"), None)
    expect("share link detected", is_share_link("https://www.instagram.com/share/reel/ABC123"), True)
    expect("non-IG rejected", is_share_link("https://tiktok.com/reel/xyz"), False)
    expect("tracking stripped",
           strip_tracking_params("https://www.instagram.com/reel/Cx1y2z3/?igsh=abc&utm_source=share"),
           "https://www.instagram.com/reel/Cx1y2z3/")
    expect("normalize full pipeline",
           normalize_shared_text("check it https://www.instagram.com/reel/Cx1y2z3/?igsh=xyz"),
           "https://www.instagram.com/reel/Cx1y2z3/")


@check("worker stage graph")
async def check_stage_graph() -> None:
    from app.worker import stages

    expected_chain = ["resolve", "fetch", "transcribe", "vision", "structure", "finalize"]
    expect("stage registry", sorted(stages.STAGES), sorted(expected_chain))

    # Chain must terminate: follow NEXT from resolve, no cycles, ends at None.
    node, seen = "resolve", set()
    while node is not None:
        expect("  chain step", node, expected_chain[len(seen)])
        if node in seen:
            raise AssertionError(f"cycle at {node}")
        seen.add(node)
        node = stages.NEXT.get(node)
    log.info("  ✓ chain terminates after finalize")

    log.info("  implemented now: resolve, finalize; stubs await Parts 2–3: %s",
             sorted(set(stages.STAGES) - {"resolve", "finalize"}))


@check("auth rejects missing token")
async def check_auth_rejects() -> None:
    from fastapi import HTTPException
    from starlette.requests import Request

    from app.deps import get_current_user

    scope = {"type": "http", "headers": []}
    request = Request(scope)
    try:
        await get_current_user(request)
    except HTTPException as exc:
        expect("no bearer → 401", exc.status_code, 401)
        return
    raise AssertionError("get_current_user accepted a request with no token — SECURITY BUG")


@check("db (read-only)", )
async def check_db() -> None:
    if "--live" not in sys.argv:
        raise Skip("pass --live to check the database")

    from app.deps import close_pool, pool

    conn = await pool().acquire()
    assert conn is not None
    try:
        expect("select 1", await conn.fetchval("select 1"), 1)

        tables = {
            r[0] for r in await conn.fetch(
                "select tablename from pg_tables where schemaname = 'public'"
            )
        }
        for t in ("reels", "reel_content", "jobs", "jobs_dead", "metrics"):
            log.info("  ✓ table %s %s", t, "exists" if t in tables else "MISSING")
        missing = {"reels", "reel_content", "jobs", "jobs_dead", "metrics"} - tables
        if missing:
            raise AssertionError(f"tables missing — apply backend/migrations/0003_pipeline.sql: {sorted(missing)}")

        rpcs = {
            r[0] for r in await conn.fetch(
                "select proname from pg_proc where pronamespace = 'public'::regnamespace"
            )
        }
        for fn in ("save_reel", "claim_job", "release_job"):
            log.info("  ✓ rpc %s %s", fn, "exists" if fn in rpcs else "MISSING")
        missing_rpc = {"save_reel", "claim_job", "release_job"} - rpcs
        if missing_rpc:
            raise AssertionError(f"RPCs missing — re-run 0003_pipeline.sql: {sorted(missing_rpc)}")

        pending = await conn.fetchval("select count(*) from public.jobs")
        locked = await conn.fetchval("select count(*) from public.jobs where locked_at is not null")
        dead = await conn.fetchval("select count(*) from public.jobs_dead")
        reels = await conn.fetchval("select count(*) from public.reels")
        content = await conn.fetchval("select count(*) from public.reel_content")
        log.info("  queue: pending=%s locked=%s dead=%s | reels=%s reel_content=%s",
                 pending, locked, dead, reels, content)
        if dead:
            log.warning("  %s dead jobs — inspect jobs_dead (last_error column)", dead)
    finally:
        await pool().release(conn)
        await close_pool()


@check("api (running server)")
async def check_api() -> None:
    base = next((a for a in sys.argv[1:] if a.startswith("http")), None)
    if not base:
        raise Skip("pass --api http://localhost:8000 to check a running server")

    import httpx

    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(f"{base}/healthz")
        expect("GET /healthz", r.status_code, 200)
        log.info("  ✓ body=%s", r.json())

        spec = (await client.get(f"{base}/openapi.json")).json()
        routes = sorted(f"{m.upper():6} {p}" for p, ops in spec["paths"].items() for m in ops)
        for rt in routes:
            log.info("  ✓ route %s", rt)

        # Auth must actually be enforced: unauthenticated save → 401, not 500/422.
        r = await client.post(f"{base}/saves", json={"text": "https://instagram.com/reel/DeAdBeEf/"})
        log.info("  unauth POST /saves → %s (want 401)", r.status_code)
        if r.status_code != 401:
            raise AssertionError(f"unauthenticated save returned {r.status_code}, want 401")


# -------------------------------------------------------------------- main --

async def main() -> int:
    parser = argparse.ArgumentParser(description="Lately backend self-check")
    parser.add_argument("--live", action="store_true", help="include read-only DB checks")
    parser.add_argument("--api", metavar="URL", help="base URL of a running API to poke")
    parser.add_argument("--log-level", default="INFO", help="DEBUG | INFO | WARNING")
    args = parser.parse_args()

    # Re-inject flags the @check decorators peek at (kept simple on purpose).
    sys.argv = [sys.argv[0]] + (["--live"] if args.live else []) + ([args.api] if args.api else [])

    logfile = setup_logging(args.log_level)
    log.info("Lately backend self-check — log file: %s", logfile)

    for fn in (check_config, check_urls, check_stage_graph,
               check_auth_rejects, check_db, check_api):
        await fn()

    failed = sum(1 for _, status, _ in RESULTS if status == "FAIL")
    skipped = sum(1 for _, status, _ in RESULTS if status == "SKIP")
    passed = len(RESULTS) - failed - skipped
    log.info("═══ summary ═══")
    for name, status, secs in RESULTS:
        log.info("  %-4s %-28s (%.2fs)", status, name, secs)
    log.info("%d passed, %d skipped, %d failed — log saved to %s",
             passed, skipped, failed, logfile)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
