"""Instagram DM door end to end (routers/instagram.py, migration 0016): Meta's
webhook with real signatures, linking by code, saves, notes, replies through a
fake Graph API, and the app's /me/instagram endpoints."""

import hashlib
import hmac
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.config import settings
from app.services import instagram

pytestmark = pytest.mark.db

SECRET = "test-app-secret"
VERIFY = "test-verify-token"
TOKEN = "test-access-token-never-logged"
HANDLE = "lately.app"
ACCOUNT = "17841400000000001"
GRAPH = "https://graph.test/v27.0"
_SIGN = object()


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def reel(code):
    return f"https://www.instagram.com/reel/{code}/"


def sign(raw: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def dm(sender="9001", text=None, *, attachments=None, mid=None, recipient=ACCOUNT, **flags):
    message = {"mid": mid or f"mid.{uuid.uuid4().hex}"}
    if text is not None:
        message["text"] = text
    if attachments is not None:
        message["attachments"] = attachments
    return {"object": "instagram", "entry": [{"id": recipient, "time": 1, "messaging": [
        {"sender": {"id": sender}, "recipient": {"id": recipient}, "timestamp": 1,
         "message": message | flags}]}]}


def _refuse(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"unexpected Graph API call in a test: {request.url}")


class FakeGraph:
    """Stands in for graph.instagram.com: records every reply."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status = 200

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={"error": {"message": "nope", "code": 10}})
        return httpx.Response(200, json={"recipient_id": "x", "message_id": "y"})

    @property
    def sent(self) -> list[tuple[str, str]]:
        bodies = [json.loads(r.content) for r in self.requests]
        return [(b["recipient"]["id"], b["message"]["text"]) for b in bodies]

    def clear(self) -> None:
        self.requests.clear()


@pytest.fixture(autouse=True)
def _instagram_defaults(monkeypatch):
    """Whatever backend/.env says: the door is off, no real Graph API call, fresh limits."""
    s = settings()
    for name in ("instagram_app_secret", "instagram_verify_token", "instagram_access_token",
                 "instagram_handle", "instagram_account_id"):
        monkeypatch.setattr(s, name, "")
    monkeypatch.setattr(s, "instagram_graph_base_url", GRAPH)
    monkeypatch.setattr(
        instagram, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(_refuse)))
    monkeypatch.setattr(instagram, "_prompted", {})
    monkeypatch.setattr(instagram, "_codes_issued", {})


@pytest.fixture
async def graph(monkeypatch, db) -> FakeGraph:
    """The door switched on, replies going to a FakeGraph."""
    s = settings()
    for name, value in (("instagram_app_secret", SECRET), ("instagram_verify_token", VERIFY),
                        ("instagram_access_token", TOKEN), ("instagram_handle", HANDLE)):
        monkeypatch.setattr(s, name, value)
    fake = FakeGraph()
    monkeypatch.setattr(
        instagram, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
    await db.execute("truncate public.instagram_messages")
    return fake


@pytest.fixture
def send(client, graph):
    """POST a body to the webhook, signed unless `signature` says otherwise."""

    async def _send(body=None, *, raw: bytes | None = None, signature=_SIGN) -> httpx.Response:
        raw = raw if raw is not None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        sig = sign(raw) if signature is _SIGN else signature
        if sig is not None:
            headers["X-Hub-Signature-256"] = sig
        return await client.post("/webhooks/instagram", content=raw, headers=headers)

    return _send


@pytest.fixture
def linked(client, send, graph, make_user, jwt_for):
    """A user whose Instagram account `sender` is linked (through the real flow)."""

    async def _linked(sender="9001"):
        uid = await make_user()
        h = auth(jwt_for(uid))
        code = (await client.post("/me/instagram/code", headers=h)).json()["code"]
        r = await send(dm(sender, f"here: {code}"))
        assert r.status_code == 200 and graph.sent[-1] == (sender, instagram.CONNECTED)
        graph.clear()
        return uid, h

    return _linked


async def saves_of(db, uid):
    return await db.fetch(
        "select id, source_url, source_channel, note, status from public.reels "
        "where auth_user_id = $1 order by created_at", uid)


# ---------------------------------------------------------------- handshake --

async def test_handshake_answers_the_challenge(client, graph):
    r = await client.get("/webhooks/instagram", params={
        "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444"})
    assert r.status_code == 200 and r.text == "1158201444"
    assert r.headers["content-type"].startswith("text/plain")


@pytest.mark.parametrize("params", [
    {"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1"},
    {"hub.mode": "subscribe", "hub.verify_token": VERIFY.upper(), "hub.challenge": "1"},
    {"hub.mode": "subscribe", "hub.challenge": "1"},
    {"hub.mode": "unsubscribe", "hub.verify_token": VERIFY, "hub.challenge": "1"},
    {"hub.verify_token": VERIFY, "hub.challenge": "1"},
])
async def test_handshake_403_without_the_right_token(client, graph, params):
    r = await client.get("/webhooks/instagram", params=params)
    assert r.status_code == 403 and r.text != "1"


@pytest.mark.parametrize("missing", ["instagram_app_secret", "instagram_verify_token",
                                     "instagram_access_token", "instagram_handle"])
async def test_webhook_is_404_until_all_four_settings_are_set(client, graph, monkeypatch,
                                                               missing):
    monkeypatch.setattr(settings(), missing, "")
    r = await client.get("/webhooks/instagram", params={
        "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1"})
    assert r.status_code == 404
    raw = json.dumps(dm("9001", "hi")).encode()
    r = await client.post("/webhooks/instagram", content=raw,
                          headers={"X-Hub-Signature-256": sign(raw)})
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert graph.sent == []


async def test_webhook_is_404_by_default(client, db):
    assert (await client.get("/webhooks/instagram")).status_code == 404
    assert (await client.post("/webhooks/instagram", content=b"{}")).status_code == 404


# ---------------------------------------------------------------- signature --

async def test_bad_or_missing_signature_is_401_and_changes_nothing(send, graph, db, linked):
    await linked("9001")
    raw = json.dumps(dm("9001", reel("SIG1"))).encode()
    for bad in (None, "", "sha256=", "sha1=abc", sign(raw, secret="other"), sign(raw + b" "),
                sign(raw)[:-1], "sha256=" + "0" * 64):
        r = await send(raw=raw, signature=bad)
        assert r.status_code == 401, bad
        assert r.json()["error"]["code"] == "UNAUTHORIZED"
    assert await db.fetchval("select count(*) from public.reels") == 0
    assert await db.fetchval("select count(*) from public.instagram_messages") == 1  # the link
    assert graph.sent == []


async def test_signature_covers_the_raw_bytes_not_the_parsed_json(send, graph, db, linked):
    uid, _ = await linked("9001")
    body = dm("9001", reel("RAW1"))
    odd = json.dumps(body, indent=3, ensure_ascii=True).encode() + b"\n"
    compact = json.dumps(body, separators=(",", ":")).encode()
    r = await send(raw=compact, signature=sign(odd))  # same JSON, other bytes
    assert r.status_code == 401
    r = await send(raw=odd, signature=sign(odd))
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert len(await saves_of(db, uid)) == 1


async def test_a_signed_body_that_is_not_json_is_200_and_ignored(send, graph):
    r = await send(raw=b"not json \xff")
    assert r.status_code == 200 and r.json() == {"status": "ignored"}
    assert graph.sent == []


# -------------------------------------------------------------------- skips --

@pytest.mark.parametrize("flag", ["is_echo", "is_deleted", "is_unsupported", "is_self"])
async def test_echo_deleted_unsupported_and_self_messages_are_skipped(send, graph, db, flag):
    r = await send(dm("9001", "hi", **{flag: True}))
    assert r.status_code == 200
    assert graph.sent == []
    assert await db.fetchval("select count(*) from public.instagram_messages") == 0


async def test_reactions_and_reads_are_skipped(send, graph, db):
    base = {"sender": {"id": "9001"}, "recipient": {"id": ACCOUNT}, "timestamp": 1}
    body = {"object": "instagram", "entry": [{"id": ACCOUNT, "messaging": [
        base | {"reaction": {"mid": "m1", "action": "react", "reaction": "love"}},
        base | {"read": {"mid": "m1"}}, base | {"postback": {"mid": "m1", "payload": "x"}}]}]}
    assert (await send(body)).status_code == 200
    assert graph.sent == []


async def test_messages_for_another_account_are_skipped(send, graph, monkeypatch, linked, db):
    uid, _ = await linked("9001")
    monkeypatch.setattr(settings(), "instagram_account_id", ACCOUNT)
    assert (await send(dm("9001", reel("OTHER1"), recipient="17841400000000999"))
            ).status_code == 200
    assert graph.sent == [] and await saves_of(db, uid) == []
    assert (await send(dm("9001", reel("MINE1")))).status_code == 200
    assert graph.sent == [("9001", instagram.SAVED)]


async def test_the_changes_shape_is_handled_too(send, graph, linked, db):
    uid, _ = await linked("9001")
    body = {"object": "instagram", "entry": [{"id": ACCOUNT, "time": 1, "changes": [
        {"field": "messages", "value": {
            "sender": {"id": "9001"}, "recipient": {"id": ACCOUNT}, "timestamp": "1",
            "message": {"mid": "mid.changes1", "text": reel("CHG1")}}}]}]}
    assert (await send(body)).status_code == 200
    assert graph.sent == [("9001", instagram.SAVED)]
    assert [s["source_url"] for s in await saves_of(db, uid)] == [reel("CHG1")]


# -------------------------------------------------------------------- dedupe --

async def test_a_redelivered_message_is_handled_once(send, graph, linked, db):
    uid, _ = await linked("9001")
    body = dm("9001", reel("DUP1"), mid="mid.same")
    for _ in range(3):
        assert (await send(body)).status_code == 200
    assert graph.sent == [("9001", instagram.SAVED)]
    assert len(await saves_of(db, uid)) == 1
    unlinked = dm("9555", "hello", mid="mid.unlinked")
    for _ in range(2):
        await send(unlinked)
    assert graph.sent[1:] == [("9555", instagram.CONNECT_FIRST)]


async def test_old_message_ids_are_pruned(send, graph, db):
    await db.execute("insert into public.instagram_messages (mid, received_at) values "
                     "('old', now() - interval '8 days'), ('recent', now() - interval '6 days')")
    await send(dm("9001", "hi"))
    left = {r["mid"] for r in await db.fetch("select mid from public.instagram_messages")}
    assert "old" not in left and "recent" in left


# ------------------------------------------------------------------- linking --

async def test_a_code_links_the_sender(client, send, graph, db, make_user, jwt_for):
    uid = await make_user()
    h = auth(jwt_for(uid))
    made = (await client.post("/me/instagram/code", headers=h)).json()
    r = await send(dm("9001", f"hi! my code is {made['code'].lower()} :)"))
    assert r.status_code == 200 and graph.sent == [("9001", instagram.CONNECTED)]
    row = await db.fetchrow("select * from public.instagram_links where ig_user_id = '9001'")
    assert row["auth_user_id"] == uid and row["last_save_id"] is None
    assert await db.fetchval("select count(*) from public.instagram_link_codes") == 0
    state = (await client.get("/me/instagram", headers=h)).json()
    assert state["linked"] is True and state["code"] is None and state["linked_at"]


async def test_a_code_works_once(client, send, graph, db, make_user, jwt_for):
    h = auth(jwt_for(await make_user()))
    code = (await client.post("/me/instagram/code", headers=h)).json()["code"]
    await send(dm("9001", code))
    await send(dm("9002", code))
    assert graph.sent == [("9001", instagram.CONNECTED), ("9002", instagram.CODE_FAILED)]
    assert await db.fetchval("select count(*) from public.instagram_links") == 1


async def test_an_expired_or_unknown_code_does_not_link(client, send, graph, db, make_user,
                                                        jwt_for):
    h = auth(jwt_for(await make_user()))
    code = (await client.post("/me/instagram/code", headers=h)).json()["code"]
    await db.execute("update public.instagram_link_codes set expires_at = now() - interval '1 s'")
    await send(dm("9001", code))
    await send(dm("9001", "LATELY-ZZZZZZ"))
    await send(dm("9001", "LATELY-ABC23O"))  # not even from the alphabet
    assert graph.sent == [("9001", instagram.CODE_FAILED)] * 3
    assert await db.fetchval("select count(*) from public.instagram_links") == 0


async def test_relinking_replaces_earlier_links_of_the_sender_and_of_the_user(
        client, send, graph, db, make_user, jwt_for):
    a, b = await make_user(), await make_user()
    ha, hb = auth(jwt_for(a)), auth(jwt_for(b))
    await send(dm("9001", (await client.post("/me/instagram/code", headers=ha)).json()["code"]))
    # the same Instagram account now links to user b: a loses it
    await send(dm("9001", (await client.post("/me/instagram/code", headers=hb)).json()["code"]))
    links = {r["ig_user_id"]: r["auth_user_id"]
             for r in await db.fetch("select * from public.instagram_links")}
    assert links == {"9001": b}
    # user b links another Instagram account: one link per user
    await send(dm("9002", (await client.post("/me/instagram/code", headers=hb)).json()["code"]))
    links = {r["ig_user_id"]: r["auth_user_id"]
             for r in await db.fetch("select * from public.instagram_links")}
    assert links == {"9002": b}
    assert (await client.get("/me/instagram", headers=ha)).json()["linked"] is False
    assert graph.sent == [("9001", instagram.CONNECTED), ("9001", instagram.CONNECTED),
                          ("9002", instagram.CONNECTED)]


async def test_an_unlinked_sender_is_told_to_connect_once_an_hour(send, graph, db):
    for text in ("hi", reel("UNL1"), "hello?"):
        assert (await send(dm("9100", text))).status_code == 200
    await send(dm("9200", "hi"))
    assert graph.sent == [("9100", instagram.CONNECT_FIRST), ("9200", instagram.CONNECT_FIRST)]
    assert await db.fetchval("select count(*) from public.reels") == 0
    instagram._prompted["9100"] -= 3601  # an hour later
    await send(dm("9100", "still there?"))
    assert graph.sent[-1] == ("9100", instagram.CONNECT_FIRST) and len(graph.sent) == 3


# --------------------------------------------------------------------- saves --

async def test_a_reel_shared_as_an_attachment_is_saved(client, send, graph, db, linked):
    uid, h = await linked("9001")
    att = [{"type": "ig_reel", "payload": {
        "url": "https://www.instagram.com/reel/ATT1/?igsh=xyz", "title": "a caption"}}]
    r = await send(dm("9001", attachments=att))
    assert r.status_code == 200 and graph.sent == [("9001", instagram.SAVED)]
    (save,) = await saves_of(db, uid)
    assert save["source_url"] == reel("ATT1") and save["source_channel"] == "telegram"
    assert save["status"] == "pending"
    assert await db.fetchval("select count(*) from public.jobs where kind = 'enrich' "
                             "and payload->>'reel_id' = $1", str(save["id"])) == 1
    link = await db.fetchrow("select * from public.instagram_links where ig_user_id = '9001'")
    assert link["last_save_id"] == save["id"] and link["last_save_at"] is not None
    (listed,) = (await client.get("/saves", headers=h)).json()
    assert listed["channel"] == "meta_dm" and listed["id"] == str(save["id"])


async def test_a_link_in_the_text_is_saved(send, graph, db, linked):
    uid, _ = await linked("9001")
    await send(dm("9001", "this one is great https://instagram.com/p/TXT1/?utm_source=ig_web"))
    assert graph.sent == [("9001", instagram.SAVED)]
    assert [s["source_url"] for s in await saves_of(db, uid)] == ["https://instagram.com/p/TXT1/"]


async def test_the_same_reel_twice_is_already_saved(send, graph, db, linked):
    uid, _ = await linked("9001")
    await send(dm("9001", reel("TWICE1")))
    await send(dm("9001", reel("TWICE1") + "?igsh=again"))
    assert [t for _, t in graph.sent] == [instagram.SAVED, instagram.ALREADY_SAVED]
    assert len(await saves_of(db, uid)) == 1


async def test_quota_and_rate_limit_replies(send, graph, db, linked, monkeypatch):
    uid, _ = await linked("9001")
    await db.execute("insert into public.profiles (id, saves_free_limit) values ($1, 1) "
                     "on conflict (id) do update set saves_free_limit = 1", uid)
    await send(dm("9001", reel("Q1")))
    await send(dm("9001", reel("Q2")))
    assert [t for _, t in graph.sent] == [instagram.SAVED, instagram.QUOTA_REACHED]

    graph.clear()
    await db.execute("update public.profiles set saves_free_limit = 100 where id = $1", uid)
    monkeypatch.setattr(settings(), "rate_limit_per_hour", 1)
    await send(dm("9001", reel("R1")))
    assert [t for _, t in graph.sent] == [instagram.TOO_MANY]
    assert len(await saves_of(db, uid)) == 1


async def test_a_link_that_is_not_a_reel(send, graph, db, linked):
    uid, _ = await linked("9001")
    await send(dm("9001", "follow https://www.instagram.com/natgeo/"))
    await send(dm("9001", attachments=[{"type": "share", "payload": {
        "url": "https://www.instagram.com/stories/natgeo/123/"}}]))
    assert graph.sent == [("9001", instagram.NOT_A_REEL)] * 2
    assert await saves_of(db, uid) == []


async def test_a_cdn_only_attachment_asks_for_the_link_and_logs_its_shape(
        send, graph, db, linked, caplog):
    uid, _ = await linked("9001")
    cdn = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=17&signature=SIGNED"
    caplog.set_level(logging.INFO, logger="app.services.instagram")
    await send(dm("9001", "secret words", attachments=[
        {"type": "ig_reel", "payload": {"url": cdn, "reel_video_id": "17"}}]))
    assert graph.sent == [("9001", instagram.ASK_FOR_LINK)]
    assert await saves_of(db, uid) == []
    assert "ig_reel[reel_video_id,url]" in caplog.text
    assert cdn not in caplog.text and "SIGNED" not in caplog.text
    assert "secret words" not in caplog.text and "9001" not in caplog.text


# --------------------------------------------------------------------- notes --

async def test_a_text_right_after_a_save_becomes_its_note(send, graph, db, linked):
    uid, _ = await linked("9001")
    await send(dm("9001", reel("NOTE1")))
    await send(dm("9001", "  for the trip to Goa  "))
    assert [t for _, t in graph.sent] == [instagram.SAVED, instagram.NOTE_ADDED]
    (save,) = await saves_of(db, uid)
    assert save["note"] == "for the trip to Goa"
    # a pending save is embedded when its enrichment finishes: no embed job
    assert await db.fetchval("select count(*) from public.jobs where kind = 'embed'") == 0
    # the save has a note now: another text is not taken as one
    await send(dm("9001", "and something else"))
    assert graph.sent[-1] == ("9001", instagram.NO_REEL)
    assert (await saves_of(db, uid))[0]["note"] == "for the trip to Goa"


async def test_a_note_on_an_enriched_save_queues_an_embed_job(send, graph, db, linked):
    uid, _ = await linked("9001")
    await send(dm("9001", reel("NOTE2")))
    (save,) = await saves_of(db, uid)
    await db.execute("update public.reels set status = 'enriched' where id = $1", save["id"])
    await send(dm("9001", "x" * 600))
    assert graph.sent[-1] == ("9001", instagram.NOTE_ADDED)
    assert (await saves_of(db, uid))[0]["note"] == "x" * 500
    assert await db.fetchval("select count(*) from public.jobs where kind = 'embed' "
                             "and payload->>'reel_id' = $1", str(save["id"])) == 1


async def test_a_text_more_than_5_minutes_after_the_save_is_not_a_note(send, graph, db, linked):
    uid, _ = await linked("9001")
    await send(dm("9001", reel("NOTE3")))
    await db.execute("update public.instagram_links set last_save_at = now() - interval '6 minutes'")
    await send(dm("9001", "why I saved it"))
    assert graph.sent[-1] == ("9001", instagram.NO_REEL)
    assert (await saves_of(db, uid))[0]["note"] is None


async def test_a_save_that_already_has_a_note_keeps_it(client, send, graph, db, linked):
    uid, h = await linked("9001")
    await send(dm("9001", reel("NOTE4")))
    (save,) = await saves_of(db, uid)
    await client.patch(f"/saves/{save['id']}", json={"note": "from the app"}, headers=h)
    await send(dm("9001", "from instagram"))
    assert graph.sent[-1] == ("9001", instagram.NO_REEL)
    assert (await saves_of(db, uid))[0]["note"] == "from the app"


async def test_plain_text_with_no_save_yet(send, graph, linked):
    await linked("9001")
    await send(dm("9001", "hello"))
    await send(dm("9001", "   "))
    assert graph.sent == [("9001", instagram.NO_REEL)] * 2


# ------------------------------------------------------------ failures, replies --

async def test_one_failing_message_does_not_fail_the_delivery(send, graph, db, linked,
                                                               monkeypatch):
    uid, _ = await linked("9001")
    real = instagram.handle_message

    async def flaky(db_, msg):
        if "BOOM" in msg.text:
            raise RuntimeError("boom")
        return await real(db_, msg)

    monkeypatch.setattr(instagram, "handle_message", flaky)
    body = dm("9001", "BOOM " + reel("F1"))
    body["entry"][0]["messaging"].append(dm("9001", reel("F2"))["entry"][0]["messaging"][0])
    r = await send(body)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert [s["source_url"] for s in await saves_of(db, uid)] == [reel("F2")]
    assert graph.sent == [("9001", instagram.SAVED)]


async def test_replies_carry_the_token_and_a_failed_reply_is_only_logged(
        send, graph, linked, caplog):
    await linked("9001")
    graph.status = 400
    caplog.set_level(logging.INFO)
    r = await send(dm("9001", reel("REP1")))
    assert r.status_code == 200
    (req,) = graph.requests
    assert str(req.url) == f"{GRAPH}/me/messages"
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert "instagram reply not sent: HTTP 400" in caplog.text
    assert TOKEN not in caplog.text and SECRET not in caplog.text


# -------------------------------------------------------------- /me/instagram --

OFF = {"enabled": False, "handle": None, "linked": False, "linked_at": None, "code": None,
       "code_expires_at": None}


async def test_me_instagram_when_the_door_is_off(client, db, make_user, jwt_for):
    uid = await make_user()
    h = auth(jwt_for(uid))
    await db.execute("insert into public.instagram_links (ig_user_id, auth_user_id) "
                     "values ('9001', $1)", uid)
    r = await client.get("/me/instagram", headers=h)
    assert r.status_code == 200 and r.json() == OFF
    r = await client.post("/me/instagram/code", headers=h)
    assert r.status_code == 404
    assert r.json()["error"] == {"code": "NOT_FOUND",
                                 "message": "Saving from Instagram isn't available yet."}
    assert (await client.delete("/me/instagram", headers=h)).status_code == 204
    assert await db.fetchval("select count(*) from public.instagram_links") == 0


async def test_me_instagram_code_lifecycle(client, graph, db, make_user, jwt_for):
    h = auth(jwt_for(await make_user()))
    r = await client.get("/me/instagram", headers=h)
    assert r.status_code == 200
    assert r.json() == OFF | {"enabled": True, "handle": HANDLE}

    first = (await client.post("/me/instagram/code", headers=h)).json()
    assert first["enabled"] is True and first["linked"] is False
    assert first["code"].startswith("LATELY-") and len(first["code"]) == 13
    expires = datetime.fromisoformat(first["code_expires_at"])
    assert timedelta(minutes=14) < expires - datetime.now(UTC) <= timedelta(minutes=15, seconds=5)
    assert (await client.get("/me/instagram", headers=h)).json() == first

    second = (await client.post("/me/instagram/code", headers=h)).json()
    assert second["code"] != first["code"]
    assert await db.fetchval("select count(*) from public.instagram_link_codes") == 1

    await db.execute("update public.instagram_link_codes set expires_at = now() - interval '1 s'")
    assert (await client.get("/me/instagram", headers=h)).json()["code"] is None


async def test_me_instagram_handle_drops_a_leading_at(client, graph, monkeypatch, make_user,
                                                      jwt_for):
    monkeypatch.setattr(settings(), "instagram_handle", " @lately.app ")
    h = auth(jwt_for(await make_user()))
    assert (await client.get("/me/instagram", headers=h)).json()["handle"] == "lately.app"


async def test_me_instagram_code_is_rate_limited(client, graph, make_user, jwt_for):
    h = auth(jwt_for(await make_user()))
    for _ in range(10):
        assert (await client.post("/me/instagram/code", headers=h)).status_code == 200
    r = await client.post("/me/instagram/code", headers=h)
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"
    other = auth(jwt_for(await make_user()))
    assert (await client.post("/me/instagram/code", headers=other)).status_code == 200


async def test_unlink_removes_the_link_and_the_code(client, send, graph, db, linked):
    _, h = await linked("9001")
    await client.post("/me/instagram/code", headers=h)
    r = await client.delete("/me/instagram", headers=h)
    assert r.status_code == 204 and r.content == b""
    assert (await client.get("/me/instagram", headers=h)).json() == OFF | {
        "enabled": True, "handle": HANDLE}
    for table in ("instagram_links", "instagram_link_codes"):
        assert await db.fetchval(f"select count(*) from public.{table}") == 0
    await send(dm("9001", reel("AFTER1")))
    assert graph.sent == [("9001", instagram.CONNECT_FIRST)]
    assert (await client.delete("/me/instagram", headers=h)).status_code == 204


async def test_me_instagram_needs_a_token(client):
    assert (await client.get("/me/instagram")).status_code == 401
    assert (await client.post("/me/instagram/code")).status_code == 401
    assert (await client.delete("/me/instagram")).status_code == 401


async def test_deleting_the_account_leaves_no_instagram_rows(client, send, graph, db, linked):
    uid, h = await linked("9001")
    await send(dm("9001", reel("GONE1")))
    await client.post("/me/instagram/code", headers=h)
    other, _ = await linked("9002")
    assert await db.fetchval("select count(*) from public.instagram_link_codes") == 1

    assert (await client.delete("/me", headers=h)).status_code == 204
    for table in ("instagram_links", "instagram_link_codes"):
        assert await db.fetchval(
            f"select count(*) from public.{table} where auth_user_id = $1", uid) == 0, table
    assert await db.fetchval("select count(*) from public.instagram_links "
                             "where ig_user_id = '9001'") == 0
    assert await db.fetchval("select auth_user_id from public.instagram_links "
                             "where ig_user_id = '9002'") == other
    graph.clear()
    await send(dm("9001", reel("GONE2")))
    assert graph.sent == [("9001", instagram.CONNECT_FIRST)]
