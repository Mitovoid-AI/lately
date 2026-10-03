"""Lately backend config (Part 1).

Server-side only. Mirrors website/src/lib/config.ts: fail fast at boot on
missing required keys. SUPABASE_SERVICE_ROLE_KEY bypasses RLS — worker and API
server only, never a client bundle.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database: Postgres URI. Cloud = Supabase transaction pooler (port 6543).
    database_url: str
    db_pool_max_size: int = 10

    # Supabase
    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_audience: str = ""

    # Catch-path limits (PIPELINE.md §3 step 3: Postgres count, no Redis at v1)
    rate_limit_per_hour: int = 30

    # Worker
    worker_poll_interval_seconds: float = 0.5
    worker_stuck_after_minutes: int = 10

    # Optional AI keys — saves work without them; cards stay partial (Part 2)
    groq_api_key: str = ""
    gemini_api_key: str = ""


@lru_cache
def settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # pydantic-settings reads env
