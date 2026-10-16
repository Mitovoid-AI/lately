"""Search router — GET /search (SEARCH.md §5, §7).

Hybrid keyword + fuzzy + meaning search over the signed-in user's saves. The
query embedding runs alongside the keyword/fuzzy SQL and is dropped if the
provider is missing, failing or slower than `search_embed_timeout_seconds`, so
search always answers. Results use the app's `Save` shape plus match reasons.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel

from ..config import settings
from ..deps import CurrentUser, get_embedder, pool
from ..search.embed import Embedder, LruCache
from ..search.run import run_search
from ..search.why import build_why
from ..services.saves_view import SaveOut, fetch_saves
from ..services.text import clean_text

log = logging.getLogger(__name__)

router = APIRouter(tags=["search"])

# Query vectors keyed by normalised query text (SEARCH.md §5: cache the embedding).
QUERY_CACHE = LruCache(maxsize=2048)


class SearchHitOut(BaseModel):
    """frontend/src/api/contract.ts `SearchHit` = {save, why}; matched_by is extra."""

    save: SaveOut
    why: list[str]
    matched_by: list[str]


async def _metric(duration_ms: int, outcome: str, hits: int) -> None:
    try:
        await pool().execute(
            "insert into public.metrics (door, stage, duration_ms, outcome, detail) "
            "values ('api', 'search', $1, $2, $3::jsonb)",
            duration_ms, outcome, json.dumps({"hits": hits}))
    except Exception:  # metrics must never break search
        log.exception("search metric write failed")


@router.get("/search", response_model=list[SearchHitOut])
async def search(
    user: CurrentUser,
    background: BackgroundTasks,
    embedder: Annotated[Embedder | None, Depends(get_embedder)],
    q: Annotated[str, Query(min_length=1, max_length=200)],
    category: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[SearchHitOut]:
    started = time.monotonic()
    uid = uuid.UUID(user.id)
    db = pool()
    q = clean_text(q)
    run = await run_search(db, uid, q, embedder, category=category or None, limit=limit,
                           cache=QUERY_CACHE,
                           embed_timeout=settings().search_embed_timeout_seconds,
                           meaning_spread=settings().search_meaning_spread,
                           meaning_max_distance=settings().search_meaning_max_distance)
    hits = run.hits[:limit]
    saves = {s.id: s for s in await fetch_saves(db, uid, [h.reel_id for h in hits])}
    out = [
        SearchHitOut(
            save=saves[h.reel_id],
            why=build_why({"entity_names": h.entity_names, "note": saves[h.reel_id].note},
                          run.parsed, h.matched_by),
            matched_by=list(h.matched_by))
        for h in hits if h.reel_id in saves
    ]
    background.add_task(_metric, int((time.monotonic() - started) * 1000),
                       "ok" if run.embedded else "no_embed", len(out))
    return out
