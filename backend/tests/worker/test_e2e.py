"""End to end: a save through the API is picked up by the worker and resolved."""

import uuid

import pytest

from app.worker.loop import run_job

pytestmark = pytest.mark.db


async def test_save_via_api_then_worker_reaches_fetch(client, make_user, jwt_for, db):
    uid = await make_user()
    r = await client.post("/saves", json={"text": "https://www.instagram.com/reel/E2eAbc1/?igsh=x"},
                          headers={"Authorization": f"Bearer {jwt_for(uid)}"})
    assert r.status_code == 201
    reel_id = uuid.UUID(r.json()["reel_id"])

    job = await db.fetchrow("select * from public.claim_job('e2e')")
    await run_job(db, job, "e2e")  # RESOLVE runs; the fetch stub requeues the job

    after = await db.fetchrow("select * from public.jobs where id = $1", job["id"])
    assert after["stage"] == "fetch" and after["attempts"] == 0
    assert await db.fetchval(
        "select shortcode_key from public.reels where id = $1", reel_id) == "E2eAbc1"
