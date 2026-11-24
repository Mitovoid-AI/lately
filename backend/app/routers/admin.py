"""Admin router — GET /admin/health: queue and pipeline counters for the operator;
GET /admin/jobs/dead and POST /admin/jobs/dead/{id}/redrive: the dead-letter queue
(PIPELINE.md §7 "admin re-drive").

Guarded by the `X-Admin-Key` header, compared in constant time with
settings().admin_key. An empty admin_key disables the endpoints (404), so a
deploy that never set one exposes nothing. User JWTs grant nothing here.

Metrics conventions read here (PIPELINE.md §8, metrics table):
- `stage_p95_ms`: p95 duration per stage over the last 24 h.
- `enrich_p95_ms`: p95 of rows with stage = 'enrich' (one row per finished
  enrichment job, total duration) over the last 24 h; null until the worker
  writes them.
- `llm_calls_today`: rows with stage = 'structure' since 00:00 UTC.
"""

from __future__ import annotations

import contextlib
import hmac
import json
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel

from ..config import settings
from ..deps import pool
from ..models import api_error

router = APIRouter(prefix="/admin", tags=["ops"])

_HEALTH_SQL = """
select
  (select count(*) from public.jobs where locked_at is null) as jobs_pending,
  (select count(*) from public.jobs where locked_at is not null) as jobs_running,
  (select count(*) from public.jobs_dead) as jobs_dead,
  (select round(count(*) filter (where status = 'partial')::numeric
                / nullif(count(*) filter (where status in ('partial', 'enriched')), 0), 4)
     from public.reels where created_at >= now() - interval '24 hours') as partial_rate_24h,
  (select coalesce(jsonb_object_agg(stage, p95), '{}'::jsonb) from (
     select stage, percentile_disc(0.95) within group (order by duration_ms) as p95
     from public.metrics
     where at >= now() - interval '24 hours' and stage is not null and duration_ms is not null
     group by stage) s) as stage_p95_ms,
  (select count(*) from public.metrics
     where stage = 'structure' and at >= date_trunc('day', now() at time zone 'utc')
                                          at time zone 'utc') as llm_calls_today
"""


class HealthOut(BaseModel):
    jobs_pending: int
    jobs_running: int
    jobs_dead: int
    partial_rate_24h: float | None
    enrich_p95_ms: int | None
    stage_p95_ms: dict[str, int]
    llm_calls_today: int


def _require_admin(x_admin_key: str | None) -> None:
    expected = settings().admin_key
    if not expected:
        raise api_error(404, "NOT_FOUND", "Not found.")
    if not x_admin_key or not hmac.compare_digest(x_admin_key.encode(), expected.encode()):
        raise api_error(401, "UNAUTHORIZED", "Admin key required.")


@router.get("/health", response_model=HealthOut)
async def health(x_admin_key: str | None = Header(default=None)) -> HealthOut:
    _require_admin(x_admin_key)
    row = await pool().fetchrow(_HEALTH_SQL)
    assert row is not None
    stages = row["stage_p95_ms"]
    stages = json.loads(stages) if isinstance(stages, str) else dict(stages)
    rate = row["partial_rate_24h"]
    return HealthOut(
        jobs_pending=row["jobs_pending"], jobs_running=row["jobs_running"],
        jobs_dead=row["jobs_dead"],
        partial_rate_24h=float(rate) if rate is not None else None,
        enrich_p95_ms=stages.get("enrich"), stage_p95_ms=stages,
        llm_calls_today=row["llm_calls_today"])


class DeadJobOut(BaseModel):
    id: UUID
    kind: str | None
    stage: str | None
    last_error: str | None
    failed_at: datetime
    reel_id: str | None  # payload reel_id (enrich / embed jobs)


@router.get("/jobs/dead", response_model=list[DeadJobOut])
async def dead_jobs(x_admin_key: str | None = Header(default=None),
                    limit: Annotated[int, Query(ge=1, le=500)] = 50) -> list[DeadJobOut]:
    """Dead-lettered jobs, the most recently failed first."""
    _require_admin(x_admin_key)
    rows = await pool().fetch(
        "select id, kind, stage, last_error, failed_at, payload->>'reel_id' as reel_id "
        "from public.jobs_dead order by failed_at desc, id limit $1", limit)
    return [DeadJobOut(**dict(r)) for r in rows]


@router.post("/jobs/dead/{job_id}/redrive", status_code=202)
async def redrive_dead_job(job_id: UUID,
                           x_admin_key: str | None = Header(default=None)) -> dict[str, str]:
    """Move a dead job back into the queue to run now with its attempts reset
    (it resumes from the stage it died at). An enrich job's save goes back to
    pending, as on a retry. 404 when there is no such dead job."""
    _require_admin(x_admin_key)
    async with pool().acquire() as con, con.transaction():
        job = await con.fetchrow(
            """
            with dead as (delete from public.jobs_dead where id = $1 returning *)
            insert into public.jobs (id, kind, payload, stage, attempts, run_at)
            select id, coalesce(kind, 'enrich'), coalesce(payload, '{}'::jsonb),
                   coalesce(stage, 'resolve'), 0, now()
            from dead
            returning kind, payload->>'reel_id' as reel_id
            """, job_id)
        if job is None:
            raise api_error(404, "NOT_FOUND", "Dead job not found.")
        if job["kind"] == "enrich" and job["reel_id"]:
            with contextlib.suppress(ValueError):
                await con.execute(
                    "update public.reels set status = 'pending', fail_reason = null "
                    "where id = $1 and status = 'partial'", UUID(job["reel_id"]))
    return {"status": "queued"}
