"""Instagram URL helpers — port of website/src/lib/instagram.ts.

Pure functions, no I/O. Tracking params are stripped at the catch path so the
stored source_url is canonical (PIPELINE.md §3 step 1).
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# An instagram.com link, with or without a scheme. The host must stand on its own:
# not part of a longer name (notinstagram.com, instagram.com.evil.com) or of
# another URL's path (evil.com/instagram.com/...).
_IG_URL_RE = re.compile(
    r"(?<![\w.@/-])(?:https?://)?(?P<host>(?:www\.)?instagram\.com)(?![\w.-])"
    r"(?P<rest>[^\s\"'<>]*)",
    re.IGNORECASE,
)
# The links Lately saves: a reel or post (/reel|reels|p|tv/<code>, or the
# permalink /<username>/reel|p|tv/<code>) or a /share/ short link (group 1, the
# shortcode, is None for those). save_reel() (migration 0014) checks the same
# pattern text; change both together.
SAVEABLE_URL = (
    r"^https?://(?:www\.)?instagram\.com/"
    r"(?:(?:reel|reels|p|tv|(?!share/)[A-Za-z0-9._]{1,30}/(?:reel|p|tv))"
    r"/(?!audio(?:[^A-Za-z0-9_-]|$))([A-Za-z0-9_-]+)"
    r"|share/[A-Za-z0-9_-]+)"
)
_SAVEABLE_RE = re.compile(SAVEABLE_URL, re.IGNORECASE)

# Params Instagram (and share links) add that never change what a reel IS.
_TRACKING_PARAMS = {"igsh", "igshid", "utm_source", "utm_medium", "utm_campaign",
                    "utm_content", "utm_term", "ig_rid", "rdid", "share_url"}


def _https(match: re.Match[str]) -> str:
    return f"https://{match['host']}{match['rest']}"


def extract_instagram_url(text: str) -> str | None:
    """First Instagram URL in arbitrary shared text (share sheets add prose),
    always as https:// (a bare `instagram.com/...` gets the scheme)."""
    match = _IG_URL_RE.search(text)
    return _https(match) if match else None


def _saveable(url: str) -> re.Match[str] | None:
    link = extract_instagram_url(url)
    return _SAVEABLE_RE.match(link) if link else None


def is_saveable_link(url: str) -> bool:
    """True for a reel, post or /share/ link; False for any other Instagram page
    (profile, story, explore, audio)."""
    return _saveable(url) is not None


def parse_shortcode(url: str) -> str | None:
    """Shortcode from /reel/, /reels/, /p/, /tv/ paths and /<username>/reel|p|tv/.

    Returns None for /share/ shortlinks — resolving those is the RESOLVE
    stage's job (PIPELINE.md §5 stage 1), not the catch path's.
    """
    match = _saveable(url)
    return match.group(1) if match else None


def is_share_link(url: str) -> bool:
    """True for instagram.com/share/XXXX shortlinks that need redirect resolution."""
    match = _saveable(url)
    return match is not None and match.group(1) is None


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
    """Shared text → canonical reel URL, or None if no Instagram link found.

    The first reel/post/share link wins; with none, the first Instagram link is
    returned (is_saveable_link() then tells the caller it is not a reel or post)."""
    links = [strip_tracking_params(_https(m)) for m in _IG_URL_RE.finditer(text)]
    return next((u for u in links if is_saveable_link(u)), links[0] if links else None)
