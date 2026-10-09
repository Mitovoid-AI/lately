import json
import math

import httpx
import pytest

from app.search.embed import (
    EMBED_DIM,
    FakeEmbedder,
    LruCache,
    OpenAIEmbedder,
    card_embedding_text,
    to_pgvector,
)


def _cos(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True))


async def test_fake_embedder_deterministic_and_unit_length():
    e = FakeEmbedder()
    (a,), (b,) = await e.embed(["manali trek"], "document"), await e.embed(["manali trek"], "query")
    assert a == b and len(a) == EMBED_DIM
    assert math.isclose(math.sqrt(sum(x * x for x in a)), 1.0, rel_tol=1e-6)


async def test_fake_embedder_shared_words_are_closer():
    q, near, far = await FakeEmbedder().embed(["manali trek", "trek in manali", "pasta recipe"], "query")
    assert _cos(q, near) > _cos(q, far)


async def test_openai_embedder_request_shape_and_normalises():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["json"] = json.loads(request.content)
        v0 = [3.0, 4.0] + [0.0] * (EMBED_DIM - 2)
        v1 = [1.0] + [0.0] * (EMBED_DIM - 1)
        return httpx.Response(200, json={"data": [{"index": 1, "embedding": v1},
                                                  {"index": 0, "embedding": v0}]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    e = OpenAIEmbedder("test-key", "https://api.openai.com/v1", "text-embedding-3-small",
                       client=client)
    out = await e.embed(["a", "b"], "document")
    assert seen["url"] == "https://api.openai.com/v1/embeddings"
    assert seen["auth"] == "Bearer test-key"
    assert seen["json"] == {"model": "text-embedding-3-small", "input": ["a", "b"],
                            "dimensions": 768}
    assert out[0][:2] == pytest.approx([0.6, 0.8]) and out[1][0] == pytest.approx(1.0)


async def test_openai_embedder_raises_on_http_error():
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(429)))
    e = OpenAIEmbedder("k", "https://api.openai.com/v1", "m", client=client)
    with pytest.raises(httpx.HTTPStatusError):
        await e.embed(["a"], "query")


def test_card_embedding_text_includes_note_and_likely_queries():
    card = {"title": "Hampta Pass trek", "summary": None, "likely_queries": ["pahad trip plan"],
            "tags": ["trek"], "entity_names": ["Manali"], "visual_description": "snowy mountains"}
    text = card_embedding_text(card, "do this with college friends")
    assert text.split("\n") == ["Hampta Pass trek", "pahad trip plan", "trek", "Manali",
                                "snowy mountains", "do this with college friends"]


def test_lru_cache_evicts_oldest():
    c = LruCache(maxsize=2)
    c.put("a", [1.0]); c.put("b", [2.0]); c.put("c", [3.0])  # noqa: E702
    assert c.get("a") is None and c.get("c") == [3.0]


def test_to_pgvector():
    assert to_pgvector([0.5, -1.0]) == "[0.5,-1.0]"
