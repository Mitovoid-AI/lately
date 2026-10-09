"""Worker stages (PIPELINE.md §5) plus the `embed` job (SEARCH.md §3).

Each stage is `async def(db: asyncpg.Pool, job) -> next_stage | None`:
- return the next stage name to advance to, or
- raise to trigger retry/backoff (handled by the loop), or
- raise `Reschedule` to wait for a provider budget without burning an attempt, or
- return None when the job is complete.
Stages query through the pool (one connection per query, never held across an
external call) and may update `job["payload"]`; the loop persists it.

Enrich jobs: resolve → fetch → transcribe → vision → structure → finalize.
Embed jobs (kind 'embed', payload {"reel_id"}): a single `embed` stage.

Payload keys written along the way: `shortcode` (RESOLVE), `fetch` (FETCH:
provider result incl. transient media URLs + `at` epoch), `card` and
`structure_outcome` (STRUCTURE). External clients come from
`app.enrich.runtime.runtime()`.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Mapping
from typing import Any

import asyncpg
import httpx

from ..enrich.budget import BudgetExhausted, take_token
from ..enrich.fetch import FetchResult, run_chain
from ..enrich.runtime import Runtime, runtime
from ..enrich.structure import (
    LLMUnavailable,
    StructureInput,
    StructureResult,
    fallback_card,
    structure_reel,
)
from ..enrich.transcribe import TranscribeError, should_transcribe
from ..search.embed import card_embedding_text, to_pgvector
from ..search.seed import reel_url
from ..urls import is_share_link, parse_shortcode

log = logging.getLogger("lately.worker")

# Ordered registry; the loop advances jobs through these names.
STAGES: dict[str, Any] = {}
NEXT: dict[str, str | None] = {
    "resolve": "fetch",
    "fetch": "transcribe",
    "transcribe": "vision",
    "vision": "structure",
    "structure": "finalize",
    "finalize": None,
    "embed": None,
}


class Reschedule(Exception):  # noqa: N818 — a control-flow signal, not an error
    """Put the job back to run in `delay_s` seconds without consuming an attempt."""

    def __init__(self, delay_s: int, reason: str) -> None:
        super().__init__(reason)
        self.delay_s = max(1, int(delay_s))
        self.reason = reason


def stage(name: str):
    def register(fn):
        STAGES[name] = fn
        return fn

    return register


async def _metric(db: asyncpg.Pool, door: str, stage_name: str, started: float, outcome: str,
                  detail: Mapping[str, Any] | None = None, cost: float | None = None) -> None:
    """Metrics row (PIPELINE.md §8). Never raises."""
    try:
        await db.execute(
            """insert into public.metrics (door, stage, duration_ms, outcome, cost_usd, detail)
               values ($1, $2, $3, $4, $5, $6::jsonb)""",
            door, stage_name, int((time.monotonic() - started) * 1000), outcome, cost,
            json.dumps(dict(detail), default=str) if detail else None,
        )
    except Exception:  # metrics must never break the pipeline
        log.exception("metric write failed")


def _taker(db: asyncpg.Pool):
    async def take(provider: str) -> int:
        return await take_token(db, provider)
    return take


def _last_attempt(job: Mapping[str, Any]) -> bool:
    return int(job.get("attempts") or 0) >= int(job.get("max_attempts") or 3)


async def _shortcode(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    payload = job["payload"]
    if sc := payload.get("shortcode"):
        return str(sc)
    sc = await db.fetchval("select shortcode_key from public.reels where id = $1",
                           payload["reel_id"])
    if not sc:
        raise RuntimeError("no shortcode in payload or reel")
    payload["shortcode"] = sc
    return str(sc)


@stage("resolve")
async def resolve(db: asyncpg.Pool, job: dict[str, Any]) -> str | None:
    """URL → shortcode. Follows /share/ redirects; cache-hit jumps to finalize."""
    payload = job["payload"]
    reel_id = payload["reel_id"]
    started = time.monotonic()

    reel = await db.fetchrow(
        "select source_url, shortcode_key from public.reels where id = $1", reel_id
    )
    if reel is None:
        raise RuntimeError(f"reel {reel_id} vanished")

    shortcode = reel["shortcode_key"]

    # /share/XXXX shortlinks carry no shortcode — resolve via redirect.
    if shortcode is None and is_share_link(reel["source_url"]):
        async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
            resp = await client.get(reel["source_url"])
        loc = resp.headers.get("location", "")
        shortcode = parse_shortcode(loc) or None

    if shortcode is None:
        # Can't identify the reel yet. Stay resolvable later: retry with backoff
        # rather than dead-lettering — Instagram links may resolve on retry.
        raise RuntimeError("no shortcode after resolve")

    # A /share/ link can turn out to be a reel this user already saved: the
    # second save is a no-op (PIPELINE.md §3 step 4), so drop it and finish.
    if reel["shortcode_key"] is None and await db.fetchval(
        """select exists (
             select 1 from public.reels r
             join public.reels me on me.id = $1
             where r.auth_user_id = me.auth_user_id and r.shortcode_key = $2
               and r.id <> me.id)""",
        reel_id, shortcode,
    ):
        await db.execute("delete from public.reels where id = $1", reel_id)
        await _metric(db, "worker", "resolve", started, "duplicate")
        return None

    # Cache hit: shared content already structured → jump straight to finalize.
    hit = await db.fetchval(
        "select media_status = 'ready' from public.reel_content where shortcode = $1",
        shortcode,
    )

    await db.execute(
        "update public.reels set shortcode_key = $2 where id = $1", reel_id, shortcode
    )
    job["payload"]["shortcode"] = shortcode  # persisted by the loop's advance_job

    if hit:
        await _metric(db, "worker", "resolve", started, "cache_hit")
        return "finalize"

    await _metric(db, "worker", "resolve", started, "ok")
    return NEXT["resolve"]


# ------------------------------------------------------------------ fetch --

_UPSERT_FETCH = """
insert into public.reel_content
  (shortcode, source_url, caption, creator_handle, thumbnail_path, fetch_source, duration_s,
   fetch_meta, fetched_at)
