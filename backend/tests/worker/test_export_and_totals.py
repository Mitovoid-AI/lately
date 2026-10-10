"""Worker jobs the API enqueues besides enrichment: `export`, plus the per-save
total `enrich` metric that GET /admin/health reports as enrich_p95_ms."""

import json

import pytest

from app.search.seed import seed_card
from app.worker.loop import run_job
from tests.fixtures import CARDS

pytestmark = pytest.mark.db

SC = "TOT1"


def auth(token):
    return {"Authorization": f"Bearer {token}"}


async def claim(db):
    return await db.fetchrow("select * from public.claim_job($1)", "w1")


async def test_finalize_writes_total_enrich_metric(db, make_user, offline_enrichment):
    uid = await make_user()
    url = f"https://www.instagram.com/reel/{SC}/"
    await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $2)", uid, url)
    while (job := await claim(db)) is not None:
        await run_job(db, job, "w1")
    row = await db.fetchrow("select duration_ms, outcome from public.metrics where stage = 'enrich'")
    assert row is not None and row["duration_ms"] >= 0 and row["outcome"] in ("ready", "partial")


async def test_export_job_builds_downloadable_export(client, db, make_user, jwt_for,
                                                     offline_enrichment):
    uid = await make_user()
    await seed_card(db, uid, CARDS["MANALI1"], None)
    headers = auth(jwt_for(uid))
    assert (await client.get("/me/export", headers=headers)).status_code == 404
    assert (await client.post("/me/export", headers=headers)).status_code == 202
    assert (await client.get("/me/export", headers=headers)).status_code == 202  # still queued
    job = await claim(db)
    assert job["kind"] == "export"
    await run_job(db, job, "w1")
    r = await client.get("/me/export", headers=headers)
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    data = json.loads(r.content)
    assert data["account"]["id"] == str(uid)
    assert data["saves"][0]["title"].startswith("Hampta Pass")
    assert data["saves"][0]["note"] == "do this with college friends"


async def test_export_is_private_to_its_user(client, db, make_user, jwt_for, offline_enrichment):
    a, b = await make_user(), await make_user()
    assert (await client.post("/me/export", headers=auth(jwt_for(a)))).status_code == 202
    await run_job(db, await claim(db), "w1")
    assert (await client.get("/me/export", headers=auth(jwt_for(b)))).status_code == 404
    assert (await client.get("/me/export")).status_code == 401
