"""Instagram DM door (PIPELINE.md §2 Door 2, migration 0016).

A user links their Instagram account once by sending a one-time code (made in the
app, POST /me/instagram/code) to Lately's Instagram account. After that, any reel
they send there is saved through save_reel() exactly like POST /saves, with
channel meta_dm, and a text sent within 5 minutes of a save becomes its note.

routers/instagram.py trusts a webhook payload only after its X-Hub-Signature-256
is verified (PIPELINE.md §8). This module turns a verified payload into the DMs
worth answering, decides what each one does and which reply it gets, and sends
the replies through the Instagram Graph API.

Never logged: message text, attachment values, sender ids, the access token. The
most a log line holds is attachment types and payload keys.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import asyncpg
import httpx

from ..config import settings
from ..urls import is_saveable_link, normalize_shared_text
from . import jobs
from .text import clean_text

log = logging.getLogger(__name__)

# Link codes: "LATELY-" + 6 characters without look-alikes (no 0/O, no 1/I); the
# app's demo mode makes them from the same alphabet (frontend/src/api/demo.ts).
CODE_PREFIX = "LATELY-"
CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
CODE_LENGTH = 6
CODE_TTL_MINUTES = 15
CODES_PER_HOUR = 10
# Found anywhere in a message, any case, but not inside a word or a link path. Any
# 6 letters or digits match, so a mistyped code gets "that code didn't work"
# rather than "no reel found".
_CODE_RE = re.compile(r"(?<![A-Za-z0-9_/-])LATELY-([A-Za-z0-9]{6})(?![A-Za-z0-9_-])",
                      re.IGNORECASE)

NOTE_WINDOW_MINUTES = 5
NOTE_MAX_CHARS = 500  # the same cap as PATCH /saves/{id} (models.NoteRequest)
CONNECT_PROMPT_EVERY_S = 3600.0
REPLY_TIMEOUT_S = 10.0
REPLY_MAX_BYTES = 1000  # Instagram's limit for a text message

# Replies (exact texts; tests and docs/instagram-dm-setup.md quote them).
CONNECTED = "Connected. Send me any reel and I'll save it to your Lately library."
CODE_FAILED = ("That code didn't work. Get a new one in the Lately app: Account and settings, "
               "then Save from Instagram DMs.")
CONNECT_FIRST = ("To save reels here, connect your Lately account first: in the Lately app open "
                 "Account and settings, then Save from Instagram DMs, and send me the code it shows.")
SAVED = "Saved to Lately. Your card will be ready in about 30 seconds."
ALREADY_SAVED = "That one is already in your Lately library."
QUOTA_REACHED = ("You've used this month's free saves. Lately Pro in the app gives you "
                 "unlimited saves.")
TOO_MANY = "That's a lot of saves at once. Try again in a little while."
NOT_A_REEL = "That link isn't a reel or post."
NOTE_ADDED = "Added your note."
NO_REEL = ("I couldn't find a reel in that message. In Instagram, tap Share on a reel and "
           "send it here.")
# An attachment arrived but none of its fields held a reel link (e.g. only a CDN
# media URL): ask for the link itself.
ASK_FOR_LINK = ("I couldn't get the reel's link from that. In Instagram, tap Share on the "
                "reel, then Copy link, and send me the link.")

# Message flags that mean "nothing for us to answer" (Meta's messaging webhook).
_SKIP_FLAGS = ("is_echo", "is_deleted", "is_unsupported", "is_self")


# ---------------------------------------------------------------- signature --

def verify_signature(secret: str, header: str | None, raw: bytes) -> bool:
    """X-Hub-Signature-256 is "sha256=" + the hex HMAC-SHA256 of the exact request
    body, keyed with the app secret. Compared in constant time."""
    if not secret or not header:
        return False
    algo, _, given = header.strip().partition("=")
    if algo.lower() != "sha256" or not given:
        return False
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(given.strip().lower().encode(), expected.encode())


# -------------------------------------------------------------------- codes --

def new_code() -> str:
    return CODE_PREFIX + "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def find_code(text: str) -> str | None:
    """The link code in a message, normalised to upper case ("LATELY-ABC234")."""
    match = _CODE_RE.search(text)
    return CODE_PREFIX + match.group(1).upper() if match else None


_codes_issued: dict[str, list[float]] = {}


def code_allowed(user_id: str) -> bool:
    """At most CODES_PER_HOUR new codes per user in any hour, counting this one.
    Kept in this process's memory (one API process today; a restart forgets it)."""
    now = time.monotonic()
    if len(_codes_issued) > 10_000:
        for key in [k for k, ts in _codes_issued.items() if now - ts[-1] >= 3600]:
            del _codes_issued[key]
    recent = [t for t in _codes_issued.get(user_id, ()) if now - t < 3600]
    if len(recent) >= CODES_PER_HOUR:
        _codes_issued[user_id] = recent
        return False
    _codes_issued[user_id] = [*recent, now]
    return True


