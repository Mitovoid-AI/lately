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

    # Browser origins allowed to call the API (comma-separated). Native apps need none.
    cors_origins: str = "http://localhost:8081,http://localhost:8082"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    # Absolute base for URLs the API hands out (thumbnails kept in Postgres).
    # Empty = the host each request came in on (a phone on the LAN gets the PC's IP).
    public_base_url: str = ""

    # Catch-path limits (PIPELINE.md §3 step 3: Postgres count, no Redis at v1)
    rate_limit_per_hour: int = 30

    # Worker
    worker_poll_interval_seconds: float = 0.5
    worker_stuck_after_minutes: int = 10
    worker_concurrency: int = 8
    worker_heartbeat_seconds: float = 30.0

    # Embeddings (SEARCH.md §3): any OpenAI-compatible /embeddings endpoint.
    # Empty key = search runs keyword + fuzzy only.
    embeddings_api_key: str = ""
    embeddings_base_url: str = "https://api.openai.com/v1"
    embeddings_model: str = "text-embedding-3-small"
    embeddings_dimensions: int = 768
    search_embed_timeout_seconds: float = 2.0

    # GET /admin/health requires header X-Admin-Key == this. Empty = endpoint disabled (404).
    admin_key: str = ""

    # Optional AI keys — saves work without them; cards stay partial (Part 2)
    groq_api_key: str = ""

    # Enrichment (Phase 2, PIPELINE.md §5) ------------------------------------
    # FETCH provider chain: IG embed page → yt-dlp → optional paid scraper.
    fetch_timeout_seconds: float = 15.0
    ytdlp_enabled: bool = True
    scraper_api_url: str = ""          # empty = scraper provider disabled
    scraper_api_key: str = ""
    thumbnail_max_bytes: int = 2_000_000
    media_url_max_age_seconds: int = 1800  # older signed media URLs are re-fetched
    # TRANSCRIBE: Groq Whisper (OpenAI-compatible /audio/transcriptions).
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_transcribe_model: str = "whisper-large-v3-turbo"
    groq_cost_per_hour_usd: float = 0.04
    transcribe_max_duration_s: float = 180.0
    transcribe_caption_max_words: int = 40
    transcribe_max_bytes: int = 25_000_000
    # STRUCTURE: any OpenAI-compatible chat-completions endpoint.
    llm_api_key: str = ""
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = ""
    llm_fallback_models: str = ""      # comma-separated, tried in order after LLM_MODEL
    llm_timeout_seconds: float = 60.0
    llm_cost_per_mtok_in_usd: float = 0.0
    llm_cost_per_mtok_out_usd: float = 0.0

    @property
    def llm_models(self) -> list[str]:
        extra = [m.strip() for m in self.llm_fallback_models.split(",") if m.strip()]
        return [m for m in [self.llm_model.strip(), *extra] if m]


@lru_cache
def settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # pydantic-settings reads env
