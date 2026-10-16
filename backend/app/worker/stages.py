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
from ..enrich.device import DeviceHintProvider
from ..enrich.fetch import FetchProvider, FetchResult, run_chain
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
from ..services.saves_view import SAVE_COLUMNS, SAVE_FROM, to_save_detail
from ..services.text import clean, clean_text
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


class Reschedule(Exception):
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


# Is shared content `rc` trusted for save `r`? Server-fetched (or nothing fetched)
# → yes; device-sourced → only for the user whose hint produced it.
_TRUSTED_FOR_SAVE = ("(rc.fetch_source is distinct from 'device' "
                     "or rc.device_user_id = r.auth_user_id)")


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
    # Trust rule (PIPELINE.md §8): a card built from a device hint is reused only
    # for saves of the user whose device supplied it; anyone else runs FETCH.
    hit = await db.fetchval(
        f"""select rc.media_status = 'ready' and {_TRUSTED_FOR_SAVE}
            from public.reel_content rc join public.reels r on r.id = $2
            where rc.shortcode = $1""",
        shortcode, reel_id,
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

# Device-sourced data never replaces server-fetched data (the WHERE skips the
# update); `device_user_id` follows `fetch_source` (kept when nothing was fetched).
_UPSERT_FETCH = """
insert into public.reel_content
  (shortcode, source_url, caption, creator_handle, thumbnail_path, fetch_source, duration_s,
   fetch_meta, device_user_id, fetched_at)
values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now())
on conflict (shortcode) do update set
  caption        = coalesce(excluded.caption, public.reel_content.caption),
  creator_handle = coalesce(excluded.creator_handle, public.reel_content.creator_handle),
  thumbnail_path = coalesce(excluded.thumbnail_path, public.reel_content.thumbnail_path),
  fetch_source   = coalesce(excluded.fetch_source, public.reel_content.fetch_source),
  device_user_id = case when excluded.fetch_source is null
                        then public.reel_content.device_user_id
                        else excluded.device_user_id end,
  duration_s     = coalesce(excluded.duration_s, public.reel_content.duration_s),
  fetch_meta     = excluded.fetch_meta,
  fetched_at     = now()
where excluded.fetch_source is distinct from 'device'
   or public.reel_content.fetch_source is null
   or public.reel_content.fetch_source = 'device'
"""

SERVER_SOURCES = ("embed_page", "ytdlp", "scraper")


async def _run_chain(db: asyncpg.Pool, rt: Runtime, sc: str,
                     providers: list[FetchProvider] | None = None) -> FetchResult:
    try:
        return await run_chain(rt.fetchers if providers is None else providers, sc,
                               reel_url(sc), take=_taker(db))
    except BudgetExhausted as exc:
        raise Reschedule(exc.retry_after_s, str(exc)) from exc


async def _device_hint(db: asyncpg.Pool, job: dict[str, Any], sc: str
                       ) -> tuple[dict[str, Any] | None, Any]:
    """This save's device hint (if it may be used) and the saving user's id.

    Records the hint's `at` in the payload as `hint_seen`, so FINALIZE can tell a
    hint that arrived after FETCH. A hint is not used when the shared row
    already holds server-fetched data (PIPELINE.md §8: prefer server data)."""
    row = await db.fetchrow(
        """select r.device_hint, r.auth_user_id, rc.fetch_source
           from public.reels r
           left join public.reel_content rc on rc.shortcode = $2
           where r.id = $1::uuid""", str(job["payload"]["reel_id"]), sc)
    if row is None or not row["device_hint"]:
        return None, row["auth_user_id"] if row else None
    raw = row["device_hint"]
    hint = json.loads(raw) if isinstance(raw, str) else dict(raw)
    job["payload"]["hint_seen"] = float(hint.get("at") or 0)
    if row["fetch_source"] in SERVER_SOURCES:
        return None, row["auth_user_id"]
    return hint, row["auth_user_id"]


@stage("fetch")
async def fetch(db: asyncpg.Pool, job: dict[str, Any]) -> str:
    """Provider chain → reel_content caption/handle/thumbnail; partial if all fail.

    Provider 0 is this save's own device hint (app/enrich/device.py), then the
    server chain. Device data is marked `fetch_source = 'device'` with the
    supplying user, and its thumbnail is only kept if the server can download a
    real image from the CDN URL itself."""
    started = time.monotonic()
    rt = runtime()
    sc = await _shortcode(db, job)
    hint, user_id = await _device_hint(db, job, sc)
    providers = ([DeviceHintProvider(hint)] if hint else []) + list(rt.fetchers)
    try:
        result = await _run_chain(db, rt, sc, providers)
    except Reschedule:
        await _metric(db, "worker", "fetch", started, "rescheduled")
        raise
    device = result.source == "device"
    if device:
        thumb = await rt.thumbnails.store_verified(sc, result.thumbnail_url)
        if thumb is None:
            result.thumbnail_url = None
    else:
        thumb = await rt.thumbnails.store(sc, result.thumbnail_url)
    # A device hint's signed media URLs are as old as the hint, not this fetch.
    at = min(time.time(), float(hint.get("at") or time.time())) if device and hint else time.time()
    meta = clean({**result.to_meta(), "at": at})
    status = await db.execute(_UPSERT_FETCH, sc, reel_url(sc), clean(result.caption),
                              clean(result.creator_handle), thumb, result.source, result.duration_s,
                              json.dumps(meta), user_id if device else None)
    if device and status.endswith(" 0"):
        # Server data landed meanwhile; the hint was not written, so don't claim it.
        meta = {**FetchResult(source=None).to_meta(), "at": time.time()}
        result = FetchResult(source=None)
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
           where shortcode = $1""", sc, clean_text(t.text), t.duration_s)
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
                         image_url=await rt.image_data_url(row.get("thumbnail_path"), db)
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
    card = clean(dict(card))
    creator_handle = clean(creator_handle)
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
        rows = await db.fetch(_MARK_SAVES + "r.shortcode_key = $1 returning r.id", sc)
    else:
        # Cache hit (RESOLVE found a ready card): only this save needs finishing.
        current = await db.fetchval(
            "select media_status from public.reel_content where shortcode = $1", sc)
        await db.execute("select public.refresh_search_columns($1)", sc)
        rows = await db.fetch(_MARK_SAVES + "r.id = $2::uuid returning r.id",
                              sc, str(payload["reel_id"]))
    await enqueue_embed_jobs(db, [r["id"] for r in rows])
    await _metric(db, "worker", "finalize", started, "ok",
                  {"media_status": current, "saves": len(rows), "cache_hit": card is None})
    await _total_metric(db, payload["reel_id"], current or "partial")
    await _requeue_for_late_hint(db, payload, sc)


# Every save gets `enriched` only when the shared card is ready AND trusted for
# that save's user (a device-sourced card is trusted only for its supplier);
# otherwise `partial`, which the user can retry (PIPELINE.md §8).
_MARK_SAVES = f"""
update public.reels r
set status = coalesce(
  (select case when rc.media_status = 'ready' and {_TRUSTED_FOR_SAVE}
               then 'enriched' else 'partial' end
   from public.reel_content rc where rc.shortcode = $1),
  'partial')
where """


async def _requeue_for_late_hint(db: asyncpg.Pool, payload: Mapping[str, Any], sc: str) -> None:
    """A device hint that landed after this job's FETCH (newer than `hint_seen`)
    and a save that ended `partial`: run it again from FETCH so the hint is used."""
    row = await db.fetchrow(
        "select status, auth_user_id, device_hint->>'at' as at from public.reels "
        "where id = $1::uuid", str(payload["reel_id"]))
    if row is None or row["status"] != "partial" or row["at"] is None:
        return
    if float(row["at"]) <= float(payload.get("hint_seen") or 0):
        return
    async with db.acquire() as con, con.transaction():
        queued = await con.fetchval(
            "select exists (select 1 from public.jobs where kind = 'enrich' "
            "and payload->>'reel_id' = $1 and locked_at is null)", str(payload["reel_id"]))
        if queued:
            return
        await con.execute(
            """insert into public.jobs (kind, payload, stage)
               values ('enrich', jsonb_build_object('reel_id', $1::uuid, 'user_id', $2::uuid,
                                                    'shortcode', $3::text), 'fetch')""",
            str(payload["reel_id"]), row["auth_user_id"], sc)
        await con.execute("update public.reels set status = 'pending' where id = $1::uuid",
                          str(payload["reel_id"]))


async def _total_metric(db: asyncpg.Pool, reel_id: Any, outcome: str) -> None:
    """Share → card time for this save (GET /admin/health `enrich_p95_ms`). Never raises."""
    try:
        await db.execute(
            """insert into public.metrics (door, stage, duration_ms, outcome)
               select 'worker', 'enrich',
                      greatest(0, (extract(epoch from now() - r.created_at) * 1000)::int), $2
               from public.reels r where r.id = $1::uuid""",
            str(reel_id), outcome)
    except Exception:
        log.exception("total metric write failed")


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
        return
    if rt.embedder is None:
        await _metric(db, "worker", "embed", started, "skipped", {"reason": "no_embedder"})
        return
    text = card_embedding_text(dict(row), row["note"])
    if not text.strip():
        await _metric(db, "worker", "embed", started, "skipped", {"reason": "empty"})
        return
    if wait := await take_token(db, "embeddings"):
        raise Reschedule(wait, f"budget exhausted for embeddings; retry in {wait}s")
    (vec,) = await rt.embedder.embed([text], "document")
    await db.execute("update public.reels set embedding = $2::vector where id = $1::uuid",
                     str(reel_id), to_pgvector(vec))
    await _metric(db, "worker", "embed", started, "ok", {"chars": len(text)})
    return


# ----------------------------------------------------------------- export --

_EXPORT_SAVES = f"""
select {SAVE_COLUMNS}, rc.likely_queries, rc.transcript
{SAVE_FROM}
where r.auth_user_id = $1::uuid
order by r.created_at desc
"""


@stage("export")
async def export(db: asyncpg.Pool, job: dict[str, Any]) -> None:
    """Everything the user owns as one JSON document (POST /me/export →
    GET /me/export). Keeps only the newest export per user."""
    started = time.monotonic()
    user_id = str(job["payload"]["user_id"])
    account = await db.fetchrow(
        """select p.id, p.email, p.full_name, p.handle, p.plan, p.created_at
           from public.profiles p where p.id = $1::uuid""", user_id)
    if account is None:
        await _metric(db, "worker", "export", started, "skipped", {"reason": "user_gone"})
        return
    saves = []
    for row in await db.fetch(_EXPORT_SAVES, user_id):
        detail = to_save_detail(row).model_dump(mode="json")
        detail["likely_queries"] = list(row["likely_queries"] or [])
        detail["transcript"] = row["transcript"]
        saves.append(detail)
    stacks = [
        {"id": str(r["id"]), "name": r["name"], "created_at": r["created_at"].isoformat(),
         "save_ids": [str(x) for x in (r["save_ids"] or [])]}
        for r in await db.fetch(
            """select s.id, s.name, s.created_at,
                      array_remove(array_agg(ss.reel_id order by ss.added_at), null) as save_ids
               from public.stacks s
               left join public.stack_saves ss on ss.stack_id = s.id
               where s.auth_user_id = $1::uuid
               group by s.id order by s.created_at""", user_id)
    ]
    prefs = await db.fetchrow("select * from public.preferences where auth_user_id = $1::uuid", user_id)
    data = {
        "format": "lately-export/1",
        "account": {"id": str(account["id"]), "email": account["email"],
                    "name": account["full_name"], "handle": account["handle"],
                    "plan": account["plan"], "created_at": account["created_at"].isoformat()},
        "preferences": {k: v for k, v in dict(prefs).items() if k not in ("auth_user_id", "updated_at")} if prefs else None,
        "saves": saves,
        "stacks": stacks,
    }
    async with db.acquire() as con, con.transaction():
        await con.execute("delete from public.exports where user_id = $1::uuid", user_id)
        await con.execute("insert into public.exports (user_id, data) values ($1::uuid, $2::jsonb)",
                          user_id, json.dumps(data, default=str))
    await _metric(db, "worker", "export", started, "ok", {"saves": len(saves)})
