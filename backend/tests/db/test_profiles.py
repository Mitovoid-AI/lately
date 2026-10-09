"""Migration 0005: every Supabase Auth user gets a profile, kept in sync by triggers."""

import json

import pytest

pytestmark = pytest.mark.db


async def profile(db, uid):
    return await db.fetchrow("select * from public.profiles where id = $1", uid)


async def test_sign_up_creates_a_profile_from_the_auth_user(db, make_auth_user):
    uid = await make_auth_user(
        "ash.roy",
        meta={"full_name": "Ash Roy", "avatar_url": "https://lh3.example/a.png"},
        provider="google",
    )
    p = await profile(db, uid)
    assert p is not None
    assert p["email"].startswith("ash.roy@")
    assert p["full_name"] == "Ash Roy"
    assert p["avatar_url"] == "https://lh3.example/a.png"
    assert p["provider"] == "google"
    assert p["handle"] == "ash.roy"
    assert p["plan"] == "free" and p["saves_free_limit"] == 20


async def test_email_sign_up_without_a_name_still_gets_a_handle(db, make_auth_user):
    uid = await make_auth_user("Reader+Inbox")
    p = await profile(db, uid)
    assert p["full_name"] is None
    assert p["handle"] == "readerinbox"


async def test_handles_are_unique(db, make_auth_user):
    # Distinct emails that reduce to the same handle.
    a = await make_auth_user("dup")
    b = await make_auth_user("DUP")
    ha, hb = (await profile(db, a))["handle"], (await profile(db, b))["handle"]
    assert ha == "dup" and hb != ha and hb.startswith("dup")


async def test_auth_updates_flow_into_the_profile(db, make_auth_user):
    uid = await make_auth_user("updater")
    await db.execute(
        "update auth.users set raw_user_meta_data = $2::jsonb, last_sign_in_at = now() where id = $1",
        uid,
        json.dumps({"name": "Up Dater", "picture": "https://lh3.example/b.png"}),
    )
    p = await profile(db, uid)
    assert p["full_name"] == "Up Dater"
    assert p["avatar_url"] == "https://lh3.example/b.png"
    assert p["last_sign_in_at"] is not None


async def test_sync_profile_recreates_a_missing_profile(db, make_auth_user):
    uid = await make_auth_user("healer")
    await db.execute("delete from public.profiles where id = $1", uid)
    await db.execute("select public.sync_profile($1)", uid)
    assert (await profile(db, uid))["handle"] == "healer"


async def test_deleting_the_auth_user_deletes_the_profile(db, make_auth_user):
    uid = await make_auth_user("leaver")
    await db.execute("delete from auth.users where id = $1", uid)
    assert await profile(db, uid) is None
