"""Instagram URL helpers — port of website/src/lib/instagram.ts.

Pure functions, no I/O. Tracking params are stripped at the catch path so the
stored source_url is canonical (PIPELINE.md §3 step 1).
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_IG_URL_RE = re.compile(
    r"https?://(?:www\.)?instagram\.com/[^\s\"'<>]+", re.IGNORECASE
)
_SHORTCODE_RE = re.compile(
    r"instagram\.com/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)", re.IGNORECASE
)

# Params Instagram (and share links) add that never change what a reel IS.
_TRACKING_PARAMS = {"igsh", "igshid", "utm_source", "utm_medium", "utm_campaign",
                    "utm_content", "utm_term", "ig_rid", "rdid", "share_url"}


def extract_instagram_url(text: str) -> str | None:
    """First Instagram URL in arbitrary shared text (share sheets add prose)."""
    match = _IG_URL_RE.search(text)
    return match.group(0) if match else None


def parse_shortcode(url: str) -> str | None:
    """Shortcode from /reel/, /reels/, /p/, /tv/ paths.

    Returns None for /share/ shortlinks — resolving those is the RESOLVE
    stage's job (PIPELINE.md §5 stage 1), not the catch path's.
    """
    match = _SHORTCODE_RE.search(url)
    return match.group(1) if match else None


def is_share_link(url: str) -> bool:
    """True for instagram.com/share/XXXX shortlinks that need redirect resolution."""
    return bool(re.search(r"instagram\.com/share/[A-Za-z0-9_-]+", url, re.IGNORECASE))


def strip_tracking_params(url: str) -> str:
    """Remove tracking params; keep everything else about the URL."""
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in _TRACKING_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(kept), parts.fragment))


def normalize_shared_text(text: str) -> str | None:
    """Shared text → canonical reel URL, or None if no Instagram link found."""
    url = extract_instagram_url(text)
    if url is None:
        return None
    return strip_tracking_params(url)