values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
on conflict (shortcode) do update set
  caption        = coalesce(excluded.caption, public.reel_content.caption),
  creator_handle = coalesce(excluded.creator_handle, public.reel_content.creator_handle),
  thumbnail_path = coalesce(excluded.thumbnail_path, public.reel_content.thumbnail_path),
  fetch_source   = coalesce(excluded.fetch_source, public.reel_content.fetch_source),
  duration_s     = coalesce(excluded.duration_s, public.reel_content.duration_s),
  fetch_meta     = excluded.fetch_meta,
  fetched_at     = now()
"""


async def _run_chain(db: asyncpg.Pool, rt: Runtime, sc: str) -> FetchResult:
    try:
        return await run_chain(rt.fetchers, sc, reel_url(sc), take=_taker(db))
    except BudgetExhausted as exc:
        raise Reschedule(exc.retry_after_s, str(exc)) from exc


@stage("fetch")
async def fetch(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """Provider chain → reel_content caption/handle/thumbnail; partial if all fail."""
    started = time.monotonic()
    rt = runtime()
    sc = await _shortcode(db, job)
    try:
        result = await _run_chain(db, rt, sc)
    except Reschedule:
        await _metric(db, "worker", "fetch", started, "rescheduled")
        raise
    thumb = await rt.thumbnails.store(sc, result.thumbnail_url)
    meta = {**result.to_meta(), "at": time.time()}
    await db.execute(_UPSERT_FETCH, sc, reel_url(sc), result.caption, result.creator_handle,
                     thumb, result.source, result.duration_s, json.dumps(meta))
    job["payload"]["fetch"] = meta
    await _metric(db, "worker", "fetch", started, "ok" if result.source else "partial",
                  {"source": result.source, "thumbnail": bool(thumb)})
    return "transcribe"


async def _fresh_fetch(db: asyncpg.Pool, rt: Runtime, job: dict[str, Any], sc: str) -> FetchResult:
    """The fetch result, re-fetched if its signed media URLs are probably expired."""
    meta = job["payload"].get("fetch") or {}
    result = FetchResult.from_meta(meta)
    age = time.time() - float(meta.get("at") or 0)
    if result.source and result.media_url and age > rt.media_url_max_age_s:
        fresh = await _run_chain(db, rt, sc)
        if fresh.useful:
            result = fresh
            job["payload"]["fetch"] = {**fresh.to_meta(), "at": time.time()}
    return result


# ------------------------------------------------------------- transcribe --

@stage("transcribe")
async def transcribe(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """Groq Whisper, only when the caption is weak and the audio is short."""
    started = time.monotonic()
    rt = runtime()
    sc = await _shortcode(db, job)
    caption = await db.fetchval("select caption from public.reel_content where shortcode = $1",
                                sc)
    result = FetchResult.from_meta(job["payload"].get("fetch"))
    ok, reason = should_transcribe(result, caption, has_key=rt.transcriber is not None,
                                   max_duration_s=rt.transcribe_max_duration_s,
                                   caption_max_words=rt.transcribe_caption_max_words)
    if not ok:
        await _metric(db, "worker", "transcribe", started, "skipped", {"reason": reason})
        return "vision"
    assert rt.transcriber is not None
    result = await _fresh_fetch(db, rt, job, sc)
    if not result.media_url:
        await _metric(db, "worker", "transcribe", started, "skipped", {"reason": "no_audio"})
        return "vision"
    if wait := await take_token(db, "groq"):
        await _metric(db, "worker", "transcribe", started, "rescheduled")
        raise Reschedule(wait, f"budget exhausted for groq; retry in {wait}s")
    try:
        t = await rt.transcriber.transcribe(result.media_url)
    except TranscribeError as exc:  # a transcript is a bonus; the card goes on without it
        await _metric(db, "worker", "transcribe", started, "error", {"error": str(exc)[:300]})
        return "vision"
    await db.execute(
        """update public.reel_content
           set transcript = nullif($2, ''), duration_s = coalesce(duration_s, $3)
           where shortcode = $1""", sc, t.text, t.duration_s)
    seconds = max(t.duration_s or result.duration_s or 0.0, 10.0)  # Groq bills ≥ 10 s
    await _metric(db, "worker", "transcribe", started, "ok", {"chars": len(t.text)},
                  cost=seconds / 3600 * rt.groq_cost_per_hour_usd)
    return "vision"


# ----------------------------------------------------------------- vision --

@stage("vision")
async def vision(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """Pass-through for now: the thumbnail goes into STRUCTURE as an image
    (SEARCH.md §9). Keyframe OCR lands later."""
    await _metric(db, "worker", "vision", time.monotonic(), "skipped",
                  {"reason": "thumbnail_in_structure"})
    return "structure"


# -------------------------------------------------------------- structure --

@stage("structure")
async def structure(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """ONE LLM call → validated card in the payload (FINALIZE writes it)."""
    started = time.monotonic()
    rt = runtime()
    sc = await _shortcode(db, job)
    row = await db.fetchrow(
        """select caption, transcript, creator_handle, thumbnail_path
           from public.reel_content where shortcode = $1""", sc)
    row = dict(row) if row else {}
    inp = StructureInput(caption=row.get("caption"), transcript=row.get("transcript"),
                         creator_handle=row.get("creator_handle"),
                         image_url=await rt.image_data_url(row.get("thumbnail_path"))
                         if rt.llm is not None else None)
    try:
        r = await structure_reel(rt.llm, inp, take=_taker(db))
    except BudgetExhausted as exc:
        await _metric(db, "worker", "structure", started, "rescheduled")
        raise Reschedule(exc.retry_after_s, str(exc)) from exc
    except LLMUnavailable as exc:
        if not _last_attempt(job):
            await _metric(db, "worker", "structure", started, "error", {"error": str(exc)[:300]})
            raise RuntimeError(f"llm unavailable: {exc}") from exc
        r = StructureResult(card=fallback_card(inp), outcome="fallback", error=str(exc))
    job["payload"]["card"] = r.card
    job["payload"]["structure_outcome"] = r.outcome
    await _metric(db, "worker", "structure", started, r.outcome,
                  {"model": r.model, "usage": r.usage, "error": (r.error or "")[:300] or None},
                  cost=r.cost_usd)
    return "finalize"


# --------------------------------------------------------------- finalize --

_WRITE_CARD = """
insert into public.reel_content
  (shortcode, source_url, creator_handle, title, summary, category, tags, steps, entities,
   entity_names, likely_queries, visual_description, ocr_text, search_text, parser_version,
   media_status, fetched_at)