_prompted: dict[str, float] = {}


def _connect_prompt_due(sender: str) -> bool:
    """"Connect first" goes to a sender at most once an hour (this process's memory)."""
    now = time.monotonic()
    if len(_prompted) > 10_000:
        for key in [k for k, t in _prompted.items() if now - t >= CONNECT_PROMPT_EVERY_S]:
            del _prompted[key]
    last = _prompted.get(sender)
    if last is not None and now - last < CONNECT_PROMPT_EVERY_S:
        return False
    _prompted[sender] = now
    return True


# ------------------------------------------------------------------ payload --

@dataclass(frozen=True)
class Incoming:
    """One DM worth answering: who sent it, its id, its text and attachments."""

    sender: str
    mid: str
    text: str
    attachments: tuple[dict[str, Any], ...]


def _dicts(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, list):
        yield from (v for v in value if isinstance(v, dict))


def _id(value: Any) -> str | None:
    """The id of a {"id": ...} object. Meta sends strings; numbers are taken too."""
    raw = value.get("id") if isinstance(value, dict) else None
    if isinstance(raw, int) and not isinstance(raw, bool):
        raw = str(raw)
    return raw if isinstance(raw, str) and 0 < len(raw) <= 128 else None


def message_events(payload: Any, account_id: str = "") -> list[Incoming]:
    """The DMs in a verified webhook body. Both shapes Meta uses are read:
    entry[].messaging[] and entry[].changes[] with field "messages". Skipped:
    echoes, deleted, unsupported and self messages, events without a message
    (reactions, reads, postbacks, edits), our own account's messages, and, with
    INSTAGRAM_ACCOUNT_ID set, anything for another account."""
    if not isinstance(payload, dict) or payload.get("object") != "instagram":
        return []
    out = []
    for entry in _dicts(payload.get("entry")):
        entry_id = _id(entry)
        items = list(_dicts(entry.get("messaging")))
        items += [c["value"] for c in _dicts(entry.get("changes"))
                  if c.get("field") == "messages" and isinstance(c.get("value"), dict)]
        for item in items:
            if (msg := _incoming(item, entry_id, account_id)) is not None:
                out.append(msg)
    return out


def _incoming(item: dict[str, Any], entry_id: str | None, account_id: str) -> Incoming | None:
    message = item.get("message")
    if not isinstance(message, dict) or any(message.get(f) for f in _SKIP_FLAGS):
        return None
    sender, recipient = _id(item.get("sender")), _id(item.get("recipient"))
    mid = message.get("mid")
    if sender is None or not isinstance(mid, str) or not 0 < len(mid) <= 1024:
        return None
    if sender == entry_id:  # sent by the account itself
        return None
    if account_id:
        ours = {i for i in (entry_id, recipient) if i}
        if ours != {account_id} or sender == account_id:
            return None
    text = message.get("text")
    return Incoming(sender=sender, mid=mid,
                    text=clean_text(text) if isinstance(text, str) else "",
                    attachments=tuple(_dicts(message.get("attachments"))))


