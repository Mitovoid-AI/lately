"""Stacks router — user-made collections of saves (contract Stack / StackDetail).

A stack's `category` is the most common category among its saves (ties go to
the alphabetically first; null when none has one), `cover_urls` are up to four
thumbnails of the most recently added saves, and `updated_at` is the last
membership change (bumped by a trigger, migration 0006).
"""

from __future__ import annotations

import uuid

import asyncpg
from fastapi import APIRouter, HTTPException, Response

from ..deps import CurrentUser, pool
from ..models import StackAdd, StackCreate, StackDetailOut, StackOut, api_error
from ..services.saves_view import CATEGORIES, fetch_saves, thumbnail_url

router = APIRouter(prefix="/stacks", tags=["stacks"])

_STACKS_SQL = """
select s.id, s.name, s.updated_at,
  (select count(*) from public.stack_saves ss where ss.stack_id = s.id) as save_count,
  (select rc.category
     from public.stack_saves ss
     join public.reels r on r.id = ss.reel_id
     join public.reel_content rc on rc.shortcode = r.shortcode_key
    where ss.stack_id = s.id and rc.category = any($2::text[])
    group by rc.category
    order by count(*) desc, rc.category
    limit 1) as category,
  array(select coalesce(rc.thumbnail_path, r.thumbnail_path)
          from public.stack_saves ss
          join public.reels r on r.id = ss.reel_id
          left join public.reel_content rc on rc.shortcode = r.shortcode_key
         where ss.stack_id = s.id
           and coalesce(rc.thumbnail_path, r.thumbnail_path) is not null
         order by ss.added_at desc, r.created_at desc
         limit 4) as covers
from public.stacks s
where s.auth_user_id = $1 and ($3::uuid is null or s.id = $3)
order by s.updated_at desc, s.created_at desc
"""


def _not_found(what: str = "Stack") -> HTTPException:
    return api_error(404, "NOT_FOUND", f"{what} not found.")


def _to_stack(row: asyncpg.Record) -> StackOut:
    return StackOut(
        id=row["id"], name=row["name"], category=row["category"],
        save_count=row["save_count"], updated_at=row["updated_at"],
        cover_urls=[u for u in (thumbnail_url(p) for p in row["covers"]) if u])


async def _stacks(db: asyncpg.Pool | asyncpg.Connection, user_id: uuid.UUID,
                  stack_id: uuid.UUID | None = None) -> list[StackOut]:
    rows = await db.fetch(_STACKS_SQL, user_id, list(CATEGORIES), stack_id)
    return [_to_stack(r) for r in rows]


async def _own_stack(db: asyncpg.Pool | asyncpg.Connection, user_id: uuid.UUID,
                     stack_id: uuid.UUID) -> None:
    if not await db.fetchval(
            "select exists (select 1 from public.stacks where id = $1 and auth_user_id = $2)",
            stack_id, user_id):
        raise _not_found()


@router.get("", response_model=list[StackOut])
async def list_stacks(user: CurrentUser) -> list[StackOut]:
    return await _stacks(pool(), uuid.UUID(user.id))


@router.post("", response_model=StackOut, status_code=201)
async def create_stack(body: StackCreate, user: CurrentUser) -> StackOut:
    uid = uuid.UUID(user.id)
    db = pool()
    try:
        sid = await db.fetchval(
            "insert into public.stacks (auth_user_id, name) values ($1, $2) returning id",
            uid, body.name)
    except asyncpg.ForeignKeyViolationError as exc:  # the account was deleted
        raise api_error(404, "NOT_FOUND", "Account not found.") from exc
    (stack,) = await _stacks(db, uid, sid)
    return stack


@router.get("/{stack_id}", response_model=StackDetailOut)
async def get_stack(stack_id: uuid.UUID, user: CurrentUser) -> StackDetailOut:
    uid = uuid.UUID(user.id)
    db = pool()
    found = await _stacks(db, uid, stack_id)
    if not found:
        raise _not_found()
    ids = [r["reel_id"] for r in await db.fetch(
        """select ss.reel_id from public.stack_saves ss
           join public.reels r on r.id = ss.reel_id
           where ss.stack_id = $1
           order by ss.added_at desc, r.created_at desc""", stack_id)]
    return StackDetailOut(**found[0].model_dump(), saves=await fetch_saves(db, uid, ids))


@router.post("/{stack_id}/saves", status_code=204)
async def add_to_stack(stack_id: uuid.UUID, body: StackAdd, user: CurrentUser) -> Response:
    """Idempotent: adding a save that is already in the stack changes nothing."""
    uid = uuid.UUID(user.id)
    async with pool().acquire() as con, con.transaction():
        await _own_stack(con, uid, stack_id)
        if not await con.fetchval(
                "select exists (select 1 from public.reels where id = $1 and auth_user_id = $2)",
                body.save_id, uid):
            raise _not_found("Save")
        await con.execute(
            "insert into public.stack_saves (stack_id, reel_id) values ($1, $2) "
            "on conflict do nothing", stack_id, body.save_id)
    return Response(status_code=204)


@router.delete("/{stack_id}/saves/{save_id}", status_code=204)
async def remove_from_stack(stack_id: uuid.UUID, save_id: uuid.UUID,
                            user: CurrentUser) -> Response:
    """Idempotent: removing a save that is not in the stack is still a 204."""
    async with pool().acquire() as con, con.transaction():
        await _own_stack(con, uuid.UUID(user.id), stack_id)
        await con.execute(
            "delete from public.stack_saves where stack_id = $1 and reel_id = $2",
            stack_id, save_id)
    return Response(status_code=204)


@router.delete("/{stack_id}", status_code=204)
async def delete_stack(stack_id: uuid.UUID, user: CurrentUser) -> Response:
    """Deletes the stack only; its saves stay in the library."""
    deleted = await pool().fetchval(
        "delete from public.stacks where id = $1 and auth_user_id = $2 returning id",
        stack_id, uuid.UUID(user.id))
    if deleted is None:
        raise _not_found()
    return Response(status_code=204)
