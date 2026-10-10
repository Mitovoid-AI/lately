"""Re-embed backfill (scripts/reembed.py): enqueue `embed` jobs for finished saves.

Default: enriched/partial saves with no embedding yet. `all_reels=True`: every
finished save (after an embedding model change). Saves that already have an
embed job waiting are skipped, so re-running is safe.
"""

from __future__ import annotations

import asyncpg

_ENQUEUE = """
with picked as (
  select r.id from public.reels r
  where r.status in ('enriched', 'partial') and ($1 or r.embedding is null)
    and not exists (
      select 1 from public.jobs j
      where j.kind = 'embed' and j.payload->>'reel_id' = r.id::text and j.locked_at is null)
), ins as (
  insert into public.jobs (kind, payload, stage)
  select 'embed', jsonb_build_object('reel_id', id::text), 'embed' from picked
  returning 1
)
select count(*) from ins
"""


async def enqueue_reembed(db: asyncpg.Pool | asyncpg.Connection, *, all_reels: bool) -> int:
    return int(await db.fetchval(_ENQUEUE, all_reels))
