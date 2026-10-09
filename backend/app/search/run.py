"""One search, end to end, with the query embedding off the critical path.

Order of work (SEARCH.md §5, review gap 1):

1. Parse the query once without places: that gives the text and the date
   filters (places only add a hint, never change the text).
2. Run three things at once: the user's known places, the keyword + fuzzy
   SQL, and the meaning leg. The meaning leg first waits for the query vector
   (cache, else the embedder, at most `embed_timeout` seconds) and runs its
   SQL the moment the vector arrives. No embedder, a failure or a timeout
   skips that leg; keyword and fuzzy never wait on it.
3. Re-parse with the known places for the place hint, then fuse in Python
   (RRF k=60, same weights and hint boosts as the single-statement SQL).
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
from .retrieve import ALL_LEGS, FUSED_CAP, Hit, LegRow, fuse, lexical_rows, meaning_rows

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

    async def meaning_leg() -> tuple[bool, list[LegRow]]:
        vec = await query_vector(embedder if want_vec else None, base.text, cache=cache,
                                 timeout=embed_timeout)
        if vec is None:
            return False, []
        return True, await meaning_rows(db, user_id, base, vec, category=category, legs=legs)

    # A TaskGroup cancels the other legs (and the embedding call) if one fails.
    async with asyncio.TaskGroup() as tg:
        places_t = tg.create_task(known_places(db, user_id))
        lexical_t = tg.create_task(
            lexical_rows(db, user_id, base, category=category, legs=legs))
        meaning_t = tg.create_task(meaning_leg())

    embedded, meaning = meaning_t.result()
    parsed = parse_query(q, now=now, known_places=places_t.result())
    return SearchRun(parsed, fuse([*lexical_t.result(), *meaning], parsed, limit), embedded)
