"""Golden-set eval (SEARCH.md §11): recall@1, recall@5, MRR and p95 latency.

Seeds the given cards for a dedicated eval user, runs every golden query
through the same path the API uses (`run_search`, embedding overlapped with
SQL) and times each one end to end, after one untimed warm-up query.
"""

from __future__ import annotations

import csv
import math
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

import asyncpg

from ..urls import parse_shortcode
from .embed import Embedder
from .retrieve import ALL_LEGS
from .run import run_search
from .seed import seed_card

EVAL_USER = UUID("00000000-0000-0000-0000-00000000e7a1")
EVAL_EMAIL = "search-eval@lately.test"


def recall_at_k(ranked: Sequence[Sequence[str]], expected: Sequence[str], k: int) -> float:
    if not expected:
        return 0.0
    return sum(e in got[:k] for got, e in zip(ranked, expected, strict=True)) / len(expected)


def mrr(ranked: Sequence[Sequence[str]], expected: Sequence[str]) -> float:
    if not expected:
        return 0.0
    total = 0.0
    for got, e in zip(ranked, expected, strict=True):
        if e in got:
            total += 1.0 / (list(got).index(e) + 1)
    return total / len(expected)


def p95(values: Sequence[float]) -> float:
    """Nearest-rank 95th percentile; 0.0 for no values."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.95 * len(ordered)) - 1)]


@dataclass
class EvalReport:
    recall1: float
    recall5: float
    mrr: float
    p95_ms: float
    misses: list[tuple[str, str, list[str]]] = field(default_factory=list)


def load_golden(path: Path) -> list[tuple[str, str]]:
    """(what_i_remembered_it_as, shortcode) per row; blank rows are skipped."""
    out: list[tuple[str, str]] = []
    with path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            query = (row.get("what_i_remembered_it_as") or "").strip()
            code = parse_shortcode((row.get("reel_url") or "").strip())
            if query and code:
                out.append((query, code))
    return out


async def _reset_eval_user(db: asyncpg.Pool) -> None:
    await db.execute(
        "insert into auth.users (id, email, aud, role) "
        "values ($1, $2, 'authenticated', 'authenticated') on conflict (id) do nothing",
        EVAL_USER, EVAL_EMAIL)
    await db.execute("delete from public.reels where auth_user_id = $1", EVAL_USER)


async def run_eval(db: asyncpg.Pool, golden: list[tuple[str, str]],
                   cards: list[Mapping[str, Any]], embedder: Embedder | None,
                   legs: frozenset[str] = ALL_LEGS) -> EvalReport:
    await _reset_eval_user(db)
    code_of: dict[UUID, str] = {}
    for card in cards:
        code_of[await seed_card(db, EVAL_USER, card, embedder)] = card["shortcode"]

    if golden:  # untimed warm-up: open the pool's connections like a running API has
        await run_search(db, EVAL_USER, golden[0][0], embedder, legs=legs)

    ranked: list[list[str]] = []
    timings: list[float] = []
    for query, _ in golden:
        started = time.perf_counter()
        run = await run_search(db, EVAL_USER, query, embedder, legs=legs)
        timings.append((time.perf_counter() - started) * 1000)
        ranked.append([code_of.get(h.reel_id, "?") for h in run.hits])

    expected = [code for _, code in golden]
    misses = [(q, e, got[:5]) for (q, e), got in zip(golden, ranked, strict=True)
              if e not in got[:5]]
    return EvalReport(recall_at_k(ranked, expected, 1), recall_at_k(ranked, expected, 5),
                      mrr(ranked, expected), p95(timings), misses)