def _strings(value: Any, depth: int = 0) -> Iterator[str]:
    """Every string in an attachment payload (Meta documents only `url`)."""
    if isinstance(value, str):
        yield value
    elif depth < 4 and isinstance(value, dict):
        for v in value.values():
            yield from _strings(v, depth + 1)
    elif depth < 4 and isinstance(value, list):
        for v in value:
            yield from _strings(v, depth + 1)


def find_link(msg: Incoming) -> tuple[str | None, bool]:
    """The first reel/post/share link in the attachments' payloads, then in the
    text, as (canonical url, False). (None, True) when the message holds only
    other Instagram links (a profile, a story); (None, False) when none at all."""
    other = False
    candidates = [s for a in msg.attachments for s in _strings(a.get("payload"))]
    for text in [*candidates, msg.text]:
        url = normalize_shared_text(text)
        if url is None:
            continue
        if is_saveable_link(url):
            return url, False
        other = True
    return None, other


def _attachment_shape(attachments: tuple[dict[str, Any], ...]) -> str:
    """Attachment types and payload keys only: never a value (URLs are signed)."""
    parts = []
    for a in attachments[:10]:
        kind, payload = a.get("type"), a.get("payload")
        keys = sorted(str(k)[:40] for k in payload) if isinstance(payload, dict) else []
        parts.append(f"{kind[:40] if isinstance(kind, str) else '?'}[{','.join(keys[:20])}]")
    return " ".join(parts)


# ----------------------------------------------------------------- handling --

_RECORD_MID_SQL = """
insert into public.instagram_messages (mid) values ($1)
on conflict (mid) do nothing
returning mid
"""

# The same embed job PATCH /saves/{id} queues (routers/saves.py set_note).
_EMBED_JOB_SQL = """
insert into public.jobs (kind, payload, stage)
select 'embed', jsonb_build_object('reel_id', $1::uuid), 'embed'
where not exists (
  select 1 from public.jobs
  where kind = 'embed' and payload->>'reel_id' = $1::text
    and locked_at is null)
"""


async def prune_messages(db: asyncpg.Pool) -> None:
    """Message ids older than 7 days (Meta stops redelivering after 36 h)."""
    await db.execute(
        "delete from public.instagram_messages where received_at < now() - interval '7 days'")


async def handle_message(db: asyncpg.Pool, msg: Incoming) -> str | None:
    """Act on one DM and return the reply to send, or None for no reply. A message
    id already seen (a redelivery) does nothing."""
    if await db.fetchval(_RECORD_MID_SQL, msg.mid) is None:
        return None
    if (code := find_code(msg.text)) is not None:
        return await _link(db, msg.sender, code)
    user_id = await db.fetchval(
        "select auth_user_id from public.instagram_links where ig_user_id = $1", msg.sender)
    if user_id is None:
        return CONNECT_FIRST if _connect_prompt_due(msg.sender) else None
    url, other_link = find_link(msg)
    if url is not None:
        return await _save(db, msg.sender, user_id, url)
    if other_link:
        return NOT_A_REEL
    if msg.attachments:
        # WARNING, not INFO: the API never enables INFO logs, and this line is how the
        # founder learns what Meta sends for a shared reel (docs/instagram-dm-setup.md).
        log.warning("instagram DM without a reel link; attachments: %s",
                    _attachment_shape(msg.attachments))
        return ASK_FOR_LINK
    note = msg.text.strip()[:NOTE_MAX_CHARS].strip()
    if note and await _add_note(db, msg.sender, note):
        return NOTE_ADDED
    return NO_REEL


async def _link(db: asyncpg.Pool, sender: str, code: str) -> str:
    """Use a code: link this sender to the code's user, replacing any earlier link
    of either. A code works once; an expired one is deleted and refused."""
    async with db.acquire() as con, con.transaction():
        row = await con.fetchrow(
            "delete from public.instagram_link_codes where code = $1 "
            "returning auth_user_id, expires_at > now() as live", code)
        if row is None or not row["live"]:
            return CODE_FAILED
        await con.execute(
            "delete from public.instagram_links where ig_user_id = $1 or auth_user_id = $2",
            sender, row["auth_user_id"])
        await con.execute(
            "insert into public.instagram_links (ig_user_id, auth_user_id) values ($1, $2)",
            sender, row["auth_user_id"])
    return CONNECTED


