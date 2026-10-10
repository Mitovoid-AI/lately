"""Run the enrichment chain for one URL outside the worker (scripts/enrich_one.py).

Same providers and prompt as the worker, no queue, no budget, nothing written.
"""

from __future__ import annotations

from typing import Any

from ..search.seed import reel_url
from ..urls import is_share_link, parse_shortcode
from .fetch import run_chain
from .runtime import Runtime
from .structure import (
    LLMUnavailable,
    StructureInput,
    StructureResult,
    fallback_card,
    structure_reel,
)
from .transcribe import TranscribeError, should_transcribe


async def _shortcode(rt: Runtime, url: str) -> str:
    sc = parse_shortcode(url)
    if sc is None and is_share_link(url):
        resp = await rt.http.get(url, follow_redirects=False, timeout=10)
        sc = parse_shortcode(resp.headers.get("location", ""))
    if not sc:
        raise ValueError(f"not an Instagram reel URL: {url}")
    return sc


async def enrich_url(rt: Runtime | None, url: str) -> dict[str, Any]:
    if rt is None or (parse_shortcode(url) is None and not is_share_link(url)):
        raise ValueError(f"not an Instagram reel URL: {url}")
    sc = await _shortcode(rt, url)
    fetched = await run_chain(rt.fetchers, sc, reel_url(sc))

    transcript = None
    ok, reason = should_transcribe(fetched, fetched.caption, has_key=rt.transcriber is not None,
                                   max_duration_s=rt.transcribe_max_duration_s,
                                   caption_max_words=rt.transcribe_caption_max_words)
    if ok and rt.transcriber is not None and fetched.media_url:
        try:
            transcript = (await rt.transcriber.transcribe(fetched.media_url)).text or None
        except TranscribeError as exc:
            reason = f"error: {exc}"

    inp = StructureInput(caption=fetched.caption, transcript=transcript,
                         creator_handle=fetched.creator_handle,
                         image_url=await rt.image_data_url(fetched.thumbnail_url)
                         if rt.llm is not None else None)
    try:
        r = await structure_reel(rt.llm, inp)
    except LLMUnavailable as exc:
        r = StructureResult(card=fallback_card(inp), outcome="fallback", error=str(exc))
    ready = fetched.source is not None and r.outcome in ("ok", "repaired")
    return {
        "shortcode": sc,
        "fetch": fetched.to_meta(),
        "transcript": transcript,
        "transcribe": reason,
        "structure": {"outcome": r.outcome, "model": r.model, "usage": r.usage,
                      "cost_usd": r.cost_usd, "error": r.error},
        "media_status": "ready" if ready else "partial",
        "card": r.card,
    }
