"""Provider budget (migration 0007): one Postgres token bucket per provider,
shared by every worker. `take_token` returns 0 when a token was granted, else
the seconds to wait; stages turn a wait into `Reschedule` (no attempt burned).
"""

from __future__ import annotations

import asyncpg


class BudgetExhausted(Exception):
    """A provider has no token right now; carries the wait in seconds."""

    def __init__(self, provider: str, retry_after_s: int) -> None:
        super().__init__(f"budget exhausted for {provider}; retry in {retry_after_s}s")
        self.provider = provider
        self.retry_after_s = retry_after_s


async def take_token(db: asyncpg.Pool | asyncpg.Connection, provider: str) -> int:
    return int(await db.fetchval("select public.take_provider_token($1)", provider))
