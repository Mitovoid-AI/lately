"""Me router — the signed-in user's profile (BACKEND.md §5, GET /me).

Sign-up and sign-in happen in Supabase Auth (Google OAuth, email OTP / magic
link); migration 0005 writes the profile row when the account is created. This
route reads it back with the quota state the app shows. Identity is the JWT
`sub` only.
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException

from ..deps import CurrentUser, pool
from ..models import ConnectedAccount, MeOut

router = APIRouter(prefix="/me", tags=["me"])

# Quota window matches save_reel(): the calendar month, in the database's clock.
_ME_SQL = """
select p.id, p.email, p.full_name, p.handle, p.avatar_url, p.plan,
       p.saves_free_limit, p.created_at::date as member_since,
       (select count(*) from public.reels r where r.auth_user_id = p.id) as total_saves,
       (select count(*) from public.reels r
         where r.auth_user_id = p.id
           and r.created_at >= date_trunc('month', now())) as saves_this_month,
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
        saves_this_month=row["saves_this_month"],
        saves_limit=row["saves_free_limit"],
        resets_on=row["resets_on"],
        total_saves=row["total_saves"],
        stacks_count=0,  # stacks are not in the backend yet
        member_since=row["member_since"],
        connected_accounts=accounts,
    )
