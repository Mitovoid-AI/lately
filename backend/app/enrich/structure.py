"""STRUCTURE (PIPELINE.md §5 stage 5): ONE chat call → validated card.

Any OpenAI-compatible `/chat/completions` endpoint (`LLM_BASE_URL`,
`LLM_MODEL`, `LLM_FALLBACK_MODELS`). The reply must match `prompts.JSON_SCHEMA`
and validate as `StructuredReel`; if not, one repair call feeds the errors
back; if that fails too, the card is derived from the caption (`fallback`).
Models that reject image input get the same call once more without the image.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..services.saves_view import CATEGORIES
from .budget import BudgetExhausted
from .fetch import TakeToken
from .prompts import JSON_SCHEMA, PARSER_VERSION, SYSTEM_PROMPT, repair_message, user_content

log = logging.getLogger("lately.enrich")

FALLBACK_CATEGORY = "Watch Later"


class Entity(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["place", "food", "tool", "url", "product", "person"]
    name: str = Field(min_length=1)
    parent: str | None = None
    region: str | None = None
    country: str | None = None


def _clean_strings(values: Iterable[Any], lower: bool = False) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        s = " ".join(str(v).split())
        if lower:
            s = s.lower()
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


class StructuredReel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=800)
    category: str
    tags: list[str] = Field(max_length=12)
    steps: list[str] = []
    entities: list[Entity] = []
    likely_queries: list[str]
    visual_description: str = ""
    ocr_text: str = ""
    search_text: str = Field(min_length=1)

    @field_validator("title", "summary", "search_text", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v

    @field_validator("visual_description", "ocr_text", mode="before")
    @classmethod
    def _none_to_empty(cls, v: Any) -> Any:
        return "" if v is None else v

    @field_validator("category")
    @classmethod
    def _category(cls, v: str) -> str:
        for c in CATEGORIES:
            if v.strip().lower() == c.lower():
                return c
        raise ValueError(f"must be exactly one of {list(CATEGORIES)}")

    @field_validator("tags", mode="after")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return _clean_strings(v, lower=True)

    @field_validator("steps", mode="after")
    @classmethod
    def _steps(cls, v: list[str]) -> list[str]:
        return _clean_strings(v)

    @field_validator("likely_queries", mode="after")
    @classmethod
    def _queries(cls, v: list[str]) -> list[str]:
        v = _clean_strings(v)[:8]
        if len(v) < 5:
            raise ValueError(f"need 5-8 distinct queries, got {len(v)}")
        return v


@dataclass
class StructureInput:
    caption: str | None
    transcript: str | None
    creator_handle: str | None
    image_url: str | None  # data: URL or https URL of the thumbnail

    @property
    def empty(self) -> bool:
        return not (self.caption or self.transcript or self.image_url)


@dataclass
class StructureResult:
    card: dict[str, Any]
    outcome: Literal["ok", "repaired", "fallback"]
    model: str | None = None
    usage: dict[str, int] = field(default_factory=dict)
    cost_usd: float = 0.0
    error: str | None = None


class LLMUnavailable(Exception):
    """Every configured model failed at the transport/HTTP level."""


def flatten_entity_names(entities: Iterable[Mapping[str, Any]]) -> list[str]:
    """names + parents + regions, de-duplicated case-insensitively (SEARCH.md §3)."""
    values: list[Any] = []
    for e in entities:
        values.extend(e.get(k) for k in ("name", "parent", "region"))
    return _clean_strings(v for v in values if v)


def parse_json(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in reply")
    data: dict[str, Any] = json.loads(text[start:end + 1])  # {...} always decodes to a dict
    return data


_HASHTAG = re.compile(r"#(\w+)", re.UNICODE)


def _shorten(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return (cut or text[:limit]).rstrip(" ,.;:-") + "…"


def fallback_card(inp: StructureInput) -> dict[str, Any]:
    """A partial card from what we have, when the LLM can't produce one."""
    caption = inp.caption or ""
    plain = " ".join(_HASHTAG.sub("", caption).split())
    first_line = next((" ".join(_HASHTAG.sub("", ln).split()) for ln in caption.splitlines()
                       if _HASHTAG.sub("", ln).strip()), "")
    if first_line:
        title = _shorten(first_line, 80)
    elif inp.creator_handle:
        title = f"Reel by @{inp.creator_handle}"
    else:
        title = "Saved reel"
    tags = _clean_strings((t for t in _HASHTAG.findall(caption)), lower=True)[:10]
    search = " ".join(x for x in (caption, inp.transcript or "", inp.creator_handle or "") if x)
    return {
        "title": title, "summary": _shorten(plain, 280), "category": FALLBACK_CATEGORY,
        "tags": tags, "steps": [], "entities": [], "entity_names": [], "likely_queries": [],
        "visual_description": "", "ocr_text": "", "search_text": search,
        "parser_version": PARSER_VERSION,
    }


def _card(reel: StructuredReel) -> dict[str, Any]:
    card = reel.model_dump()
    card["entity_names"] = flatten_entity_names(card["entities"])
    card["parser_version"] = PARSER_VERSION
    return card


