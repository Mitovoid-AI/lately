"""End to end: a save through the API is picked up by the worker and finished.

With the offline runtime (tests/conftest.py) every fetch provider is absent, so
the reel becomes a partial caption-less card; test_enrich_stages.py covers the
full card path with fake providers.
"""

import uuid

import pytest

from app.worker.loop import run_job

pytestmark = pytest.mark.db


async def test_save_via_api_then_worker_finishes_partial(client, make_user, jwt_for, db):
    uid = await make_user()
    r = await client.post("/saves", json={"text": "https://www.instagram.com/reel/E2eAbc1/?igsh=x"},
                          headers={"Authorization": f"Bearer {jwt_for(uid)}"})
    assert r.status_code == 201
    reel_id = uuid.UUID(r.json()["reel_id"])

    job = await db.fetchrow("select * from public.claim_job('e2e')")
    await run_job(db, job, "e2e")

    reel = await db.fetchrow("select shortcode_key, status from public.reels where id = $1",
                             reel_id)
    assert (reel["shortcode_key"], reel["status"]) == ("E2eAbc1", "partial")
    assert await db.fetchval(
        "select media_status from public.reel_content where shortcode = 'E2eAbc1'") == "partial"
    assert await db.fetchval("select kind from public.jobs") == "embed"
