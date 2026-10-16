"""STRUCTURE: strict JSON → pydantic, one repair retry, caption fallback (fake LLM)."""

import json

import httpx
import pytest

from app.enrich.prompts import PARSER_VERSION
from app.enrich.structure import (
    ChatLLM,
    LLMUnavailable,
    StructureInput,
    fallback_card,
    flatten_entity_names,
    parse_json,
    structure_reel,
)

GOOD = {
    "title": "Jhol momos at Majnu ka Tilla",
    "summary": "A momos crawl in Majnu ka Tilla, Delhi.",
    "category": "Food & Places",
    "tags": ["Momos", "delhi food", "street food"],
    "steps": [],
    "entities": [
        {"type": "place", "name": "Majnu ka Tilla", "parent": "Delhi", "region": "Delhi",
         "country": "India"},
        {"type": "food", "name": "jhol momos", "parent": None, "region": None, "country": None},
    ],
    "likely_queries": ["delhi momos", "momos wali jagah", "majnu ka tilla food",
                       "best momos delhi", "tibetan food delhi"],
    "visual_description": "A plate of steamed momos in red soup.",
    "ocr_text": "BEST MOMOS IN DELHI",
    "search_text": "momos jhol laphing majnu ka tilla delhi tibetan street food",
}

INPUT = StructureInput(caption="Best momos in Majnu ka Tilla #delhifood #momos",
                       transcript=None, creator_handle="delhi.foodtrails",
                       image_url="data:image/jpeg;base64,AAAA")


def completion(content, usage=None):
    return httpx.Response(200, json={
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "usage": usage or {"prompt_tokens": 900, "completion_tokens": 300}})


def llm(handler, models=("m1",), **kw):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return ChatLLM(client, base_url="https://llm.example/v1", api_key="k", models=list(models),
                   **kw)


async def test_valid_response_is_ok():
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return completion(json.dumps(GOOD))

    r = await structure_reel(llm(handler), INPUT)
    assert r.outcome == "ok" and r.model == "m1"
    assert r.card["category"] == "Food & Places"
    assert r.card["tags"] == ["momos", "delhi food", "street food"]
    assert r.card["entity_names"] == ["Majnu ka Tilla", "Delhi", "jhol momos"]
    assert r.card["parser_version"] == PARSER_VERSION
    assert r.usage == {"prompt_tokens": 900, "completion_tokens": 300}
    (body,) = bodies
    assert body["model"] == "m1" and body["response_format"]["type"] == "json_schema"
    user = body["messages"][1]["content"]
    assert any(p["type"] == "image_url" for p in user)
    assert "Majnu ka Tilla" in user[0]["text"]


@pytest.mark.parametrize("setting,expected", [
    ("", None),                                   # provider default: field not sent
    ("off", {"enabled": False}),                  # no hidden reasoning: ~3x faster cards
    ("low", {"effort": "low"}),
    ("HIGH", {"effort": "high"}),
])
async def test_reasoning_setting_is_sent(setting, expected):
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return completion(json.dumps(GOOD))

    await structure_reel(llm(handler, reasoning=setting), INPUT)
    (body,) = bodies
    assert body.get("reasoning") == expected


def test_unknown_reasoning_setting_is_refused():
    with pytest.raises(ValueError):
        llm(lambda r: completion("{}"), reasoning="sometimes")


async def test_invalid_then_repaired():
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            return completion(json.dumps({**GOOD, "category": "Food", "likely_queries": ["x"]}))
        return completion("```json\n" + json.dumps(GOOD) + "\n```")

    r = await structure_reel(llm(handler), INPUT)
    assert r.outcome == "repaired" and len(calls) == 2
    repair = calls[1]["messages"][-1]["content"]
    assert "category" in repair and "likely_queries" in repair
    assert calls[1]["messages"][-2]["role"] == "assistant"
    assert r.usage == {"prompt_tokens": 1800, "completion_tokens": 600}


async def test_garbage_twice_falls_back_to_caption_card():
    r = await structure_reel(llm(lambda req: completion("I cannot help with that")), INPUT)
    assert r.outcome == "fallback"
    assert r.card["category"] == "Watch Later"
    assert r.card["title"] == "Best momos in Majnu ka Tilla"
    assert r.card["tags"] == ["delhifood", "momos"]
    assert "Majnu ka Tilla" in r.card["search_text"]


async def test_falls_through_to_fallback_model_and_retries_without_image():
    seen = []

    def handler(request):
        body = json.loads(request.content)
        has_image = any(p.get("type") == "image_url" for p in body["messages"][1]["content"])
        seen.append((body["model"], has_image))
        if body["model"] == "m1":
            return httpx.Response(429, json={"error": "rate limited"})
        if has_image:
            return httpx.Response(400, json={"error": "image input not supported"})
        return completion(json.dumps(GOOD))

    r = await structure_reel(llm(handler, models=("m1", "m2")), INPUT)
    assert r.outcome == "ok" and r.model == "m2"
    assert seen == [("m1", True), ("m2", True), ("m2", False)]


async def test_all_models_down_raises_unavailable():
    with pytest.raises(LLMUnavailable):
        await structure_reel(llm(lambda req: httpx.Response(503)), INPUT)


async def test_no_llm_configured_is_fallback():
    r = await structure_reel(None, INPUT)
    assert r.outcome == "fallback" and r.card["category"] == "Watch Later"


async def test_cost_from_usage_rates_or_provider_cost():
    r = await structure_reel(llm(lambda req: completion(json.dumps(GOOD)),
                                 cost_per_mtok_in=1.0, cost_per_mtok_out=2.0), INPUT)
    assert r.cost_usd == pytest.approx(900 / 1e6 + 600 / 1e6)
    r = await structure_reel(llm(lambda req: completion(
        json.dumps(GOOD), {"prompt_tokens": 1, "completion_tokens": 1, "cost": 0.0042})), INPUT)
    assert r.cost_usd == pytest.approx(0.0042)


async def test_budget_take_called_per_llm_call():
    taken = []

    async def take(provider):
        taken.append(provider)
        return 0

    await structure_reel(llm(lambda req: completion(json.dumps(GOOD))), INPUT, take=take)
    assert taken == ["llm"]


def test_parse_json_handles_fences_and_prose():
    assert parse_json('Sure! {"a": 1} hope that helps') == {"a": 1}
    with pytest.raises(ValueError):
        parse_json("no json here")


def test_flatten_entity_names_dedupes_case_insensitively():
    ents = [{"type": "place", "name": "Hampta Pass", "parent": "Manali",
             "region": "Himachal Pradesh", "country": "India"},
            {"type": "place", "name": "manali", "parent": None, "region": "Himachal Pradesh"}]
    assert flatten_entity_names(ents) == ["Hampta Pass", "Manali", "Himachal Pradesh"]


def test_fallback_card_without_caption():
    card = fallback_card(StructureInput(caption=None, transcript=None,
                                        creator_handle="dev.tips", image_url=None))
    assert card["title"] == "Reel by @dev.tips" and card["likely_queries"] == []
