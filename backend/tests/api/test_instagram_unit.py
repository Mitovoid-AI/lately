"""Instagram DM door, no database: signature, codes, payload parsing, link finding
and the reply sender (services/instagram.py)."""

import hashlib
import hmac
import json
import logging
import re

import httpx
import pytest

from app.config import settings
from app.services import instagram
from app.services.instagram import Incoming

SECRET = "unit-app-secret"
TOKEN = "unit-access-token-do-not-log"
ACCOUNT = "17841400000000001"


def sign(raw: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def event(message: dict, sender: str = "9001", recipient: str = ACCOUNT,
          entry_id: str = ACCOUNT) -> dict:
    return {"object": "instagram", "entry": [{"id": entry_id, "time": 1, "messaging": [
        {"sender": {"id": sender}, "recipient": {"id": recipient}, "timestamp": 1,
         "message": message}]}]}


def msg(text: str = "", attachments: tuple = ()) -> Incoming:
    return Incoming(sender="9001", mid="m1", text=text, attachments=attachments)


# ---------------------------------------------------------------- signature --

def test_signature_accepts_the_hmac_of_the_exact_body():
    raw = b'{"object": "instagram", "entry": []}'
    assert instagram.verify_signature(SECRET, sign(raw), raw)
    assert instagram.verify_signature(SECRET, sign(raw).upper().replace("SHA256=", "sha256="), raw)


@pytest.mark.parametrize("header", [
    None, "", "sha256=", "sha256", "garbage", "sha1=" + "0" * 40,
    sign(b'{"object": "instagram", "entry": []}', secret="other"),
    sign(b'{"object":"instagram","entry":[]}'),           # same JSON, other bytes
    sign(b'{"object": "instagram", "entry": []} '),        # one byte more
    "sha256=" + "é" * 64,
])
def test_signature_refuses_anything_else(header):
    raw = b'{"object": "instagram", "entry": []}'
    assert not instagram.verify_signature(SECRET, header, raw)


def test_signature_refuses_when_no_secret_is_configured():
    raw = b"{}"
    assert not instagram.verify_signature("", sign(raw, secret=""), raw)


# -------------------------------------------------------------------- codes --

def test_new_codes_use_the_unambiguous_alphabet():
    codes = {instagram.new_code() for _ in range(200)}
    assert len(codes) == 200
    for code in codes:
        assert re.fullmatch(r"LATELY-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}", code), code


@pytest.mark.parametrize("text,code", [
    ("LATELY-ABC234", "LATELY-ABC234"),
    ("my code is lately-abc234 thanks", "LATELY-ABC234"),
    ("Code:LATELY-XyZ987.", "LATELY-XYZ987"),
    ("(LATELY-ABC234)\nsent from my phone", "LATELY-ABC234"),
    ("LATELY-ABC23O", "LATELY-ABC23O"),  # a mistyped code still reads as a code attempt
])
def test_find_code_anywhere_in_the_text(text, code):
    assert instagram.find_code(text) == code


@pytest.mark.parametrize("text", [
    "", "LATELY-ABC23", "LATELY-ABC2345", "XLATELY-ABC234", "LATELY ABC234",
    "https://www.instagram.com/reel/LATELY-ABC234/x",
])
def test_find_code_needs_exactly_six_characters_standing_alone(text):
    assert instagram.find_code(text) is None


def test_code_limit_is_ten_an_hour_per_user(monkeypatch):
    monkeypatch.setattr(instagram, "_codes_issued", {})
    assert all(instagram.code_allowed("u1") for _ in range(10))
    assert not instagram.code_allowed("u1")
    assert instagram.code_allowed("u2")
    instagram._codes_issued["u1"] = [t - 3601 for t in instagram._codes_issued["u1"]]
    assert instagram.code_allowed("u1")


# ------------------------------------------------------------------ payload --

def test_message_events_reads_the_messaging_shape():
    body = event({"mid": "m1", "text": "hi", "attachments": [
        {"type": "ig_reel", "payload": {"url": "https://www.instagram.com/reel/A1/"}}]})
    (m,) = instagram.message_events(body, ACCOUNT)
    assert m == Incoming(sender="9001", mid="m1", text="hi", attachments=(
        {"type": "ig_reel", "payload": {"url": "https://www.instagram.com/reel/A1/"}},))


def test_message_events_reads_the_changes_shape():
    body = {"object": "instagram", "entry": [{"id": ACCOUNT, "time": 1, "changes": [
        {"field": "messages", "value": {"sender": {"id": "9002"}, "recipient": {"id": ACCOUNT},
                                        "timestamp": "1", "message": {"mid": "m2", "text": "x"}}},
        {"field": "comments", "value": {"sender": {"id": "9003"}, "message": {"mid": "m3"}}}]}]}
    assert [(m.sender, m.mid) for m in instagram.message_events(body)] == [("9002", "m2")]


@pytest.mark.parametrize("flag", ["is_echo", "is_deleted", "is_unsupported", "is_self"])
def test_message_events_skips_flagged_messages(flag):
    assert instagram.message_events(event({"mid": "m1", "text": "hi", flag: True})) == []


def test_message_events_skips_reactions_reads_postbacks_and_edits():
    base = {"sender": {"id": "9001"}, "recipient": {"id": ACCOUNT}, "timestamp": 1}
    items = [base | {"reaction": {"mid": "m1", "action": "react", "reaction": "love"}},
             base | {"read": {"mid": "m1"}},
             base | {"postback": {"mid": "m1", "title": "x", "payload": "y"}},
             base | {"message_edit": {"mid": "m1", "text": "z"}}]
    body = {"object": "instagram", "entry": [{"id": ACCOUNT, "messaging": items}]}
    assert instagram.message_events(body) == []


def test_message_events_skips_the_accounts_own_messages():
    assert instagram.message_events(event({"mid": "m1"}, sender=ACCOUNT)) == []


def test_account_id_filters_other_accounts():
    other = "17841400000000999"
    ok = event({"mid": "m1", "text": "hi"})
    assert len(instagram.message_events(ok, ACCOUNT)) == 1
    assert instagram.message_events(event({"mid": "m1"}, recipient=other, entry_id=other),
                                    ACCOUNT) == []
    assert instagram.message_events(event({"mid": "m1"}, recipient=other), ACCOUNT) == []
    assert instagram.message_events(event({"mid": "m1"}, entry_id=other), ACCOUNT) == []
    # without the setting every account's messages are read
    assert len(instagram.message_events(event({"mid": "m1"}, recipient=other, entry_id=other))) == 1


@pytest.mark.parametrize("body", [
    None, [], "x", {}, {"object": "page", "entry": []}, {"object": "instagram"},
    {"object": "instagram", "entry": "x"}, {"object": "instagram", "entry": [1, None]},
    {"object": "instagram", "entry": [{"messaging": [{"message": {"mid": "m"}}]}]},  # no sender
    {"object": "instagram", "entry": [{"messaging": [{"sender": {"id": "1"},
                                                      "message": {"text": "no mid"}}]}]},
    {"object": "instagram", "entry": [{"messaging": [{"sender": {"id": True},
                                                      "message": {"mid": "m"}}]}]},
])
def test_message_events_ignores_malformed_bodies(body):
    assert instagram.message_events(body, ACCOUNT) == []


def test_message_text_is_cleaned_of_nul():
    (m,) = instagram.message_events(event({"mid": "m1", "text": "a\x00b"}))
    assert m.text == "ab"


# -------------------------------------------------------------------- links --

def test_find_link_prefers_an_attachment_and_strips_tracking():
    m = msg("also https://www.instagram.com/reel/TEXT1/", (
        {"type": "ig_reel", "payload": {"url": "https://www.instagram.com/reel/ATT1/?igsh=abc"}},))
    assert instagram.find_link(m) == ("https://www.instagram.com/reel/ATT1/", False)


def test_find_link_reads_any_payload_string_and_the_text():
    nested = ({"type": "share", "payload": {"x": [{"link": "instagram.com/p/NEST1"}]}},)
    assert instagram.find_link(msg("", nested)) == ("https://instagram.com/p/NEST1", False)
    assert instagram.find_link(msg("look https://instagram.com/reel/T1/?utm_source=ig")) == (
        "https://instagram.com/reel/T1/", False)


def test_find_link_cdn_only_and_other_instagram_pages():
    cdn = ({"type": "ig_reel", "payload": {
        "url": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=s"}},)
    assert instagram.find_link(msg("", cdn)) == (None, False)
    assert instagram.find_link(msg("https://scontent.cdninstagram.com/v/t51/x.mp4")) == (None, False)
    assert instagram.find_link(msg("see https://www.instagram.com/natgeo/")) == (None, True)
    assert instagram.find_link(msg("hello")) == (None, False)


def test_attachment_shape_names_types_and_keys_only():
    shape = instagram._attachment_shape((
        {"type": "ig_reel", "payload": {"url": "https://cdn/secret-url", "title": "my caption"}},
        {"type": 7, "payload": "x"}))
    assert shape == "ig_reel[title,url] ?[]"


# ------------------------------------------------------------------ replies --

@pytest.fixture
def graph_settings(monkeypatch):
    s = settings()
    monkeypatch.setattr(s, "instagram_access_token", TOKEN)
    monkeypatch.setattr(s, "instagram_graph_base_url", "https://graph.test/v27.0/")
    monkeypatch.setattr(s, "instagram_account_id", "")  # backend/.env may set one


async def test_send_reply_posts_to_the_graph_api(monkeypatch, graph_settings):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"recipient_id": "9001", "message_id": "x"})

    monkeypatch.setattr(instagram, "_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    await instagram.send_reply("9001", "é" * 600)  # 1200 bytes: cut to 1000
    (r,) = seen
    assert r.method == "POST" and str(r.url) == "https://graph.test/v27.0/me/messages"
    assert r.headers["authorization"] == f"Bearer {TOKEN}"
    body = json.loads(r.content)
    assert body == {"recipient": {"id": "9001"}, "message": {"text": "é" * 500}}


async def test_send_reply_uses_the_account_id_path_when_set(monkeypatch, graph_settings):
    """Unified login: a system-user token's /me is not the Instagram account."""
    monkeypatch.setattr(settings(), "instagram_account_id", " 17841400000000001 ")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"recipient_id": "9001", "message_id": "x"})

    monkeypatch.setattr(instagram, "_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    await instagram.send_reply("9001", "hi")
    (r,) = seen
    assert str(r.url) == "https://graph.test/v27.0/17841400000000001/messages"


@pytest.mark.parametrize("failure", ["http", "network"])
async def test_send_reply_never_raises_and_never_logs_the_token(
        monkeypatch, graph_settings, caplog, failure):
    def handler(request: httpx.Request) -> httpx.Response:
        if failure == "network":
            raise httpx.ConnectError(f"boom {request.headers['authorization']}")
        return httpx.Response(400, json={"error": {
            "message": "Invalid OAuth access token", "code": 190, "error_subcode": 463}})

    monkeypatch.setattr(instagram, "_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    caplog.set_level(logging.WARNING, logger="app.services.instagram")
    await instagram.send_reply("9001", "hi")
    assert "instagram reply not sent" in caplog.text
    assert TOKEN not in caplog.text
    if failure == "http":
        assert "HTTP 400" in caplog.text and "code 190" in caplog.text


# ------------------------------------------------------------- shared posts --

POST_CDN = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=18139494541428835&signature=SIGNED"


def shared_post(media_id="18139494541428835") -> tuple:
    return ({"type": "ig_post", "payload": {
        "ig_post_media_id": media_id, "title": "Rough week", "url": POST_CDN}},)


def test_a_shared_post_has_no_link_but_has_a_media_id():
    m = msg("", shared_post())
    assert instagram.find_link(m) == (None, False)
    assert instagram.post_media_ids(m) == ["18139494541428835"]
    assert instagram.post_media_ids(msg("", shared_post("not-a-number"))) == []
    assert instagram.post_media_ids(msg("", (
        {"type": "ig_reel", "payload": {"ig_post_media_id": "1"}},))) == []


@pytest.fixture
def lookup(monkeypatch):
    """post_link against a fake Graph API; returns the requests it saw."""
    s = settings()
    monkeypatch.setattr(s, "instagram_access_token", TOKEN)
    monkeypatch.setattr(s, "instagram_graph_base_url", "https://graph.test/v27.0/")
    seen: list[httpx.Request] = []

    def answer(response):
        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            if isinstance(response, Exception):
                raise response
            return response
        monkeypatch.setattr(instagram, "_client",
                            lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        return seen

    return answer


async def test_post_link_uses_the_permalink_meta_returns(lookup):
    seen = lookup(httpx.Response(200, json={
        "permalink": "https://www.instagram.com/p/DgPOST1/?igsh=xyz", "id": "18139494541428835"}))
    assert await instagram.post_link("18139494541428835") == "https://www.instagram.com/p/DgPOST1/"
    (r,) = seen
    assert r.method == "GET"
    assert str(r.url) == "https://graph.test/v27.0/18139494541428835?fields=permalink%2Cshortcode"
    assert r.headers["authorization"] == f"Bearer {TOKEN}"


async def test_post_link_builds_the_link_from_a_shortcode_alone(lookup):
    lookup(httpx.Response(200, json={"shortcode": "DgPOST2"}))
    assert await instagram.post_link("1") == "https://www.instagram.com/p/DgPOST2/"


@pytest.mark.parametrize("response", [
    httpx.Response(400, json={"error": {"message": "Unsupported get request", "code": 100}}),
    httpx.Response(200, json={"id": "1"}),
    httpx.ConnectError("boom"),
])
async def test_post_link_failures_return_none_and_never_log_the_token(lookup, caplog, response):
    lookup(response)
    caplog.set_level(logging.WARNING, logger="app.services.instagram")
    assert await instagram.post_link("1") is None
    assert "instagram post lookup" in caplog.text
    assert TOKEN not in caplog.text


async def test_post_link_without_a_token_asks_nobody(lookup, monkeypatch):
    seen = lookup(httpx.Response(200, json={"shortcode": "X"}))
    monkeypatch.setattr(settings(), "instagram_access_token", "")
    assert await instagram.post_link("1") is None
    assert seen == []
