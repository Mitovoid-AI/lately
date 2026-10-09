"""Run the enrichment chain for ONE reel URL and print the card JSON.

Uses the providers configured in backend/.env (embed page → yt-dlp → scraper,
Groq if GROQ_API_KEY, the LLM_* model). Live calls: one Instagram fetch, at
most one Groq transcription, one or two LLM calls (two when a repair is
needed). No queue, no budget, nothing written unless --write.

--write upserts the card into reel_content on DATABASE_URL (refusing any URL
that mentions 'prod') and copies the thumbnail to Storage when
SUPABASE_SERVICE_ROLE_KEY is set.

Usage (from backend/):
  python scripts/enrich_one.py https://www.instagram.com/reel/XXXX/
  python scripts/enrich_one.py <url> --no-transcribe
  python scripts/enrich_one.py <url> --write
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Make `app` importable when running as a plain script (scripts/ is sys.path[0]).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.enrich.oneshot import enrich_url
from app.enrich.runtime import build_runtime


async def _write(rt, out: dict) -> None:
    import asyncpg

    from app.worker import stages

    url = settings().database_url
    if "prod" in url.lower():
        sys.exit("refusing to write: DATABASE_URL mentions 'prod'")
    sc, f = out["shortcode"], out["fetch"]
    thumb = await rt.thumbnails.store(sc, f.get("thumbnail_url"))
    conn = await asyncpg.connect(url, statement_cache_size=0, timeout=15)
    try:
        await conn.execute(stages._UPSERT_FETCH, sc, f"https://www.instagram.com/reel/{sc}/",
                           f.get("caption"), f.get("creator_handle"), thumb, f.get("source"),
                           f.get("duration_s"), json.dumps(f))
        if out["transcript"]:
            await conn.execute("update public.reel_content set transcript = $2 "
                               "where shortcode = $1", sc, out["transcript"])
        await stages.write_card(conn, sc, out["card"], f.get("creator_handle"),
                                out["media_status"])
    finally:
        await conn.close()
    print(f"wrote reel_content {sc} ({out['media_status']})", file=sys.stderr)


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("url")
    ap.add_argument("--write", action="store_true", help="upsert the card into DATABASE_URL")
    ap.add_argument("--no-transcribe", action="store_true", help="skip Groq even if eligible")
    args = ap.parse_args()

    rt = build_runtime()
    rt.embedder = None  # never needed here; keeps paid embedding calls impossible
    if args.no_transcribe:
        rt.transcriber = None
    try:
        out = await enrich_url(rt, args.url)
        print(json.dumps(out, indent=2, ensure_ascii=False))
        if args.write:
            await _write(rt, out)
    finally:
        await rt.http.aclose()


if __name__ == "__main__":
    asyncio.run(main())
