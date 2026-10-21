"""Me router — the signed-in user's profile (BACKEND.md §5, GET /me).

Sign-up and sign-in happen in Supabase Auth (Google OAuth, email OTP / magic
link); migration 0005 writes the profile row when the account is created. This
route reads it back with the quota state the app shows. Identity is the JWT
`sub` only.
"""

from __future__ import annotations

import json
import uuid

import asyncpg
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse

from ..deps import CurrentUser, pool
from ..models import ConnectedAccount, MeOut, PreferencesOut, PreferencesPatch, api_error
from ..services.billing import EFFECTIVE_EXPIRY_SQL, EFFECTIVE_PLAN_SQL

router = APIRouter(prefix="/me", tags=["me"])

# Quota window matches save_reel(): the calendar month, in the database's clock.
# `plan` is the effective plan (an expired pro reads as free, as save_reel() sees it).
_ME_SQL = f"""
select p.id, p.email, p.full_name, p.handle, p.avatar_url,
       {EFFECTIVE_PLAN_SQL} as plan, {EFFECTIVE_EXPIRY_SQL} as plan_expires_at,
       p.saves_free_limit, p.created_at::date as member_since,
       (select count(*) from public.reels r where r.auth_user_id = p.id) as total_saves,
       (select count(*) from public.stacks s where s.auth_user_id = p.id) as stacks_count,
       (select count(*) from public.save_events e
         where e.auth_user_id = p.id
           and e.created_at >= date_trunc('month', now())) as saves_this_month,
       (date_trunc('month', now()) + interval '1 month')::date as resets_on,
       coalesce((select jsonb_agg(jsonb_build_object(
                   'provider', i.provider,
                   'email', i.identity_data->>'email')
                   order by i.created_at)
                 from auth.identities i where i.user_id = p.id), '[]'::jsonb) as identities
from public.profiles p
where p.id = $1
"""

# Sign-in methods the app can show; anything else is left out.
_SHOWN_PROVIDERS = {"google", "email", "instagram"}


@router.get("", response_model=MeOut)
async def get_me(user: CurrentUser) -> MeOut:
    uid = uuid.UUID(user.id)
    async with pool().acquire() as con:
        row = await con.fetchrow(_ME_SQL, uid)
        if row is None:
            # The sign-up trigger never fails a sign-in; if the row is missing, build it now.
            await con.execute("select public.sync_profile($1)", uid)
            row = await con.fetchrow(_ME_SQL, uid)
    if row is None:
        raise HTTPException(404, {"error": {"code": "NOT_FOUND", "message": "Account not found."}})

    accounts = [
        ConnectedAccount(
            provider=i["provider"],
            label=i.get("email") or row["email"] or "",
            status="active" if i["provider"] == "instagram" else "secured",
        )
        for i in json.loads(row["identities"])
        if i.get("provider") in _SHOWN_PROVIDERS
    ]
    return MeOut(
        id=row["id"],
        email=row["email"] or "",
        name=row["full_name"] or row["handle"] or "",
        handle=row["handle"] or "",
        avatar_url=row["avatar_url"],
        plan=row["plan"],
        plan_expires_at=row["plan_expires_at"],
        saves_this_month=row["saves_this_month"],
        saves_limit=row["saves_free_limit"],
        resets_on=row["resets_on"],
        total_saves=row["total_saves"],
        stacks_count=row["stacks_count"],
        member_since=row["member_since"],
        connected_accounts=accounts,
    )


# ---------------------------------------------------------------- preferences

_PREF_COLUMNS = tuple(PreferencesOut.model_fields)


async def _preferences(db: asyncpg.Pool | asyncpg.Connection, uid: uuid.UUID) -> PreferencesOut:
    row = await db.fetchrow(
        f"select {', '.join(_PREF_COLUMNS)} from public.preferences where auth_user_id = $1", uid)
    return PreferencesOut(**dict(row)) if row else PreferencesOut()


@router.get("/preferences", response_model=PreferencesOut)
async def get_preferences(user: CurrentUser) -> PreferencesOut:
    return await _preferences(pool(), uuid.UUID(user.id))


