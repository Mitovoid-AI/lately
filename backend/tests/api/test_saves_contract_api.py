"""/saves read, note, delete — shapes from frontend/src/api/contract.ts (Save, SaveDetail)."""

import uuid

import pytest

from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db

SAVE_KEYS = {"id", "source_url", "shortcode", "status", "note", "created_at", "title",
             "caption", "category", "thumbnail_url", "creator", "channel", "stage"}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------ GET /saves

async def test_list_saves_returns_the_save_shape(client, db, make_user, jwt_for):
    a = await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    r = await client.get("/saves", headers=auth(jwt_for(a)))
    assert r.status_code == 200
    (save,) = r.json()
    assert set(save) == SAVE_KEYS
    assert save["id"] == str(m) and save["status"] == "enriched"
    assert save["title"].startswith("Hampta Pass") and save["category"] == "Food & Places"
    assert save["channel"] == "app_share" and save["note"] == "do this with college friends"
    assert save["stage"] is None  # only a pending save has a stage


async def test_list_saves_filters_by_category(client, db, make_user, jwt_for):
    a = await make_user()
    await seed_card(db, a, CARDS["MANALI1"], None)
    g = await seed_card(db, a, CARDS["GITHUB1"], None)
    r = await client.get("/saves", params={"category": "Dev & Tools"}, headers=auth(jwt_for(a)))
    assert [s["id"] for s in r.json()] == [str(g)]


async def test_list_saves_401_without_token(client):
    assert (await client.get("/saves")).status_code == 401


# -------------------------------------------------------------- GET /saves/id

async def test_get_save_returns_detail(client, db, make_user, jwt_for):
    a = await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    r = await client.get(f"/saves/{m}", headers=auth(jwt_for(a)))
    assert r.status_code == 200
    d = r.json()
    assert set(d) == SAVE_KEYS | {"summary", "steps", "tags", "places", "media_status"}
    assert d["tags"] == ["trek", "himalaya", "itinerary"] and d["media_status"] == "ready"