def _without_images(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for m in messages:
        if isinstance(m.get("content"), list):
            m = {**m, "content": [p for p in m["content"] if p.get("type") != "image_url"]}
        out.append(m)
    return out


def _has_image(messages: list[dict[str, Any]]) -> bool:
    return any(isinstance(m.get("content"), list) and
               any(p.get("type") == "image_url" for p in m["content"]) for m in messages)


@dataclass
class Completion:
    text: str
    model: str
    usage: dict[str, int]
    cost_usd: float


_EFFORTS = ("minimal", "low", "medium", "high")


def reasoning_param(setting: str) -> dict[str, Any] | None:
    """LLM_REASONING → the OpenRouter `reasoning` field: "" = provider default
    (not sent), "off" = no hidden reasoning, or an effort level."""
    s = setting.strip().lower()
    if not s:
        return None
    if s == "off":
        return {"enabled": False}
    if s in _EFFORTS:
        return {"effort": s}
    raise ValueError(f"LLM_REASONING must be empty, off or one of {_EFFORTS}, not {setting!r}")


class ChatLLM:
    def __init__(self, client: httpx.AsyncClient, base_url: str, api_key: str,
                 models: list[str], timeout: float = 60.0, cost_per_mtok_in: float = 0.0,
                 cost_per_mtok_out: float = 0.0, reasoning: str = "") -> None:
        if not models:
            raise ValueError("ChatLLM needs at least one model")
        self._reasoning = reasoning_param(reasoning)
        self._client = client
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._headers = {"Authorization": f"Bearer {api_key}",
                         "X-Title": "Lately", "HTTP-Referer": "https://lately.app"}
        self.models = models
        self._timeout = timeout
        self._in, self._out = cost_per_mtok_in, cost_per_mtok_out

    async def _post(self, model: str, messages: list[dict[str, Any]]) -> httpx.Response:
        body = {"model": model, "messages": messages, "temperature": 0.2,
                "response_format": {"type": "json_schema", "json_schema": {
                    "name": "reel_card", "strict": True, "schema": JSON_SCHEMA}}}
        if self._reasoning is not None:
            body["reasoning"] = self._reasoning
        return await self._client.post(self._url, json=body, headers=self._headers,
                                       timeout=self._timeout)

    async def complete(self, messages: list[dict[str, Any]]) -> Completion:
        errors = []
        for model in self.models:
            variants = [messages, _without_images(messages)] if _has_image(messages) \
                else [messages]
            for i, msgs in enumerate(variants):
                try:
                    resp = await self._post(model, msgs)
                except httpx.HTTPError as exc:
                    errors.append(f"{model}: {type(exc).__name__}")
                    break
                if resp.status_code == 200:
                    try:
                        data = resp.json()
                        text = data["choices"][0]["message"]["content"] or ""
                    except (ValueError, KeyError, IndexError, TypeError):
                        errors.append(f"{model}: malformed response")
                        break
                    if not text.strip():
                        errors.append(f"{model}: empty content")
                        break
                    return self._completion(text, model, data.get("usage") or {})
                errors.append(f"{model}: HTTP {resp.status_code}")
                # A 4xx with an image may mean "no vision": retry once text-only.
                if not (resp.status_code in (400, 415, 422) and i == 0 and len(variants) > 1):
                    break
        raise LLMUnavailable("; ".join(errors))

    def _completion(self, text: str, model: str, usage: Mapping[str, Any]) -> Completion:
        u = {"prompt_tokens": int(usage.get("prompt_tokens") or 0),
             "completion_tokens": int(usage.get("completion_tokens") or 0)}
        if usage.get("cost") is not None:
            cost = float(usage["cost"])
        else:
            cost = (u["prompt_tokens"] * self._in + u["completion_tokens"] * self._out) / 1e6
        return Completion(text=text, model=model, usage=u, cost_usd=cost)


def _validate(text: str) -> tuple[StructuredReel | None, str | None]:
    try:
        return StructuredReel.model_validate(parse_json(text)), None
    except ValidationError as exc:
        return None, "\n".join(
            f"- {'.'.join(str(p) for p in e['loc']) or '(root)'}: {e['msg']}"
            for e in exc.errors())
    except ValueError as exc:
        return None, f"- (root): {exc}; reply with one JSON object"


async def structure_reel(llm: ChatLLM | None, inp: StructureInput,
                         take: TakeToken | None = None) -> StructureResult:
    """Raises LLMUnavailable (all models down) and BudgetExhausted (no llm token)."""
    if llm is None or inp.empty:
        return StructureResult(card=fallback_card(inp), outcome="fallback",
                               error="no llm configured" if llm is None else "nothing to parse")
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content(inp.caption, inp.transcript,
                                                 inp.creator_handle, inp.image_url)},
    ]
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    cost = 0.0
    model = None
    error = None
    for attempt in range(2):
        if take is not None and (wait := await take("llm")):
            raise BudgetExhausted("llm", wait)
        c = await llm.complete(messages)
        model = c.model
        cost += c.cost_usd
        for k in usage:
            usage[k] += c.usage.get(k, 0)
        reel, error = _validate(c.text)
        if reel is not None:
            return StructureResult(card=_card(reel), outcome="ok" if attempt == 0 else "repaired",
                                   model=model, usage=usage, cost_usd=cost)
        log.info("structure: invalid reply from %s (attempt %d): %s", model, attempt + 1, error)
        messages = [*messages, {"role": "assistant", "content": c.text},
                    {"role": "user", "content": repair_message(error or "")}]
    return StructureResult(card=fallback_card(inp), outcome="fallback", model=model,
                           usage=usage, cost_usd=cost, error=error)
