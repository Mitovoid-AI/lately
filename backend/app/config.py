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
    # Expo web dev servers: 8081 web, 8082 demo, 8083 live (.claude/launch.json).
    cors_origins: str = "http://localhost:8081,http://localhost:8082,http://localhost:8083"

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
    # Meaning-only hits are kept within best distance + spread, never beyond the max
    # (cosine distance; tuned on text-embedding-3-small, see tests/search/test_meaning_cutoff.py).
    # 0.78: every expected reel in scripts/e2e/queries.tsv is within 0.77, while a small
    # library's nearest unrelated reel ("cafe" -> an AI video editor) sits at 0.80-0.91.
    search_meaning_spread: float = 0.25
    search_meaning_max_distance: float = 0.78

    # GET /admin/health requires header X-Admin-Key == this. Empty = endpoint disabled (404).
    admin_key: str = ""

    # Lately Pro billing (RevenueCat on Google Play). All optional; empty = feature off.
    # POST /webhooks/revenuecat requires header Authorization == this exact value
    # (set the same string in the RevenueCat dashboard). Empty = endpoint disabled (404).
    revenuecat_webhook_auth: str = ""
    # Optional HMAC signing: also require X-RevenueCat-Webhook-Signature "t=<unix>,v1=<hex>".
    revenuecat_webhook_signing_secret: str = ""
    # RevenueCat secret API key (v1 REST). When set, the backend asks RevenueCat for the
    # truth on every event and on POST /billing/sync instead of trusting event fields.
    revenuecat_secret_api_key: str = ""
    revenuecat_entitlement_id: str = "pro"
    # Sandbox purchases (Play license testers during closed testing) count as Pro.
    # Switch off after launch so test purchases stop unlocking accounts: sandbox webhook
    # events are ignored, and with the secret key a sandbox entitlement reads as none.
    revenuecat_allow_sandbox: bool = True
    revenuecat_api_base_url: str = "https://api.revenuecat.com/v1"

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
    # OpenRouter `reasoning`: "off" (default) skips hidden reasoning, which made
    # free reasoning models ~3x slower per card for the same card; "" = provider
    # default; or minimal | low | medium | high.
    llm_reasoning: str = "off"
    llm_cost_per_mtok_in_usd: float = 0.0
    llm_cost_per_mtok_out_usd: float = 0.0

    @property
    def llm_models(self) -> list[str]:
        extra = [m.strip() for m in self.llm_fallback_models.split(",") if m.strip()]
        return [m for m in [self.llm_model.strip(), *extra] if m]


@lru_cache
def settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # pydantic-settings reads env