@router.patch("/preferences", response_model=PreferencesOut)
async def update_preferences(body: PreferencesPatch, user: CurrentUser) -> PreferencesOut:
    """Partial update: only the fields sent change; the rest keep their value
    (or the contract default when the user never set them)."""
    uid = uuid.UUID(user.id)
    changes = body.model_dump(exclude_unset=True)
    db = pool()
    if not changes:
        return await _preferences(db, uid)
    cols = [c for c in _PREF_COLUMNS if c in changes]  # whitelisted names only
    placeholders = ", ".join(f"${i}" for i in range(2, len(cols) + 2))
    updates = ", ".join(f"{c} = excluded.{c}" for c in cols)
    try:
        row = await db.fetchrow(
            f"""insert into public.preferences (auth_user_id, {', '.join(cols)})
                values ($1, {placeholders})
                on conflict (auth_user_id) do update set {updates}, updated_at = now()
                returning {', '.join(_PREF_COLUMNS)}""",
            uid, *(changes[c] for c in cols))
    except asyncpg.ForeignKeyViolationError as exc:  # the account was deleted
        raise api_error(404, "NOT_FOUND", "Account not found.") from exc
    return PreferencesOut(**dict(row))


# --------------------------------------------------------------------- export

@router.post("/export", status_code=202)
async def request_export(user: CurrentUser) -> dict[str, str]:
    """Queue a data export (the worker side builds and delivers it). One queued
    export per user at a time; asking again while it waits is a no-op."""
    await pool().execute(
        """
        insert into public.jobs (kind, payload, stage)
        select 'export', jsonb_build_object('user_id', $1::uuid), 'export'
        where not exists (
          select 1 from public.jobs
          where kind = 'export' and payload->>'user_id' = $1::text and locked_at is null)
        """,
        uuid.UUID(user.id))
    return {"status": "queued"}


# ------------------------------------------------------------- delete account

@router.delete("", status_code=204)
async def delete_me(user: CurrentUser) -> Response:
    """Delete the account and everything that belongs to it (Play Store in-app
    deletion). Removing the auth user cascades to profiles, reels (and their
    stack memberships), stacks and preferences; queued work and the user's
    billing events are dropped. Shared reel_content cards stay: they hold no
    user data. A Google Play subscription is not cancelled by this."""
    uid = uuid.UUID(user.id)
    async with pool().acquire() as con, con.transaction():
        if not await con.fetchval("select exists (select 1 from auth.users where id = $1)", uid):
            raise api_error(404, "NOT_FOUND", "Account not found.")
        for table in ("public.jobs", "public.jobs_dead"):
            await con.execute(
                f"""delete from {table}
                    where payload->>'user_id' = $1::uuid::text
                       or payload->>'reel_id' in (
                         select id::text from public.reels where auth_user_id = $1::uuid)""",
                uid)
        # Webhook deliveries name the user as app_user_id, or inside the payload
        # (original id, aliases; a TRANSFER only has transferred_from / transferred_to).
        await con.execute(
            """delete from public.billing_events
               where app_user_id = $1::text
                  or payload->'event'->>'original_app_user_id' = $1::text
                  or payload->'event'->'aliases' @> to_jsonb($1::text)
                  or payload->'event'->'transferred_from' @> to_jsonb($1::text)
                  or payload->'event'->'transferred_to' @> to_jsonb($1::text)""",
            str(uid))
        await con.execute("delete from auth.users where id = $1", uid)
    return Response(status_code=204)


@router.get("/export", response_model=None)
async def download_export(user: CurrentUser) -> Response | JSONResponse:
    """The newest finished export as a JSON download. 202 while one is still
    being built, 404 when none was ever requested."""
    uid = uuid.UUID(user.id)
    queued = await pool().fetchval(
        "select exists (select 1 from public.jobs where kind = 'export' "
        "and payload->>'user_id' = $1)", str(uid))
    if queued:
        return JSONResponse(status_code=202, content={"status": "queued"})
    row = await pool().fetchrow(
        "select data::text as data, created_at from public.exports "
        "where user_id = $1 order by created_at desc limit 1", uid)
    if row is None:
        raise api_error(404, "NOT_FOUND", "No export yet. Request one first.")
    name = f"lately-export-{row['created_at']:%Y%m%d}.json"
    return Response(content=row["data"], media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
