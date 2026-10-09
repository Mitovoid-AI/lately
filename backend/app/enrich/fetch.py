"""FETCH (PIPELINE.md §5 stage 2): a chain of providers, tried in order, first
success wins.

1. `EmbedPageProvider` — Instagram's public embed page
   (`/reel/{sc}/embed/captioned/`): caption, creator handle, thumbnail, and the
   video URL when the page carries one. No login, one GET.
2. `YtDlpProvider` — yt-dlp metadata extraction (never downloads the video):
   caption, uploader, thumbnail, duration, an audio URL for TRANSCRIBE.
3. `ScraperApiProvider` — optional paid scraper (`SCRAPER_API_URL`/`_KEY`).
4. Give up → an empty `FetchResult(source=None)`; the card becomes `partial`.

Each provider names a `budget` (migration 0007 `provider_budget`); the chain
takes a token before calling it and raises `BudgetExhausted` when none is left.

Media URLs are signed and short-lived: they live in the job payload and in
`reel_content.fetch_meta`, never as display sources. Thumbnails are copied to
Supabase Storage (`thumbnails/{shortcode}.jpg`); video is never stored.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, fields
from html.parser import HTMLParser
from typing import Any, Protocol

import httpx

from .budget import BudgetExhausted

log = logging.getLogger("lately.enrich")

BROWSER_UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")


@dataclass
class FetchResult:
    source: str | None
    caption: str | None = None
    creator_handle: str | None = None
    thumbnail_url: str | None = None
    video_url: str | None = None
    audio_url: str | None = None
    duration_s: float | None = None

    @property
    def media_url(self) -> str | None:
        """Best URL to transcribe from: audio-only first, else the video file."""
        return self.audio_url or self.video_url

    @property
    def useful(self) -> bool:
        return bool(self.caption or self.thumbnail_url or self.media_url)

    def to_meta(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_meta(cls, meta: dict[str, Any] | None) -> FetchResult:
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (meta or {}).items() if k in names})


class FetchProvider(Protocol):
    name: str
    budget: str | None

    async def fetch(self, shortcode: str, url: str) -> FetchResult | None: ...


TakeToken = Callable[[str], Awaitable[int]]


async def run_chain(providers: list[FetchProvider], shortcode: str, url: str,
                    take: TakeToken | None = None) -> FetchResult:
    for p in providers:
        if take is not None and p.budget:
            wait = await take(p.budget)
            if wait:
                raise BudgetExhausted(p.budget, wait)
        try:
            result = await p.fetch(shortcode, url)
        except Exception as exc:  # noqa: BLE001 — a provider failing means "try the next"
            log.info("fetch provider %s failed for %s: %s", p.name, shortcode, exc)
            continue
        if result is not None and result.useful:
            return result
    return FetchResult(source=None)


# ------------------------------------------------------------- embed page --

def _classes(attrs: list[tuple[str, str | None]]) -> set[str]:
    return set((dict(attrs).get("class") or "").split())


class _EmbedParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.handle: str | None = None
        self.thumbnail: str | None = None
        self._caption: list[str] = []
        self._divs = 0
        self._caption_at: int | None = None   # div depth of div.Caption
        self._skip_at: int | None = None      # div depth of div.CaptionComments
        self._in_caption_user = False
        self._in_username = False
        self.saw_caption = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        cls = _classes(attrs)
        if tag == "div":
            self._divs += 1
            if "Caption" in cls and self._caption_at is None:
                self._caption_at = self._divs
                self.saw_caption = True
            elif "CaptionComments" in cls and self._caption_at is not None:
                self._skip_at = self._divs
        elif tag == "a" and "CaptionUsername" in cls:
            self._in_caption_user = True
        elif tag == "span" and "UsernameText" in cls:
            self._in_username = True
        elif tag == "img" and "EmbeddedMediaImage" in cls and not self.thumbnail:
            self.thumbnail = dict(attrs).get("src") or None
        elif tag == "br" and self._capturing:
            self._caption.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "div":
            if self._skip_at == self._divs:
                self._skip_at = None
            if self._caption_at == self._divs:
                self._caption_at = -1  # done; never reopen
            self._divs -= 1
        elif tag == "a":
            self._in_caption_user = False
        elif tag == "span":
            self._in_username = False

    @property
    def _capturing(self) -> bool:
        return (self._caption_at is not None and self._caption_at > 0
                and self._skip_at is None and not self._in_caption_user)

    def handle_data(self, data: str) -> None:
        if self._in_caption_user or self._in_username:
            self.handle = self.handle or data.strip() or None
            return
        if self._capturing:
            self._caption.append(data)

    @property
    def caption(self) -> str | None:
        lines = [" ".join(line.split()) for line in "".join(self._caption).split("\n")]
        text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        return text or None


_VIDEO_URL = re.compile(r'video_url\\*"\s*:\s*\\*"(.*?)\\*"')
_DURATION = re.compile(r'video_duration\\*"\s*:\s*([0-9.]+)')
_UNICODE_ESC = re.compile(r"\\+u([0-9a-fA-F]{4})")


def _unescape_json_url(raw: str) -> str:
    url = _UNICODE_ESC.sub(lambda m: chr(int(m.group(1), 16)), raw)
    return re.sub(r"\\+/", "/", url).replace("\\", "")


def parse_embed_page(html: str) -> FetchResult | None:
    p = _EmbedParser()
    p.feed(html)
    p.close()
    video = None
    if m := _VIDEO_URL.search(html):
        video = _unescape_json_url(m.group(1)) or None
    duration = float(m.group(1)) if (m := _DURATION.search(html)) else None
    result = FetchResult(source="embed_page", caption=p.caption, creator_handle=p.handle,
                         thumbnail_url=p.thumbnail, video_url=video, duration_s=duration)
    return result if result.useful else None


class EmbedPageProvider:
    name = "embed_page"
    budget = "instagram"

    def __init__(self, client: httpx.AsyncClient, timeout: float = 15.0) -> None:
        self._client = client
        self._timeout = timeout

    async def fetch(self, shortcode: str, url: str) -> FetchResult | None:
        resp = await self._client.get(
            f"https://www.instagram.com/reel/{shortcode}/embed/captioned/",
            headers={"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"},
            timeout=self._timeout, follow_redirects=True)
        if resp.status_code != 200:
            log.info("embed page %s: HTTP %s", shortcode, resp.status_code)
            return None
        return parse_embed_page(resp.text)


# ----------------------------------------------------------------- yt-dlp --

Extractor = Callable[[str], dict[str, Any]]


def _ytdlp_extract(url: str) -> dict[str, Any]:  # pragma: no cover — network
    import yt_dlp

    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True,
            "socket_timeout": 15}
    with yt_dlp.YoutubeDL(opts) as ydl:  # type: ignore[arg-type]
        return ydl.sanitize_info(ydl.extract_info(url, download=False))  # type: ignore[no-any-return]


def _size(f: dict[str, Any]) -> float:
    return float(f.get("filesize") or f.get("filesize_approx") or float("inf"))


def info_to_result(info: dict[str, Any]) -> FetchResult:
    formats = [f for f in info.get("formats") or [] if f.get("url")]
    audio_only = [f for f in formats
                  if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")]
    muxed = [f for f in formats
             if f.get("vcodec") not in (None, "none") and f.get("acodec") not in (None, "none")]
    thumb = info.get("thumbnail")
    if not thumb and info.get("thumbnails"):
        thumb = info["thumbnails"][-1].get("url")
    duration = info.get("duration")
    return FetchResult(
        source="ytdlp",
        caption=(info.get("description") or "").strip() or None,
        creator_handle=info.get("channel") or info.get("uploader_id") or info.get("uploader"),
        thumbnail_url=thumb,
        audio_url=min(audio_only, key=_size)["url"] if audio_only else None,
        video_url=min(muxed, key=_size)["url"] if muxed else info.get("url"),
        duration_s=float(duration) if duration is not None else None,
    )


class YtDlpProvider:
    name = "ytdlp"
    budget = "instagram"

    def __init__(self, extractor: Extractor | None = None, timeout: float = 30.0) -> None:
        self._extract = extractor or _ytdlp_extract
        self._timeout = timeout

    async def fetch(self, shortcode: str, url: str) -> FetchResult | None:
        try:
            info = await asyncio.wait_for(asyncio.to_thread(self._extract, url), self._timeout)
        except Exception as exc:  # noqa: BLE001 — login walls, rate limits, timeouts
            log.info("yt-dlp %s: %s", shortcode, exc)
            return None
        return info_to_result(info) if info else None


# ---------------------------------------------------------------- scraper --

def _first(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if d.get(k):
            return d[k]
    return None


class ScraperApiProvider:
    """Generic paid scraper: `GET {SCRAPER_API_URL}?url=<reel url>` with
    `Authorization: Bearer {SCRAPER_API_KEY}`, returning JSON with any of
    caption | owner.username / username | display_url / thumbnail_url |
    video_url | audio_url | video_duration / duration."""

    name = "scraper"
    budget = "scraper"

    def __init__(self, client: httpx.AsyncClient, api_url: str, api_key: str,
                 timeout: float = 30.0) -> None:
        self._client, self._url, self._key, self._timeout = client, api_url, api_key, timeout

    async def fetch(self, shortcode: str, url: str) -> FetchResult | None:
        resp = await self._client.get(self._url, params={"url": url},
                                      headers={"Authorization": f"Bearer {self._key}"},
                                      timeout=self._timeout)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if isinstance(data.get("data"), dict):
            data = data["data"]
        owner = data.get("owner") if isinstance(data.get("owner"), dict) else {}
        duration = _first(data, "video_duration", "duration")
        return FetchResult(
            source="scraper",
            caption=_first(data, "caption", "description", "text"),
            creator_handle=_first(owner, "username") or _first(data, "username", "author"),
            thumbnail_url=_first(data, "display_url", "thumbnail_url", "thumbnail"),
            video_url=_first(data, "video_url"),
            audio_url=_first(data, "audio_url"),
            duration_s=float(duration) if duration is not None else None,
        )


# -------------------------------------------------------------- thumbnail --

async def download_limited(client: httpx.AsyncClient, url: str, max_bytes: int,
                           timeout: float = 15.0) -> bytes | None:
    """GET `url` into memory, or None if it fails or exceeds `max_bytes`."""
    try:
        async with client.stream("GET", url, timeout=timeout, follow_redirects=True,
                                 headers={"User-Agent": BROWSER_UA}) as resp:
            if resp.status_code != 200:
                return None
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                return None
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf += chunk
                if len(buf) > max_bytes:
                    return None
            return bytes(buf)
    except httpx.HTTPError as exc:
        log.info("download %s failed: %s", url[:80], exc)
        return None


class ThumbnailStore:
    """Copy a thumbnail into Supabase Storage (`thumbnails/{sc}.jpg`, upsert).

    Returns the `thumbnail_path` to store: the object path on success, else the
    remote URL (saves_view passes absolute URLs through), else None."""

    def __init__(self, client: httpx.AsyncClient, supabase_url: str, service_key: str,
                 max_bytes: int = 2_000_000) -> None:
        self._client = client
        self._base = supabase_url.rstrip("/")
        self._key = service_key
        self._max = max_bytes

    async def store(self, shortcode: str, image_url: str | None) -> str | None:
        if not image_url:
            return None
        if not self._key:
            return image_url
        data = await download_limited(self._client, image_url, self._max)
        if data is None:
            return image_url
        path = f"{shortcode}.jpg"
        try:
            resp = await self._client.post(
                f"{self._base}/storage/v1/object/thumbnails/{path}", content=data,
                headers={"Authorization": f"Bearer {self._key}", "apikey": self._key,
                         "x-upsert": "true", "Content-Type": "image/jpeg"},
                timeout=15.0)
        except httpx.HTTPError as exc:
            log.warning("thumbnail upload %s failed: %s", shortcode, exc)
            return image_url
        if resp.status_code >= 300:
            log.warning("thumbnail upload %s: HTTP %s", shortcode, resp.status_code)
            return image_url
        return path
