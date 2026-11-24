"""Instagram DM door (PIPELINE.md §2 Door 2, migration 0016, services/instagram.py).

GET  /webhooks/instagram   Meta's verification handshake: hub.mode "subscribe" and
    hub.verify_token == INSTAGRAM_VERIFY_TOKEN (403 otherwise); the answer is the
    hub.challenge value as plain text.
POST /webhooks/instagram   Meta -> backend, DMs sent to Lately's account. No user
    JWT: the body is trusted only when X-Hub-Signature-256 (HMAC-SHA256 of the raw
    body with INSTAGRAM_APP_SECRET) checks out, else 401. A correctly signed POST
    always gets 200, even when handling one of its messages failed (logged): Meta
    would only redeliver the same thing. Each message id is handled once; replies
    are sent after the answer.
GET    /me/instagram       the caller's link state, for the app.
POST   /me/instagram/code  a fresh link code (15 minutes), at most 10 an hour.
DELETE /me/instagram       unlink: removes the link and any code (204).

Until INSTAGRAM_APP_SECRET, INSTAGRAM_VERIFY_TOKEN, INSTAGRAM_ACCESS_TOKEN and
INSTAGRAM_HANDLE are all set the webhook and POST /me/instagram/code are 404 and
GET /me/instagram reports the feature off; DELETE works either way.

Never log the app secret, the tokens or message text.
"""

from __future__ import annotations

import hmac
import json
import logging
import uuid
from typing import Annotated

import asyncpg
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from fastapi.responses import PlainTextResponse

from ..config import settings
from ..deps import CurrentUser, pool
from ..models import InstagramLinkOut, api_error
from ..services import instagram

log = logging.getLogger(__name__)

router = APIRouter(tags=["instagram"])

_STATE_SQL = """
select l.linked_at, c.code, c.expires_at as code_expires_at
from (select $1::uuid as id) u
left join public.instagram_links l on l.auth_user_id = u.id
left join public.instagram_link_codes c on c.auth_user_id = u.id and c.expires_at > now()
"""

_NEW_CODE_SQL = f"""
insert into public.instagram_link_codes (code, auth_user_id, expires_at)
values ($1, $2, now() + interval '{instagram.CODE_TTL_MINUTES} minutes')
on conflict (auth_user_id) do update
  set code = excluded.code, expires_at = excluded.expires_at, created_at = now()
"""


def _not_found() -> HTTPException:
    return api_error(404, "NOT_FOUND", "Not found.")


# ------------------------------------------------------------------ webhook --

@router.get("/webhooks/instagram", response_class=PlainTextResponse)
async def verify_webhook(
    mode: Annotated[str, Query(alias="hub.mode")] = "",
    token: Annotated[str, Query(alias="hub.verify_token")] = "",
    challenge: Annotated[str, Query(alias="hub.challenge")] = "",
) -> PlainTextResponse:
    s = settings()
    if not s.instagram_enabled:
        raise _not_found()
    if mode != "subscribe" or not hmac.compare_digest(
            token.encode(), s.instagram_verify_token.encode()):
        raise api_error(403, "FORBIDDEN", "Webhook verification failed.")
    return PlainTextResponse(challenge)


@router.post("/webhooks/instagram")
async def receive_webhook(request: Request, background: BackgroundTasks) -> dict[str, str]:
    s = settings()
    if not s.instagram_enabled:
        raise _not_found()
    raw = await request.body()  # the signature covers these exact bytes
    if not instagram.verify_signature(
            s.instagram_app_secret, request.headers.get("x-hub-signature-256"), raw):
        raise api_error(401, "UNAUTHORIZED", "Invalid webhook signature.")
    try:
        payload = json.loads(raw)
    except ValueError:
        log.warning("instagram webhook: ignored a signed body that is not JSON")
        return {"status": "ignored"}

    db = pool()
    try:
        await instagram.prune_messages(db)
    except Exception:
        log.exception("instagram webhook: could not prune old message ids")
    for msg in instagram.message_events(payload, s.instagram_account_id.strip()):
        try:
            reply = await instagram.handle_message(db, msg)
        except Exception:
            log.exception("instagram webhook: a message could not be handled")
            continue
        if reply is not None:
            background.add_task(instagram.send_reply, msg.sender, reply)
    return {"status": "ok"}


# --------------------------------------------------------------------- app --

async def _state(db: asyncpg.Pool, uid: uuid.UUID) -> InstagramLinkOut:
    row = await db.fetchrow(_STATE_SQL, uid)
    assert row is not None
    return InstagramLinkOut(
        enabled=True, handle=settings().instagram_handle.strip().lstrip("@"),
        linked=row["linked_at"] is not None, linked_at=row["linked_at"],
        code=row["code"], code_expires_at=row["code_expires_at"])


@router.get("/me/instagram", response_model=InstagramLinkOut)
async def get_link(user: CurrentUser) -> InstagramLinkOut:
    if not settings().instagram_enabled:
        return InstagramLinkOut(enabled=False)
    return await _state(pool(), uuid.UUID(user.id))


@router.post("/me/instagram/code", response_model=InstagramLinkOut)
async def create_code(user: CurrentUser) -> InstagramLinkOut:
    """A new code replaces the user's earlier one. They DM it to Lately's account;
    the webhook links the sender to this user and deletes the code."""
    if not settings().instagram_enabled:
        raise api_error(404, "NOT_FOUND", "Saving from Instagram isn't available yet.")
    if not instagram.code_allowed(user.id):
        raise api_error(429, "RATE_LIMITED", "Too many codes in the last hour. Try again later.")
    uid = uuid.UUID(user.id)
    db = pool()
    for _ in range(5):
        try:
            await db.execute(_NEW_CODE_SQL, instagram.new_code(), uid)
            break
        except asyncpg.UniqueViolationError:  # the same code is another user's: draw again
            continue
        except asyncpg.ForeignKeyViolationError as exc:  # the account was deleted
            raise api_error(404, "NOT_FOUND", "Account not found.") from exc
    else:
        raise api_error(500, "SERVER", "Could not make a code right now. Try again.")
    return await _state(db, uid)


@router.delete("/me/instagram", status_code=204)
async def unlink(user: CurrentUser) -> Response:
    uid = uuid.UUID(user.id)
    async with pool().acquire() as con, con.transaction():
        await con.execute("delete from public.instagram_links where auth_user_id = $1", uid)
        await con.execute("delete from public.instagram_link_codes where auth_user_id = $1", uid)
    return Response(status_code=204)
