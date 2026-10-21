"""The plan in GET /me, the account export, and what DELETE /me removes of billing."""

import json

import pytest

from app.worker.loop import run_job
from tests.billing.helpers import auth, days, reel_url

pytestmark = pytest.mark.db


async def test_me_for_a_free_user_has_no_expiry(client, make_user, jwt_for):
    me = (await client.get("/me", headers=auth(jwt_for(await make_user())))).json()
    assert me["plan"] == "free" and me["plan_expires_at"] is None
    assert me["saves_limit"] == 20


async def test_me_returns_the_plan_and_when_it_ends(client, make_user, jwt_for, set_plan):
    uid = await make_user()
    end = days(30)
    await set_plan(uid, "pro", end, changed=days(-1))
    me = (await client.get("/me", headers=auth(jwt_for(uid)))).json()
    assert me["plan"] == "pro"
    assert me["plan_expires_at"].startswith(end.strftime("%Y-%m-%dT%H:%M:%S"))


async def test_me_shows_an_expired_pro_as_free(client, make_user, jwt_for, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(-2))
    me = (await client.get("/me", headers=auth(jwt_for(uid)))).json()
    assert me["plan"] == "free" and me["plan_expires_at"] is None


async def test_me_keeps_pro_during_the_one_day_slack(client, make_user, jwt_for, set_plan):
    uid = await make_user()
    await set_plan(uid, "pro", days(-0.5))
    assert (await client.get("/me", headers=auth(jwt_for(uid)))).json()["plan"] == "pro"


async def test_me_for_pro_without_expiry_and_for_lifetime(client, make_user, jwt_for, set_plan):
    uid = await make_user()
    h = auth(jwt_for(uid))
    await set_plan(uid, "pro", None)
    me = (await client.get("/me", headers=h)).json()
    assert me["plan"] == "pro" and me["plan_expires_at"] is None
    await set_plan(uid, "lifetime", days(-5))
    me = (await client.get("/me", headers=h)).json()
    assert me["plan"] == "lifetime" and me["plan_expires_at"] is None


async def test_me_agrees_with_the_save_cap(client, make_user, jwt_for, set_plan):
    uid = await make_user()
    h = auth(jwt_for(uid))
    await set_plan(uid, "pro", days(-2), limit=1)  # lapsed: free again, cap of 1
    assert (await client.post("/saves", json={"text": reel_url("M1")}, headers=h)
            ).status_code == 201
    assert (await client.post("/saves", json={"text": reel_url("M2")}, headers=h)
            ).status_code == 429
    me = (await client.get("/me", headers=h)).json()
    assert me["plan"] == "free" and me["saves_this_month"] == me["saves_limit"] == 1


async def test_the_export_carries_the_effective_plan(client, db, make_user, jwt_for, set_plan):
    uid = await make_user()
    h = auth(jwt_for(uid))
    end = days(30)
    await set_plan(uid, "pro", end)
    assert (await client.post("/me/export", headers=h)).status_code == 202
    await run_job(db, await db.fetchrow("select * from public.claim_job('w1')"), "w1")
    account = json.loads((await client.get("/me/export", headers=h)).content)["account"]
    assert account["plan"] == "pro"
    assert account["plan_expires_at"].startswith(end.strftime("%Y-%m-%dT%H:%M:%S"))

    await set_plan(uid, "pro", days(-2))  # lapsed
    assert (await client.post("/me/export", headers=h)).status_code == 202
    await run_job(db, await db.fetchrow("select * from public.claim_job('w1')"), "w1")
    account = json.loads((await client.get("/me/export", headers=h)).content)["account"]
    assert account["plan"] == "free" and account["plan_expires_at"] is None


async def test_deleting_the_account_removes_its_billing_events(
        client, db, make_user, jwt_for, send, make_event):
    gone, kept = await make_user(), await make_user()
    anon = "$RCAnonymousID:0a1b2c3d4e5f"
    own = make_event("INITIAL_PURCHASE", gone, expires=days(30))
    via_alias = make_event("RENEWAL", anon, expires=days(30), aliases=[anon, str(gone)])
    via_original = make_event("RENEWAL", anon, expires=days(30), aliases=[anon],
                              original_app_user_id=str(gone))
    # A TRANSFER names users only in transferred_from / transferred_to (no app_user_id).
    moved_from = make_event("TRANSFER", None, transferred_from=[str(gone)],
                            transferred_to=[str(kept)])
    moved_to = make_event("TRANSFER", None, transferred_from=[str(kept)],
                          transferred_to=[str(gone), anon])
    others = make_event("INITIAL_PURCHASE", kept, expires=days(30))
    unrelated = make_event("INITIAL_PURCHASE", anon, aliases=[anon])
    for body in (own, via_alias, via_original, moved_from, moved_to, others, unrelated):
        assert (await send(body)).status_code == 200
    assert await db.fetchval("select count(*) from public.billing_events") == 7

    r = await client.delete("/me", headers=auth(jwt_for(gone)))
    assert r.status_code == 204
    left = {row["id"] for row in await db.fetch("select id from public.billing_events")}
    assert left == {others["event"]["id"], unrelated["event"]["id"]}
    assert await db.fetchval("select count(*) from public.profiles where id = $1", gone) == 0
    assert await db.fetchval("select count(*) from public.profiles where id = $1", kept) == 1
