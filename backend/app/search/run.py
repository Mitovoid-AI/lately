"""One search, end to end, with the query embedding off the critical path.

Order of work (SEARCH.md §5, review gap 1):

1. Parse the query once without places to get the text and the date filters,
   and start the embedding call (cache first) right away.
2. In parallel with it: load this user's known places and run the keyword +
   fuzzy SQL. Neither needs the vector.
3. Re-parse with the known places for the place hint (the text is unchanged).
4. Wait for the vector, at most `embed_timeout` seconds in total. If it came,
   run the meaning SQL; if the embedder is missing, failed or was too slow,
   skip that leg.
5. Fuse in Python.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import asyncpg

from .embed import Embedder, LruCache
from .query import ParsedQuery, parse_query
from .retrieve import ALL_LEGS, FUSED_CAP, Hit, fuse, lexical_rows, meaning_rows

log = logging.getLogger(__name__)

KNOWN_PLACES_SQL = """
select distinct unnest(rc.entity_names) as place
from public.reels r
join public.reel_content rc on rc.shortcode = r.shortcode_key
where r.auth_user_id = $1
limit 500
"""


@dataclass(frozen=True)
class SearchRun:
    parsed: ParsedQuery
    hits: list[Hit]
    embedded: bool  # False → the meaning leg was skipped


async def known_places(db: asyncpg.Pool, user_id: UUID) -> list[str]:
    return [r["place"] for r in await db.fetch(KNOWN_PLACES_SQL, user_id) if r["place"]]


async def query_vector(embedder: Embedder | None, text: str, *, cache: LruCache | None,
                       timeout: float) -> list[float] | None:
    """Cached query vector, or None when there is no embedder, it fails, or it
    takes longer than `timeout` seconds. Never raises (except cancellation)."""
    if embedder is None or not text:
        return None
    if cache is not None and (hit := cache.get(text)) is not None:
        return hit
    try:
        (vec,) = await asyncio.wait_for(embedder.embed([text], "query"), timeout)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 — provider down, slow or malformed: go on
        log.warning("query embedding skipped: %s: %s", type(exc).__name__, exc)
        return None
    if cache is not None:
        cache.put(text, vec)
    return vec


async def run_search(db: asyncpg.Pool, user_id: UUID, q: str, embedder: Embedder | None, *,
                     category: str | None = None, legs: frozenset[str] = ALL_LEGS,
                     limit: int = FUSED_CAP, cache: LruCache | None = None,
                     embed_timeout: float = 2.0, now: datetime | None = None) -> SearchRun:
    now = now or datetime.now(UTC)
    base = parse_query(q, now=now, known_places=())
    if not base.text:
        return SearchRun(base, [], False)

    want_vec = "meaning" in legs and embedder is not None
    vec_task = asyncio.ensure_future(
        query_vector(embedder if want_vec else None, base.text, cache=cache,
                     timeout=embed_timeout))
    try:
        places, lexical = await asyncio.gather(
            known_places(db, user_id),
            lexical_rows(db, user_id, base, category=category, legs=legs))
        vec = await vec_task
    finally:
        if not vec_task.done():
            vec_task.cancel()

    parsed = parse_query(q, now=now, known_places=places)
    meaning = await meaning_rows(db, user_id, parsed, vec, category=category, legs=legs)
    return SearchRun(parsed, fuse([*lexical, *meaning], parsed, limit), vec is not None)
