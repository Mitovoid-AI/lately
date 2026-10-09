"""Hybrid retrieval (SEARCH.md §5 steps 3–4).

Three legs over one user's saves — keyword (weighted `tsvector`), fuzzy
(`pg_trgm` word similarity) and meaning (pgvector exact scan) — fused with
reciprocal rank fusion in Python.

The SQL from §5 is split in two statements so the keyword and fuzzy legs never
wait on the query embedding: `lexical_rows` runs while the embedding is in
flight, `meaning_rows` runs once the vector arrives (or not at all), and
`fuse` merges them with the same weights the single-statement SQL used.
Hard filters (category chip, saved_after / saved_before) are in the shared
`mine` CTE, so every leg obeys them. Every statement is scoped to
`auth_user_id = $1`.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

from .embed import to_pgvector
from .query import ParsedQuery

ALL_LEGS: frozenset[str] = frozenset({"keyword", "fuzzy", "meaning"})
LEG_ORDER: tuple[str, ...] = ("keyword", "meaning", "fuzzy")

RRF_K = 60
WEIGHTS: dict[str, float] = {"keyword": 1.0, "meaning": 1.0, "fuzzy": 0.7}
HINT_BOOST = 0.008
FUSED_CAP = 30
KEYWORD_LIMIT, FUZZY_LIMIT, MEANING_LIMIT = 50, 20, 50


@dataclass(frozen=True)
class Hit:
    reel_id: UUID
    score: float
    matched_by: tuple[str, ...]
    entity_names: tuple[str, ...] = ()


@dataclass(frozen=True)
class LegRow:
    reel_id: UUID
    leg: str
    rank: int
    created_at: datetime
    category: str | None
    entity_names: tuple[str, ...]


# $1 user id · $2 filters jsonb (hard: category, saved_after, saved_before)
_MINE = """
mine as (
  select r.id, r.created_at, rc.category, rc.entity_names{extra}
  from public.reels r
  left join public.reel_content rc on rc.shortcode = r.shortcode_key
  where r.auth_user_id = $1
    and ($2::jsonb->>'category' is null or rc.category = $2::jsonb->>'category')
    and ($2::jsonb->>'saved_after' is null
         or r.created_at >= ($2::jsonb->>'saved_after')::timestamptz)
    and ($2::jsonb->>'saved_before' is null
         or r.created_at < ($2::jsonb->>'saved_before')::timestamptz)
)"""

# $3 normalized query text · $4 keyword leg on · $5 fuzzy leg on
LEXICAL_SQL = f"""
with q as (
  select websearch_to_tsquery('english', $3) as tq
),
{_MINE.format(extra=''',
         coalesce(rc.tsv, ''::tsvector) || coalesce(r.note_tsv, ''::tsvector) as doc,
         coalesce(rc.match_text, '') || ' ' || coalesce(r.note, '')          as match_text''')},
