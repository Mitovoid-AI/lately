"""Live end-to-end run: save real reels → worker builds cards → search them.

Drives the real FastAPI app in-process (every route, query and RPC as the app
calls them) and a real worker process (`python -m app.worker`) with the
providers in backend/.env (IG embed page, Groq, the LLM_* model, embeddings). Identity is a dedicated dev
user, `e2e@lately.local`; the Supabase token check in front of it is covered
by the unit tests (tests/api, `jwt_for`).

Live calls: per new reel one Instagram fetch, at most one Groq transcription,
one or two LLM calls and one embedding; per query one embedding (cached).

Usage (from backend/):
  python scripts/e2e_live.py --urls reels.txt
  python scripts/e2e_live.py --urls reels.txt --queries queries.tsv
  python scripts/e2e_live.py --queries queries.tsv            # search only
  python scripts/e2e_live.py --reset                          # forget the e2e user's saves
  python scripts/e2e_live.py --urls reels.txt --external-worker   # dev.py runs the worker

reels.txt: one URL per line (# comments). queries.tsv: `query<TAB>shortcode[,shortcode]`
per line; the expected shortcodes must appear in the top 3 (exit 1 otherwise).
Refuses a DATABASE_URL that mentions 'prod'.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

# Make `app` importable when running as a plain script (scripts/ is sys.path[0]).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from app.config import settings
from app.deps import AuthUser, close_pool, get_current_user, init_pool

E2E_USER_ID = uuid.UUID("e2e0e2e0-0000-4000-8000-00000000e2e0")
E2E_EMAIL = "e2e@lately.local"
TOP_N = 3

log = logging.getLogger("lately.e2e")


def _lines(path: str) -> list[str]:
    """Non-empty lines that aren't `#` comments."""
    lines = (raw.strip() for raw in Path(path).read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


async def ensure_user(db) -> None:
    """The e2e auth user + a pro profile (no monthly cap), created once."""
    await db.execute(
        """insert into auth.users (id, email, aud, role, raw_app_meta_data)
           values ($1, $2, 'authenticated', 'authenticated',
                   '{"provider": "email", "providers": ["email"]}'::jsonb)
           on conflict (id) do nothing""", E2E_USER_ID, E2E_EMAIL)
    await db.execute(
        """insert into public.profiles (id, plan) values ($1, 'pro')
           on conflict (id) do update set plan = 'pro'""", E2E_USER_ID)


async def reset(db) -> None:
    n = await db.fetchval(
        "with d as (delete from public.reels where auth_user_id = $1 returning 1) "
        "select count(*) from d", E2E_USER_ID)
    await db.execute("delete from public.save_events where auth_user_id = $1", E2E_USER_ID)
    print(f"removed {n} saves of {E2E_EMAIL}")


async def wait_for_cards(client: httpx.AsyncClient, db, ids: list[str], timeout: float) -> dict:
    """Poll GET /saves/{id} like the app does until no save is pending."""
    started, last_report = time.monotonic(), 0.0
    done: dict[str, dict] = {}
    while time.monotonic() - started < timeout:
        for sid in ids:
            if sid in done:
                continue
            r = await client.get(f"/saves/{sid}")
            if r.status_code == 404:  # a /share/ duplicate the worker dropped
                done[sid] = {"status": "dropped", "seconds": time.monotonic() - started}
                continue
            body = r.json()
            if body["status"] != "pending":
                done[sid] = {**body, "seconds": time.monotonic() - started}
        if len(done) == len(ids):
            break
        if time.monotonic() - last_report > 15:
            last_report = time.monotonic()
            queue = await db.fetchval("select count(*) from public.jobs where kind = 'enrich'")
            print(f"  … {len(done)}/{len(ids)} done, {queue} enrich jobs queued "
                  f"({time.monotonic() - started:.0f}s)", flush=True)
        await asyncio.sleep(1.0)
    return done


async def wait_for_embeddings(db, timeout: float) -> int:
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        left = await db.fetchval(
            """select count(*) from public.jobs j
               where j.kind = 'embed' and (j.payload->>'reel_id')::uuid in
                     (select id from public.reels where auth_user_id = $1)""", E2E_USER_ID)
        if not left:
            break
        await asyncio.sleep(1.0)
    return await db.fetchval(
        "select count(*) from public.reels where auth_user_id = $1 and embedding is not null",
        E2E_USER_ID)


def _short(s: str | None, n: int) -> str:
    s = (s or "").replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


async def run_queries(client: httpx.AsyncClient, path: str) -> int:
    failures = 0
    print("\nsearch")
    for line in _lines(path):
        query, _, expected = line.partition("\t")
        want = {w.strip() for w in expected.split(",") if w.strip()}
        t0 = time.monotonic()
        r = await client.get("/search", params={"q": query, "limit": 10})
        ms = (time.monotonic() - t0) * 1000
        if r.status_code != 200:
            print(f"  ✗ {query!r}: HTTP {r.status_code} {r.text[:200]}")
            failures += 1
            continue
        hits = r.json()
        top = [h["save"]["shortcode"] for h in hits[:TOP_N]]
        ok = not want or bool(want & set(top))
        failures += 0 if ok else 1
        mark = "✓" if ok else "✗"
        print(f"  {mark} {query!r} ({ms:.0f} ms, {len(hits)} hits)"
              + (f" want {sorted(want)}" if want else ""))
        for h in hits[:TOP_N]:
            s = h["save"]
            print(f"      {s['shortcode']:<12} {_short(s['title'], 60):<60} "
                  f"[{','.join(h['matched_by'])}] {_short('; '.join(h['why']), 50)}")
    return failures


def start_worker(verbose: bool) -> subprocess.Popen[bytes]:
    """`python -m app.worker` in its own process, as in production: sharing this
    event loop with the in-process API made every stage several times slower."""
    out = None if verbose else subprocess.DEVNULL
    return subprocess.Popen([sys.executable, "-m", "app.worker"],
                            cwd=Path(__file__).resolve().parents[1],
                            env={**os.environ, "PYTHONIOENCODING": "utf-8"}, stdout=out, stderr=out)


def stop_worker(worker: subprocess.Popen[bytes]) -> None:
    worker.terminate()
    with contextlib.suppress(subprocess.TimeoutExpired):
        worker.wait(timeout=20)


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--urls", help="file of reel URLs to save")
    ap.add_argument("--queries", help="file of query<TAB>expected-shortcodes lines")
    ap.add_argument("--reset", action="store_true", help="delete the e2e user's saves first")
    ap.add_argument("--external-worker", action="store_true",
                    help="don't run a worker in-process (dev.py is running one)")
    ap.add_argument("--timeout", type=float, default=900.0, help="seconds to wait for cards")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    with contextlib.suppress(Exception):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        format="%(asctime)s %(name)s %(message)s")

    s = settings()
    if "prod" in s.database_url.lower():
        sys.exit("refusing: DATABASE_URL mentions 'prod'")

    from app.main import app

    db = await init_pool()
    worker: subprocess.Popen[bytes] | None = None
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=str(E2E_USER_ID),
                                                                  email=E2E_EMAIL)
    failures = 0
    try:
        await ensure_user(db)
        if args.reset:
            await reset(db)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://127.0.0.1:8001", timeout=60) as client:
            if args.urls:
                urls = _lines(args.urls)
                if not args.external_worker:
                    worker = start_worker(args.verbose)
                ids, new = [], 0
                for url in urls:
                    r = await client.post("/saves", json={"text": url, "channel": "app_share"})
                    if r.status_code not in (200, 201):
                        print(f"  ✗ save {url}: HTTP {r.status_code} {r.text[:200]}")
                        failures += 1
                        continue
                    ids.append(r.json()["reel_id"])
                    new += r.status_code == 201
                print(f"saved {len(ids)} reels ({new} new, {len(ids) - new} already saved)")
                done = await wait_for_cards(client, db, ids, args.timeout)
                print(f"\n{'shortcode':<12} {'status':<9} {'secs':>5}  {'category':<14} title")
                for sid in ids:
                    d = done.get(sid)
                    if d is None:
                        print(f"{'?':<12} {'TIMEOUT':<9}")
                        failures += 1
                        continue
                    print(f"{d.get('shortcode') or '-':<12} {d['status']:<9} {d['seconds']:5.0f}  "
                          f"{_short(d.get('category'), 14):<14} {_short(d.get('title'), 70)}")
                    failures += d["status"] not in ("enriched", "dropped")
                embedded = await wait_for_embeddings(db, timeout=120)
                print(f"\nembeddings: {embedded} saves of {E2E_EMAIL} have a vector")
            if args.queries:
                failures += await run_queries(client, args.queries)
    finally:
        if worker is not None:
            stop_worker(worker)
        app.dependency_overrides.pop(get_current_user, None)
        await close_pool()
    print(f"\n{'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
