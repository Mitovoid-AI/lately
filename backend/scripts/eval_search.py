"""Run the search golden set and print one table row (SEARCH.md §11).

Usage (from backend/):
  python scripts/eval_search.py --golden tests/fixtures/golden-fixture.csv \
      --cards tests/fixtures/cards.json --embedder fake [--legs keyword,fuzzy,meaning]

Writes to the database in DATABASE_URL (or --database-url): it seeds the cards
for a dedicated eval user, replacing that user's saves. `--embedder real` uses
the EMBEDDINGS_* settings and costs money; `fake` is offline.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.search.embed import Embedder, FakeEmbedder, OpenAIEmbedder
from app.search.eval import load_golden, run_eval
from app.search.retrieve import ALL_LEGS


def _database_url(arg: str | None) -> str:
    if arg:
        return arg
    if url := os.environ.get("DATABASE_URL"):
        return url
    from app.config import settings

    return settings().database_url


def _embedder(kind: str) -> Embedder | None:
    if kind == "none":
        return None
    if kind == "fake":
        return FakeEmbedder()
    from app.config import settings

    s = settings()
    if not s.embeddings_api_key:
        sys.exit("--embedder real needs EMBEDDINGS_API_KEY")
    return OpenAIEmbedder(s.embeddings_api_key, s.embeddings_base_url, s.embeddings_model,
                          s.embeddings_dimensions)


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--golden", type=Path, required=True)
    ap.add_argument("--cards", type=Path, required=True)
    ap.add_argument("--embedder", choices=("fake", "real", "none"), default="fake")
    ap.add_argument("--legs", default=",".join(sorted(ALL_LEGS)))
    ap.add_argument("--database-url")
    ap.add_argument("--allow-shared-db", action="store_true",
                    help="allow a database named 'postgres' (the shared project DB)")
    args = ap.parse_args()

    legs = frozenset(x.strip() for x in args.legs.split(",") if x.strip())
    if not legs or not legs <= ALL_LEGS:
        sys.exit(f"--legs must be a subset of {sorted(ALL_LEGS)}")
    url = _database_url(args.database_url)
    if urlsplit(url).path.strip("/") == "postgres" and not args.allow_shared_db:
        sys.exit("refusing to seed the shared 'postgres' database; point DATABASE_URL at a "
                 "test database or pass --allow-shared-db")

    golden = load_golden(args.golden)
    cards = json.loads(args.cards.read_text(encoding="utf-8"))
    db = await asyncpg.create_pool(url, min_size=4, max_size=6, statement_cache_size=0)
    try:
        report = await run_eval(db, golden, cards, _embedder(args.embedder), legs)
    finally:
        await db.close()

    label = "+".join(leg for leg in ("keyword", "fuzzy", "meaning") if leg in legs)
    print(f"{'legs':<24} | recall@1 | recall@5 |  MRR | p95 ms")
    print(f"{label:<24} |     {report.recall1:.2f} |     {report.recall5:.2f} | "
          f"{report.mrr:.2f} | {report.p95_ms:6.1f}")
    print(f"p95 ms: {report.p95_ms:.1f}  ({len(golden)} queries, embedder={args.embedder})")
    for query, expected, got in report.misses:
        print(f"MISS  {query!r}: expected {expected}, top5 {got}")


if __name__ == "__main__":
    asyncio.run(main())
