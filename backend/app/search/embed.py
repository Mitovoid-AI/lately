"""Embedders (SEARCH.md §3): one Protocol, a deterministic offline fake for
tests and evals, and an OpenAI-compatible `/embeddings` client for real use.

The provider is env-only (`EMBEDDINGS_*`). Vectors are L2-normalised and must
be `EMBED_DIM` long to fit `reels.embedding vector(768)`.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import OrderedDict
from collections.abc import Mapping
from typing import Any, Literal, Protocol

import httpx

EMBED_DIM = 768
Task = Literal["document", "query"]


class Embedder(Protocol):
    async def embed(self, texts: list[str], task: Task) -> list[list[float]]: ...


def _normalise(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vec))
    return [x / norm for x in vec] if norm else vec


_TOKEN = re.compile(r"\w+")


class FakeEmbedder:
    """Hashed bag-of-words → 768-d. Deterministic across runs and machines
    (md5, not `hash()`), so shared words mean closer vectors and nothing else."""

    async def embed(self, texts: list[str], task: Task) -> list[list[float]]:
        out = []
        for text in texts:
            vec = [0.0] * EMBED_DIM
            for token in _TOKEN.findall(text.lower()):
                h = int.from_bytes(hashlib.md5(token.encode()).digest()[:4], "little")
                vec[h % EMBED_DIM] += 1.0 if h & (1 << 31) else -1.0
            out.append(_normalise(vec))
        return out


class OpenAIEmbedder:
    """POST {base_url}/embeddings. `task` is ignored: the model is symmetric,
    so documents and queries use the same call."""

    def __init__(self, api_key: str, base_url: str, model: str, dimensions: int = EMBED_DIM,
                 client: httpx.AsyncClient | None = None) -> None:
        self._url = base_url.rstrip("/") + "/embeddings"
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._model = model
        self._dimensions = dimensions
        self._client = client or httpx.AsyncClient(timeout=10.0)

    async def embed(self, texts: list[str], task: Task) -> list[list[float]]:
        resp = await self._client.post(
            self._url, headers=self._headers,
            json={"model": self._model, "input": texts, "dimensions": self._dimensions})
        resp.raise_for_status()
        data = sorted(resp.json()["data"], key=lambda d: d["index"])
        return [_normalise([float(x) for x in d["embedding"]]) for d in data]


class LruCache:
    """Tiny in-process cache for query vectors, keyed by normalised query text."""

    def __init__(self, maxsize: int = 1024) -> None:
        self._maxsize = maxsize
        self._data: OrderedDict[str, list[float]] = OrderedDict()

    def get(self, key: str) -> list[float] | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def put(self, key: str, value: list[float]) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        while len(self._data) > self._maxsize:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()


def card_embedding_text(card: Mapping[str, Any], note: str | None) -> str:
    """title + summary + likely_queries + tags + entity_names + visual_description
    + note, newline-joined, skipping empties."""
    parts: list[str] = []
    for key in ("title", "summary", "likely_queries", "tags", "entity_names",
                "visual_description"):
        value = card.get(key)
        if isinstance(value, list | tuple):
            parts.extend(str(v) for v in value if v)
        elif value:
            parts.append(str(value))
    if note:
        parts.append(note)
    return "\n".join(parts)


def to_pgvector(vec: list[float]) -> str:
    """`[0.1,0.2,...]`, the text form a `$n::vector` parameter accepts."""
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"
