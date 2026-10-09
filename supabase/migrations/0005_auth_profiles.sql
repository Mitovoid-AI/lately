-- Lately — 0005: user profiles from Supabase Auth
-- (0004 is reserved for the Phase 1 search migration, docs/superpowers/plans/2026-10-03-phase1-search-v1.md.)
--
-- Sign-up is Supabase Auth (Google OAuth, email OTP / magic link). Every auth
-- user gets a public.profiles row the moment the account is created, carrying
-- what the app shows: name, handle, avatar, email and the sign-in provider.
-- A second trigger keeps it in step when Auth updates the user (a new Google
-- avatar, an email change, each sign-in). Neither trigger can block a sign-in:
-- failures are logged, and GET /me rebuilds a missing row via sync_profile().
--
-- Idempotent: safe to run multiple times.

-- ============================================================
-- 1. profile columns
-- ============================================================
alter table public.profiles
  add column if not exists email           text,
  add column if not exists full_name       text,
  add column if not exists handle          text,
  add column if not exists avatar_url      text,
  add column if not exists provider        text,
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists created_at      timestamptz not null default now(),
  add column if not exists updated_at      timestamptz not null default now();

-- Handles are unique regardless of case.
create unique index if not exists profiles_handle_key on public.profiles (lower(handle));

-- 0001 created profiles before auth.users was the identity source, so the
-- table has no foreign key. Drop rows for users that no longer exist, then link.
delete from public.profiles p
where not exists (select 1 from auth.users u where u.id = p.id);

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

-- ============================================================
-- 2. handle: email local part → "ash.roy", made unique with a 4-digit suffix
-- ============================================================
create or replace function public.make_handle(p_email text, p_name text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_base text;
  v_try  text;
  i      int := 0;
begin
  v_base := lower(coalesce(nullif(split_part(coalesce(p_email, ''), '@', 1), ''), p_name, ''));
  v_base := left(regexp_replace(v_base, '[^a-z0-9._]', '', 'g'), 24);
  if length(v_base) < 2 then
    v_base := 'reader';
  end if;

  v_try := v_base;
  while exists (select 1 from public.profiles p where lower(p.handle) = v_try) loop
    i := i + 1;
    v_try := v_base || (1000 + floor(random() * 9000))::int::text;
    if i > 20 then
      v_try := v_base || left(replace(gen_random_uuid()::text, '-', ''), 8);
    end if;
  end loop;
  return v_try;
end;
$$;

-- ============================================================
-- 3. sync_profile: upsert one user's profile from auth.users
-- ============================================================
create or replace function public.sync_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u        record;
  v_meta   jsonb;
  v_name   text;
  v_avatar text;
begin
  select id, email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at
    into u
  from auth.users
  where id = p_user_id;
  if not found then
    return;
  end if;

  v_meta   := coalesce(u.raw_user_meta_data, '{}'::jsonb);
  v_name   := nullif(btrim(coalesce(v_meta->>'full_name', v_meta->>'name', '')), '');
  v_avatar := nullif(btrim(coalesce(v_meta->>'avatar_url', v_meta->>'picture', '')), '');

  insert into public.profiles as p
    (id, email, full_name, avatar_url, provider, last_sign_in_at)
  values
    (u.id, u.email, v_name, v_avatar, u.raw_app_meta_data->>'provider', u.last_sign_in_at)
  on conflict (id) do update set
    email           = coalesce(excluded.email, p.email),
    -- The provider's name and photo fill in what the profile lacks and follow
    -- later changes (a new Google photo); the first provider is kept.
    full_name       = coalesce(excluded.full_name, p.full_name),
    avatar_url      = coalesce(excluded.avatar_url, p.avatar_url),
    provider        = coalesce(p.provider, excluded.provider),
    last_sign_in_at = coalesce(excluded.last_sign_in_at, p.last_sign_in_at),
    updated_at      = now();

  -- A handle is chosen once. Two sign-ups racing for the same one: retry.
  for attempt in 1..5 loop
    begin
      update public.profiles p
      set handle = public.make_handle(u.email, v_name)
      where p.id = u.id and p.handle is null;
      exit;
    exception when unique_violation then
      if attempt = 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

-- ============================================================
-- 4. triggers on auth.users
-- ============================================================
create or replace function public.on_auth_user_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.sync_profile(new.id);
  exception when others then
    -- Never block a sign-up or sign-in over the profile; GET /me rebuilds it.
    raise warning 'sync_profile(%) failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.on_auth_user_changed();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at on auth.users
  for each row execute function public.on_auth_user_changed();

-- These run server-side only (triggers and the API's service connection);
-- PostgREST must not expose them to app clients.
revoke execute on function public.make_handle(text, text)  from public, anon, authenticated;
revoke execute on function public.sync_profile(uuid)       from public, anon, authenticated;
revoke execute on function public.on_auth_user_changed()   from public, anon, authenticated;

-- ============================================================
-- 5. backfill: everyone who signed up before this migration
-- ============================================================
select public.sync_profile(u.id) from auth.users u;
