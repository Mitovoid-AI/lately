"""scripts/enrich_one.py core (offline) and scripts/reembed.py core (DB)."""

import json

import httpx
import pytest

from app.enrich.backfill import enqueue_reembed
from app.enrich.fetch import FetchResult
from app.enrich.oneshot import enrich_url
from app.enrich.structure import ChatLLM

CARD = {
    "title": "VS Code shortcuts", "summary": "Three VS Code shortcuts.",
    "category": "Dev & Tools", "tags": ["vscode"], "steps": ["Ctrl+P"], "entities": [],
    "likely_queries": ["vscode shortcuts", "vs code tips", "coding shortcut wala reel",
                       "editor tricks", "keyboard shortcuts"],
    "visual_description": "", "ocr_text": "", "search_text": "vscode shortcuts",
}


class Stub:
    name, budget = "stub", "instagram"

    async def fetch(self, shortcode, url):
        assert shortcode == "DxAbc12"
        return FetchResult(source="ytdlp", caption="3 VS Code shortcuts", creator_handle="dev",
                           audio_url="https://cdn.test/a.m4a", duration_s=30)


async def test_enrich_url_runs_chain_and_prints_card(offline_enrichment):
    rt = offline_enrichment
    rt.fetchers = [Stub()]

    def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(CARD)}}]})

    rt.llm = ChatLLM(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                     "https://llm.test/v1", "k", ["m"])
    out = await enrich_url(rt, "https://www.instagram.com/reel/DxAbc12/?igsh=zz")
    assert out["shortcode"] == "DxAbc12" and out["media_status"] == "ready"
    assert out["card"]["category"] == "Dev & Tools"
    assert out["transcribe"] == "no_key" and out["structure"]["outcome"] == "ok"
    json.dumps(out)  # printable


async def test_enrich_url_bad_url():
    with pytest.raises(ValueError):
        await enrich_url(None, "https://example.com/nope")


@pytest.mark.db
async def test_enqueue_reembed_missing_and_all(db, make_user):
    uid = await make_user()
    ids = []
    for i, (status, emb) in enumerate([("enriched", False), ("partial", False),
                                       ("enriched", True), ("pending", False)]):
        url = f"https://www.instagram.com/reel/RE{i}/"
        rid = (await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $2)",
                                 uid, url))["reel_id"]
        vec = "[" + ",".join(["0.1"] * 768) + "]"
        await db.execute("update public.reels set status = $2, embedding = $3::vector "
                         "where id = $1", rid, status, vec if emb else None)
        ids.append(rid)
    await db.execute("delete from public.jobs")
    assert await enqueue_reembed(db, all_reels=False) == 2
    assert await enqueue_reembed(db, all_reels=False) == 0  # already queued
    assert await enqueue_reembed(db, all_reels=True) == 1   # + the embedded one
    queued = {json.loads(r["payload"])["reel_id"] for r in await db.fetch(
        "select payload from public.jobs where kind = 'embed'")}
    assert queued == {str(ids[0]), str(ids[1]), str(ids[2])}
