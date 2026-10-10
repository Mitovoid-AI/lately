"""Device-side fetch hints (PIPELINE.md §5 FETCH "on-device data", §8 trust rule).

Instagram blocks data-centre IPs, so the cloud worker's FETCH often fails while
the user's phone can read the same public embed page. After a save the app
reads `/p/{sc}/embed/captioned/` itself and posts what it parsed to
`POST /saves/{id}/hint`; the hint is stored on the user's save
(`reels.device_hint`) and `DeviceHintProvider` puts it first in that save's
FETCH chain.

A hint is per-user input, never proof: every field is re-validated here
(`sanitize_hint`) both when it arrives and when the worker reads it, media URLs
must be https on Instagram/Facebook CDN hosts, and the worker downloads the
thumbnail itself (`ThumbnailStore.store_verified`) before showing it. Content
built from a hint is marked `reel_content.fetch_source = 'device'` with the
supplying user in `device_user_id`; see the stages for how that limits reuse.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

from .fetch import FetchResult

CDN_SUFFIXES = ("cdninstagram.com", "fbcdn.net")
HANDLE_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
CAPTION_MAX = 5000
DURATION_MAX_S = 3600.0
HINT_FIELDS = ("caption", "creator_handle", "thumbnail_url", "video_url", "duration_s")


def is_instagram_cdn_url(url: object) -> bool:
    """https on *.cdninstagram.com / *.fbcdn.net (or the bare domains), default
    port, no credentials."""
    if not isinstance(url, str) or not url:
        return False
    try:
        p = urlsplit(url.strip())
        port = p.port
    except ValueError:
        return False
    if p.scheme != "https" or p.username or p.password or port not in (None, 443):
        return False
    host = (p.hostname or "").lower().rstrip(".")
    return any(host == s or host.endswith("." + s) for s in CDN_SUFFIXES)


def _caption(v: object) -> str | None:
    if not isinstance(v, str):
        return None
    v = v.strip()
    return v if 0 < len(v) <= CAPTION_MAX else None


def _handle(v: object) -> str | None:
    if not isinstance(v, str):
        return None
    v = v.strip().lstrip("@")
    return v if HANDLE_RE.match(v) else None


def _duration(v: object) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    f = float(v)
    return f if math.isfinite(f) and 0 <= f <= DURATION_MAX_S else None


def sanitize_hint(raw: Mapping[str, Any] | None) -> dict[str, Any]:
    """Every hint field, valid or None. Unknown keys are dropped."""
    raw = raw or {}
    return {
        "caption": _caption(raw.get("caption")),
        "creator_handle": _handle(raw.get("creator_handle")),
        "thumbnail_url": raw["thumbnail_url"].strip()
        if is_instagram_cdn_url(raw.get("thumbnail_url")) else None,
        "video_url": raw["video_url"].strip() if is_instagram_cdn_url(raw.get("video_url")) else None,
        "duration_s": _duration(raw.get("duration_s")),
    }


def hint_is_useful(hint: Mapping[str, Any]) -> bool:
    return bool(hint.get("caption") or hint.get("thumbnail_url") or hint.get("video_url"))


_IMAGE_MAGIC = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a")


def looks_like_image(data: bytes) -> bool:
    """JPEG / PNG / GIF / WebP by signature — a login page is not a thumbnail."""
    if data.startswith(_IMAGE_MAGIC):
        return True
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


class DeviceHintProvider:
    """FETCH provider 0: the user's own device hint for this save. No network,
    no budget. Returns None (→ next provider) when the hint is empty, invalid,
    or was taken for a different shortcode."""

    name = "device"
    budget: str | None = None

    def __init__(self, hint: Mapping[str, Any] | None) -> None:
        self._raw = dict(hint or {})

    async def fetch(self, shortcode: str, url: str) -> FetchResult | None:
        if (sc := self._raw.get("shortcode")) and sc != shortcode:
            return None
        h = sanitize_hint(self._raw)
        result = FetchResult(source="device", caption=h["caption"],
                             creator_handle=h["creator_handle"],
                             thumbnail_url=h["thumbnail_url"], video_url=h["video_url"],
                             duration_s=h["duration_s"])
        return result if result.useful else None