async def _save(db: asyncpg.Pool, sender: str, user_id: uuid.UUID, url: str) -> str:
    """save_reel() as POST /saves calls it, with channel meta_dm."""
    try:
        row = await db.fetchrow(
            "select s.reel_id, s.deduped from public.save_reel($1, $2, 'meta_dm', $2, $3) s",
            user_id, url, settings().rate_limit_per_hour)
    except asyncpg.PostgresError as exc:
        mapped = jobs.map_rpc_error(exc)
        if isinstance(mapped, jobs.QuotaExceeded):
            return QUOTA_REACHED
        if isinstance(mapped, jobs.RateLimited):
            return TOO_MANY
        if isinstance(mapped, jobs.BadUrl):
            return NOT_A_REEL
        raise
    assert row is not None
    await db.execute(
        "update public.instagram_links set last_save_id = $2, last_save_at = now() "
        "where ig_user_id = $1", sender, row["reel_id"])
    return ALREADY_SAVED if row["deduped"] else SAVED


async def _add_note(db: asyncpg.Pool, sender: str, note: str) -> bool:
    """The note for the sender's last save, if it was made in the last
    NOTE_WINDOW_MINUTES and has no note yet. Same effect as PATCH /saves/{id}:
    an enriched or partial save gets an embed job."""
    async with db.acquire() as con, con.transaction():
        row = await con.fetchrow(
            f"""
            update public.reels r set note = $2
            from public.instagram_links l
            where l.ig_user_id = $1 and r.id = l.last_save_id
              and r.auth_user_id = l.auth_user_id and r.note is null
              and l.last_save_at > now() - interval '{NOTE_WINDOW_MINUTES} minutes'
            returning r.id, r.status
            """, sender, note)
        if row is None:
            return False
        if row["status"] in ("enriched", "partial"):
            await con.execute(_EMBED_JOB_SQL, row["id"])
    return True


# ------------------------------------------------------------------ replies --

def _client() -> httpx.AsyncClient:
    # A function so tests can swap in a client with a fake transport.
    return httpx.AsyncClient(timeout=REPLY_TIMEOUT_S)


def _fit(text: str) -> str:
    return text.encode()[:REPLY_MAX_BYTES].decode(errors="ignore")


def _graph_error(resp: httpx.Response) -> str:
    """Meta's error code and message, if the body has them (they never hold the token)."""
    try:
        err = resp.json().get("error") or {}
    except (ValueError, AttributeError):
        return ""
    if not isinstance(err, dict):
        return ""
    return (f" (code {err.get('code')}, subcode {err.get('error_subcode')}: "
            f"{str(err.get('message', ''))[:200]})")


async def send_reply(recipient: str, text: str) -> None:
    """Send one DM as Lately's Instagram account. Runs after the webhook has
    answered (a background task), so it never raises: a failure is logged and the
    reply dropped."""
    s = settings()
    # Unified login: POST /{ig-user-id}/messages (with a system-user token /me is the system
    # user, not the Instagram account). No account id set: /me, the old Instagram Login path.
    account = s.instagram_account_id.strip() or "me"
    url = f"{s.instagram_graph_base_url.rstrip('/')}/{account}/messages"
    body = {"recipient": {"id": recipient}, "message": {"text": _fit(text)}}
    try:
        async with _client() as client:
            resp = await client.post(
                url, json=body, headers={"Authorization": f"Bearer {s.instagram_access_token}"})
    except Exception as exc:  # noqa: BLE001 — logged by type only, never the request
        log.warning("instagram reply not sent: %s", type(exc).__name__)
        return
    if resp.is_error:
        log.warning("instagram reply not sent: HTTP %s%s", resp.status_code, _graph_error(resp))
