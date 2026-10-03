"""Jobs service — enqueue helpers shared by the API and the worker (Part 1).

The queue is the Postgres `jobs` table (PIPELINE.md §4); atomic claims happen
in the `claim_job()` RPC (migration 0003), not here.
"""

from __future__ import annotations

import asyncpg


async def enqueue_enrich(
    conn: asyncpg.Connection, reel_id: str, user_id: str, stage: str = "resolve"
) -> None:
    await conn.execute(
        """
        insert into public.jobs (kind, payload, stage)
        values ('enrich',
                jsonb_build_object('reel_id', $1::uuid, 'user_id', $2::uuid),
                $3)
        """,
        reel_id,
        user_id,
        stage,
    )


# SQLSTATEs / messages raised by the save_reel() RPC (migration 0003 §7).
class QuotaExceeded(Exception):
    pass


class RateLimited(Exception):
    pass


class BadUrl(Exception):
    pass


def map_rpc_error(exc: asyncpg.PostgresError) -> Exception | None:
    """Translate save_reel()'s raised exceptions into typed errors."""
    text = str(getattr(exc, "message", exc))
    if "QUOTA_EXCEEDED" in text:
        return QuotaExceeded(text)
    if "RATE_LIMITED" in text:
        return RateLimited(text)
    if "BAD_URL" in text:
        return BadUrl(text)
    return None