values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16,
        now())
on conflict (shortcode) do update set
  creator_handle = coalesce(excluded.creator_handle, public.reel_content.creator_handle),
  title = excluded.title, summary = excluded.summary, category = excluded.category,
  tags = excluded.tags, steps = excluded.steps, entities = excluded.entities,
  entity_names = excluded.entity_names, likely_queries = excluded.likely_queries,
  visual_description = excluded.visual_description, ocr_text = excluded.ocr_text,
  search_text = excluded.search_text, parser_version = excluded.parser_version,
  media_status = excluded.media_status
where public.reel_content.media_status <> 'ready' or excluded.media_status = 'ready'
"""

_ENQUEUE_EMBED = """
insert into public.jobs (kind, payload, stage)
select 'embed', jsonb_build_object('reel_id', id::text), 'embed'
from unnest($1::uuid[]) as t(id)
where not exists (
  select 1 from public.jobs j
  where j.kind = 'embed' and j.payload->>'reel_id' = t.id::text and j.locked_at is null)
"""


async def write_card(db: asyncpg.Pool | asyncpg.Connection, sc: str, card: Mapping[str, Any],
                     creator_handle: str | None, media_status: str) -> None:
    """Upsert the structured card into shared reel_content and rebuild its search
    columns. A partial result never overwrites a ready card."""
    await db.execute(
        _WRITE_CARD, sc, reel_url(sc), creator_handle, card.get("title"), card.get("summary"),
        card.get("category"), card.get("tags") or [], json.dumps(card.get("steps") or []),
        json.dumps(card.get("entities") or []), card.get("entity_names") or [],
        card.get("likely_queries") or [], card.get("visual_description") or None,
        card.get("ocr_text") or None, card.get("search_text") or None,
        card.get("parser_version"), media_status)
    await db.execute("select public.refresh_search_columns($1)", sc)


async def enqueue_embed_jobs(db: asyncpg.Pool | asyncpg.Connection, reel_ids: list[Any]) -> None:
    """One `embed` job per reel, skipping reels that already have one waiting."""
    if reel_ids:
        await db.execute(_ENQUEUE_EMBED, [str(i) for i in reel_ids])


_STATUS = {"ready": "enriched"}


@stage("finalize")
async def finalize(db: asyncpg.Pool, job: dict[str, Any]) -> None:
    """Write the shared card, mark every save of this reel, enqueue embed jobs."""
    started = time.monotonic()
    payload = job["payload"]
    sc = await _shortcode(db, job)
    card = payload.get("card")
    if card is not None:
        fetched = (payload.get("fetch") or {}).get("source") is not None
        good = payload.get("structure_outcome") in ("ok", "repaired")
        media_status = "ready" if fetched and good else "partial"
        creator = (payload.get("fetch") or {}).get("creator_handle")
        await write_card(db, sc, card, creator, media_status)
        # Shared content changed: every save of this reel gets the card + a re-embed.
        current = await db.fetchval(
            "select media_status from public.reel_content where shortcode = $1", sc)
        rows = await db.fetch(
            "update public.reels set status = $2 where shortcode_key = $1 returning id",
            sc, _STATUS.get(current, "partial"))
    else:
        # Cache hit (RESOLVE found a ready card): only this save needs finishing.
        current = await db.fetchval(
            "select media_status from public.reel_content where shortcode = $1", sc)
        await db.execute("select public.refresh_search_columns($1)", sc)
        rows = await db.fetch(
            "update public.reels set status = $2 where id = $1 returning id",
            payload["reel_id"], _STATUS.get(current, "partial"))
    await enqueue_embed_jobs(db, [r["id"] for r in rows])
    await _metric(db, "worker", "finalize", started, "ok",
                  {"media_status": current, "saves": len(rows), "cache_hit": card is None})
    return None


# ------------------------------------------------------------------ embed --

@stage("embed")
async def embed(db: asyncpg.Pool, job: dict[str, Any]) -> None:
    """Per-user embedding = card + the user's note → reels.embedding."""
    started = time.monotonic()
    rt = runtime()
    reel_id = job["payload"]["reel_id"]
    row = await db.fetchrow(
        """select r.note, rc.title, rc.summary, rc.likely_queries, rc.tags, rc.entity_names,
                  rc.visual_description
           from public.reels r
           left join public.reel_content rc on rc.shortcode = r.shortcode_key
           where r.id = $1::uuid""", str(reel_id))
    if row is None:
        await _metric(db, "worker", "embed", started, "skipped", {"reason": "reel_gone"})
        return None
    if rt.embedder is None:
        await _metric(db, "worker", "embed", started, "skipped", {"reason": "no_embedder"})
        return None
    text = card_embedding_text(dict(row), row["note"])
    if not text.strip():
        await _metric(db, "worker", "embed", started, "skipped", {"reason": "empty"})
        return None
    if wait := await take_token(db, "embeddings"):
        raise Reschedule(wait, f"budget exhausted for embeddings; retry in {wait}s")
    (vec,) = await rt.embedder.embed([text], "document")
    await db.execute("update public.reels set embedding = $2::vector where id = $1::uuid",
                     str(reel_id), to_pgvector(vec))
    await _metric(db, "worker", "embed", started, "ok", {"chars": len(text)})
    return None