kw as (
  select m.id, row_number() over (order by ts_rank_cd(m.doc, q.tq) desc, m.created_at desc) as rk
  from mine m, q
  where $4::boolean and m.doc @@ q.tq
  order by rk limit {KEYWORD_LIMIT}
),
fz as (
  select m.id,
         row_number() over (order by word_similarity($3, m.match_text) desc,
                                     m.created_at desc) as rk
  from mine m
  where $5::boolean and $3 <% m.match_text
  order by rk limit {FUZZY_LIMIT}
)
select x.id, x.src, x.rk, m.created_at, m.category, m.entity_names
from (
  select id, rk, 'keyword' as src from kw
  union all select id, rk, 'fuzzy' from fz
) x
join mine m using (id)
"""

# $3 query embedding, sent as text: a bare `$3::vector` makes asyncpg introspect the
# pgvector type on every call (no statement cache on the pooler), one extra round trip.
MEANING_SQL = f"""
with {_MINE.format(extra=', r.embedding').strip()},
vec as (
  select m.id,
         row_number() over (order by m.embedding <=> $3::text::vector,
                                     m.created_at desc) as rk
  from mine m
  where m.embedding is not null
  order by rk limit {MEANING_LIMIT}
)
select v.id, 'meaning' as src, v.rk, m.created_at, m.category, m.entity_names
from vec v join mine m using (id)
"""


def _filters(parsed: ParsedQuery, category: str | None) -> str:
    out: dict[str, Any] = {}
    if category:
        out["category"] = category
    if parsed.saved_after:
        out["saved_after"] = parsed.saved_after.isoformat()
    if parsed.saved_before:
        out["saved_before"] = parsed.saved_before.isoformat()
    return json.dumps(out)


def _rows(records: Iterable[asyncpg.Record]) -> list[LegRow]:
    return [LegRow(r["id"], r["src"], int(r["rk"]), r["created_at"], r["category"],
                   tuple(r["entity_names"] or ())) for r in records]


async def lexical_rows(db: asyncpg.Pool, user_id: UUID, parsed: ParsedQuery, *,
                       category: str | None = None,
                       legs: frozenset[str] = ALL_LEGS) -> list[LegRow]:
    kw, fz = "keyword" in legs, "fuzzy" in legs
    if not parsed.text or not (kw or fz):
        return []
    return _rows(await db.fetch(LEXICAL_SQL, user_id, _filters(parsed, category),
                                parsed.text, kw, fz))


async def meaning_rows(db: asyncpg.Pool, user_id: UUID, parsed: ParsedQuery,
                       query_vec: Sequence[float] | None, *,
                       category: str | None = None,
                       legs: frozenset[str] = ALL_LEGS) -> list[LegRow]:
    if not parsed.text or query_vec is None or "meaning" not in legs:
        return []
    return _rows(await db.fetch(MEANING_SQL, user_id, _filters(parsed, category),
                                to_pgvector(list(query_vec))))


def fuse(rows: Iterable[LegRow], parsed: ParsedQuery, limit: int = FUSED_CAP) -> list[Hit]:
    """RRF (k=60, keyword 1.0 · meaning 1.0 · fuzzy 0.7) plus +0.008 per hint
    (place ∈ entity_names, category = hint). Ties go to the newer save."""
    score: dict[UUID, float] = {}
    legs: dict[UUID, set[str]] = {}
    meta: dict[UUID, LegRow] = {}
    for row in rows:
        score[row.reel_id] = score.get(row.reel_id, 0.0) + WEIGHTS[row.leg] / (RRF_K + row.rank)
        legs.setdefault(row.reel_id, set()).add(row.leg)
        meta.setdefault(row.reel_id, row)
    for rid, row in meta.items():
        if parsed.place_hint and parsed.place_hint in row.entity_names:
            score[rid] += HINT_BOOST
        if parsed.category_hint and row.category == parsed.category_hint:
            score[rid] += HINT_BOOST
    order = sorted(meta, key=lambda rid: (-score[rid], -meta[rid].created_at.timestamp(),
                                          str(rid)))
    return [Hit(rid, score[rid], tuple(leg for leg in LEG_ORDER if leg in legs[rid]),
                meta[rid].entity_names)
            for rid in order[:min(limit, FUSED_CAP)]]


async def search(db: asyncpg.Pool, user_id: UUID, parsed: ParsedQuery,
                 query_vec: list[float] | None, *, category: str | None = None,
                 legs: frozenset[str] = ALL_LEGS, limit: int = FUSED_CAP) -> list[Hit]:
    """All legs for a query whose vector is already known (tests, eval).
    The API uses `run_search`, which overlaps the embedding call with SQL."""
    if not parsed.text:
        return []
    lex, mean = await asyncio.gather(
        lexical_rows(db, user_id, parsed, category=category, legs=legs),
        meaning_rows(db, user_id, parsed, query_vec, category=category, legs=legs))
    return fuse([*lex, *mean], parsed, limit)
