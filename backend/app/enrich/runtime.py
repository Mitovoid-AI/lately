"""The enrichment runtime: every external dependency the stages use, built once
from settings (`runtime()`), swappable in tests (`set_runtime()`).

Empty keys switch a dependency off instead of failing: no LLM key → caption
fallback cards (partial), no GROQ key → no transcripts, no embeddings key →
embed jobs complete as skipped, no service-role key → thumbnails keep their
remote URL.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

import asyncpg
import httpx

from ..config import Settings, settings
from ..search.embed import Embedder, OpenAIEmbedder
from ..services import thumbnails as local_thumbnails
from ..services.saves_view import thumbnail_url
from .fetch import (
    EmbedPageProvider,
    FetchProvider,
    ScraperApiProvider,
    ThumbnailStore,
    YtDlpProvider,
    download_limited,
)
from .structure import ChatLLM
from .transcribe import GroqTranscriber


@dataclass
class Runtime:
    http: httpx.AsyncClient
    fetchers: list[FetchProvider]
    thumbnails: ThumbnailStore
    transcriber: GroqTranscriber | None = None
    llm: ChatLLM | None = None
    embedder: Embedder | None = None
    image_max_bytes: int = 2_000_000
    media_url_max_age_s: int = 1800
    transcribe_max_duration_s: float = 180.0
    transcribe_caption_max_words: int = 40
    groq_cost_per_hour_usd: float = 0.04
    extra: dict[str, object] = field(default_factory=dict)

    async def image_data_url(self, thumbnail_path: str | None,
                             db: asyncpg.Pool | None = None) -> str | None:
        """The thumbnail as a data: URL for the LLM (providers can't always reach
        Instagram's CDN), or None. `db:` thumbnails are read from Postgres."""
        if local_thumbnails.is_local(thumbnail_path):
            assert thumbnail_path is not None
            found = await local_thumbnails.get(
                db, thumbnail_path[len(local_thumbnails.PREFIX):]) if db is not None else None
            if not found:
                return None
            data, kind = found
            return f"data:{kind};base64," + base64.b64encode(data).decode("ascii")
        url = thumbnail_url(thumbnail_path)
        if not url:
            return None
        data = await download_limited(self.http, url, self.image_max_bytes)
        if not data:
            return None
        return "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")


def build_runtime(s: Settings | None = None) -> Runtime:
    s = s or settings()
    http = httpx.AsyncClient(timeout=s.fetch_timeout_seconds,
                             limits=httpx.Limits(max_connections=50))
    fetchers: list[FetchProvider] = [EmbedPageProvider(http, timeout=s.fetch_timeout_seconds)]
    if s.ytdlp_enabled:
        fetchers.append(YtDlpProvider())
    if s.scraper_api_url and s.scraper_api_key:
        fetchers.append(ScraperApiProvider(http, s.scraper_api_url, s.scraper_api_key))
    return Runtime(
        http=http,
        fetchers=fetchers,
        thumbnails=ThumbnailStore(http, s.supabase_url, s.supabase_service_role_key,
                                  s.thumbnail_max_bytes, local=local_thumbnails.writer()),
        transcriber=GroqTranscriber(http, s.groq_api_key, s.groq_base_url,
                                    s.groq_transcribe_model, s.transcribe_max_bytes)
        if s.groq_api_key else None,
        llm=ChatLLM(http, s.llm_base_url, s.llm_api_key, s.llm_models, s.llm_timeout_seconds,
                    s.llm_cost_per_mtok_in_usd, s.llm_cost_per_mtok_out_usd)
        if s.llm_api_key and s.llm_models else None,
        embedder=OpenAIEmbedder(s.embeddings_api_key, s.embeddings_base_url, s.embeddings_model,
                                s.embeddings_dimensions, client=http)
        if s.embeddings_api_key else None,
        image_max_bytes=s.thumbnail_max_bytes,
        media_url_max_age_s=s.media_url_max_age_seconds,
        transcribe_max_duration_s=s.transcribe_max_duration_s,
        transcribe_caption_max_words=s.transcribe_caption_max_words,
        groq_cost_per_hour_usd=s.groq_cost_per_hour_usd,
    )


_current: Runtime | None = None


def runtime() -> Runtime:
    global _current
    if _current is None:
        _current = build_runtime()
    return _current


def set_runtime(rt: Runtime | None) -> None:
    """Install a runtime (tests: fakes; None = rebuild from settings on next use)."""
    global _current
    _current = rt