async def test_get_save_404_for_other_user_and_unknown_id(client, db, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    for sid in (m, uuid.uuid4()):
        r = await client.get(f"/saves/{sid}", headers=auth(jwt_for(b)))
        assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


async def test_get_save_401_without_token(client):
    assert (await client.get(f"/saves/{uuid.uuid4()}")).status_code == 401


# --------------------------------------------------------------- stage (tracker)

async def _pending_save(client, token, shortcode):
    saved = await client.post("/saves", json={"text": f"https://www.instagram.com/reel/{shortcode}/"},
                              headers=auth(token))
    return saved.json()["reel_id"]


async def _set_job_stage(db, reel_id, stage, kind="enrich"):
    await db.execute("update public.jobs set stage = $3 where kind = $1 and payload->>'reel_id' = $2",
                     kind, str(reel_id), stage)


async def test_pending_save_reports_the_enrich_jobs_stage(client, db, make_user, jwt_for):
    token = jwt_for(await make_user())
    rid = await _pending_save(client, token, "STAGE1")
    (save,) = (await client.get("/saves", headers=auth(token))).json()
    assert save["status"] == "pending" and save["stage"] == "resolve"
    for stage in ("fetch", "transcribe", "vision", "structure", "finalize"):
        await _set_job_stage(db, rid, stage)
        assert (await client.get(f"/saves/{rid}", headers=auth(token))).json()["stage"] == stage
        assert (await client.get("/saves", headers=auth(token))).json()[0]["stage"] == stage


async def test_stage_is_null_once_the_save_is_not_pending(client, db, make_user, jwt_for):
    token = jwt_for(await make_user())
    rid = await _pending_save(client, token, "STAGE2")
    await _set_job_stage(db, rid, "finalize")
    # The card landed a moment before the job row was released: the app must not show a step.
    await db.execute("update public.reels set status = 'enriched' where id = $1", uuid.UUID(rid))
    assert (await client.get(f"/saves/{rid}", headers=auth(token))).json()["stage"] is None
    assert (await client.get("/saves", headers=auth(token))).json()[0]["stage"] is None


async def test_stage_ignores_other_job_kinds_other_saves_and_unknown_stages(client, db, make_user,
                                                                            jwt_for):
    token = jwt_for(await make_user())
    first = await _pending_save(client, token, "STAGE3")
    second = await _pending_save(client, token, "STAGE4")
    await _set_job_stage(db, first, "vision")
    # Each save reads its own job, not its neighbour's.
    by_id = {s["id"]: s["stage"] for s in (await client.get("/saves", headers=auth(token))).json()}
    assert by_id == {first: "vision", second: "resolve"}
    # A stage this app does not know (a newer worker) reads as none.
    await _set_job_stage(db, second, "re-rank")
    assert (await client.get(f"/saves/{second}", headers=auth(token))).json()["stage"] is None
    # With no enrich job (only an embed job), there is no stage either.
    await db.execute("delete from public.jobs where kind = 'enrich' and payload->>'reel_id' = $1",
                     second)
    await db.execute("insert into public.jobs (kind, payload, stage) "
                     "values ('embed', jsonb_build_object('reel_id', $1::text), 'embed')", second)
    assert (await client.get(f"/saves/{second}", headers=auth(token))).json()["stage"] is None


# ------------------------------------------------------------ PATCH /saves/id

async def _embed_jobs(db, reel_id):
    return await db.fetch(
        "select stage, payload from public.jobs where kind = 'embed' "
        "and payload->>'reel_id' = $1", str(reel_id))


async def test_patch_note_returns_save_and_enqueues_embed_for_enriched(client, db, make_user,
                                                                       jwt_for):
    a = await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    r = await client.patch(f"/saves/{m}", json={"note": "june trip"}, headers=auth(jwt_for(a)))
    assert r.status_code == 200
    assert set(r.json()) == SAVE_KEYS and r.json()["note"] == "june trip"
    jobs = await _embed_jobs(db, m)
    assert len(jobs) == 1 and jobs[0]["stage"] == "embed"
    # a second edit while the first embed job is still queued adds no duplicate
    await client.patch(f"/saves/{m}", json={"note": "july trip"}, headers=auth(jwt_for(a)))
    assert len(await _embed_jobs(db, m)) == 1


async def test_patch_note_on_pending_save_enqueues_no_embed(client, db, make_user, jwt_for):
    a = await make_user()
    saved = await client.post("/saves", json={"text": "https://www.instagram.com/reel/PEND1/"},
                              headers=auth(jwt_for(a)))
    rid = saved.json()["reel_id"]
    r = await client.patch(f"/saves/{rid}", json={"note": "later"}, headers=auth(jwt_for(a)))
    assert r.status_code == 200 and r.json()["status"] == "pending"
    assert await _embed_jobs(db, rid) == []


async def test_patch_empty_note_clears_it(client, db, make_user, jwt_for):
    a = await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    r = await client.patch(f"/saves/{m}", json={"note": "  "}, headers=auth(jwt_for(a)))
    assert r.status_code == 200 and r.json()["note"] is None


async def test_patch_note_401_without_token(client):
    assert (await client.patch(f"/saves/{uuid.uuid4()}", json={"note": "x"})).status_code == 401


# ----------------------------------------------------------- DELETE /saves/id

async def test_delete_save_removes_reel_keeps_shared_content(client, db, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    other = await seed_card(db, b, CARDS["MANALI1"], None)
    r = await client.delete(f"/saves/{m}", headers=auth(jwt_for(a)))
    assert r.status_code == 204 and r.content == b""
    assert await db.fetchval("select count(*) from public.reels where id = $1", m) == 0
    assert await db.fetchval("select count(*) from public.reels where id = $1", other) == 1
    assert await db.fetchval(
        "select count(*) from public.reel_content where shortcode = 'MANALI1'") == 1
    assert (await client.get(f"/saves/{m}", headers=auth(jwt_for(a)))).status_code == 404


async def test_delete_save_404_for_other_user(client, db, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    r = await client.delete(f"/saves/{m}", headers=auth(jwt_for(b)))
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert await db.fetchval("select count(*) from public.reels where id = $1", m) == 1


async def test_delete_save_401_without_token(client):
    assert (await client.delete(f"/saves/{uuid.uuid4()}")).status_code == 401


# ----------------------------------------------------------- POST /saves 500

async def test_post_saves_500_hides_internal_error(client, make_user, jwt_for, monkeypatch):
    from app.routers import saves

    class Boom:
        async def fetchrow(self, *a, **k):
            raise RuntimeError("secret connection string leaked")

    monkeypatch.setattr(saves, "pool", lambda: Boom())
    r = await client.post("/saves", json={"text": "https://www.instagram.com/reel/X1/"},
                          headers=auth(jwt_for(await make_user())))
    assert r.status_code == 500
    err = r.json()["error"]
    assert err["code"] == "SERVER" and "secret" not in err["message"]
