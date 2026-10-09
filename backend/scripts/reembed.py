"""Enqueue `embed` jobs so the worker (re)computes per-user embeddings.

Default: finished saves (enriched/partial) with no embedding yet.
--all: every finished save (after changing EMBEDDINGS_MODEL / provider).
Saves that already have an embed job waiting are skipped; safe to re-run.
The worker does the embedding (and respects the 'embeddings' provider budget).

Usage (from backend/):  python scripts/reembed.py [--all]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Make `app` importable when running as a plain script (scripts/ is sys.path[0]).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncpg  # noqa: E402

from app.config import settings  # noqa: E402
from app.enrich.backfill import enqueue_reembed  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--all", action="store_true", help="re-embed every finished save")
    args = ap.parse_args()
    conn = await asyncpg.connect(settings().database_url, statement_cache_size=0, timeout=15)
    try:
        n = await enqueue_reembed(conn, all_reels=args.all)
    finally:
        await conn.close()
    print(f"enqueued {n} embed job(s)")


if __name__ == "__main__":
    asyncio.run(main())
