"""TRANSCRIBE (PIPELINE.md §5 stage 3): Groq Whisper, only when it pays off.

Runs only if an audio (or video) URL is known, the reel is ≤ 180 s (unknown
duration is allowed; the 25 MB cap still bounds it), the caption is weak
(< ~40 words) and GROQ_API_KEY is set. Everything else is a skip.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from .fetch import FetchResult, download_limited

log = logging.getLogger("lately.enrich")


@dataclass
class Transcript:
    text: str
    duration_s: float | None = None


class TranscribeError(Exception):
    pass


def should_transcribe(fetch: FetchResult, caption: str | None, *, has_key: bool,
                      max_duration_s: float = 180.0,
                      caption_max_words: int = 40) -> tuple[bool, str]:
    if not has_key:
        return False, "no_key"
    if not fetch.media_url:
        return False, "no_audio"
    if fetch.duration_s is not None and fetch.duration_s > max_duration_s:
        return False, "too_long"
    if caption and len(caption.split()) >= caption_max_words:
        return False, "caption_strong"
    return True, "ok"


# Upload fallbacks move whole videos through the worker's connection; one at a
# time keeps them from starving every other stage's network calls.
_UPLOADS = asyncio.Semaphore(1)


class GroqTranscriber:
    """Groq Whisper. Groq fetches the media URL itself (multipart `url` field), so
    no video passes through the worker; if Groq can't retrieve it (a 4xx other
    than auth/rate limit), the file is downloaded and uploaded instead."""

    def __init__(self, client: httpx.AsyncClient, api_key: str, base_url: str,
                 model: str = "whisper-large-v3-turbo", max_bytes: int = 25_000_000,
                 timeout: float = 60.0) -> None:
        self._client = client
        self._key = api_key
        self._url = base_url.rstrip("/") + "/audio/transcriptions"
        self._model = model
        self._max = max_bytes
        self._timeout = timeout

    async def transcribe(self, media_url: str) -> Transcript:
        from .device import is_instagram_cdn_url

        if not is_instagram_cdn_url(media_url):
            raise TranscribeError("media URL is not an Instagram CDN URL")
        resp = await self._post({"url": (None, media_url)})
        if resp.status_code in (400, 404, 413, 415, 422):
            log.info("groq could not fetch the media URL (HTTP %s); uploading instead",
                     resp.status_code)
            async with _UPLOADS:
                audio = await download_limited(self._client, media_url, self._max,
                                               timeout=self._timeout)
                if audio is None:
                    raise TranscribeError("audio download failed or too large")
                name = urlsplit(media_url).path.rsplit("/", 1)[-1] or "audio.mp4"
                resp = await self._post({"file": (name, audio)})
        if resp.status_code != 200:
            raise TranscribeError(f"groq HTTP {resp.status_code}: {resp.text[:200]}")
        body = resp.json()
        duration = body.get("duration")
        return Transcript(text=(body.get("text") or "").strip(),
                          duration_s=float(duration) if duration is not None else None)

    async def _post(self, media: dict[str, tuple[str | None, str | bytes]]) -> httpx.Response:
        fields = {"model": (None, self._model), "response_format": (None, "verbose_json"),
                  **media}
        try:
            return await self._client.post(self._url, headers={"Authorization": f"Bearer {self._key}"},
                                           files=fields, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise TranscribeError(f"groq request failed: {type(exc).__name__}: {exc}") from exc
