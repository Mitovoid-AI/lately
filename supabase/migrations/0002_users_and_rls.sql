-- Lately — 0002: real users (Telegram-based) + lock down RLS
--
-- Context: Phase 1 had a single hardcoded dev user and permissive RLS policies
-- (`using (true)`), which was fine for one person on a laptop and unsafe for
-- anyone else. This migration introduces real per-user rows keyed by Telegram
-- id, and closes the anon hole.
--
-- Auth model: we authenticate with the Telegram Login Widget, NOT Supabase
-- Auth, so `auth.uid()` is unavailable. Therefore all database access happens
-- server-side using the service_role key, and RLS denies the anon/authenticated
-- roles entirely. The service_role bypasses RLS by design.
-- ⚠️ This means the service_role key MUST stay server-side only — never ship it
-- to a browser or a mobile app bundle.

-- users: one row per Telegram account that talks to the bot or logs into the web.
create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  telegram_id bigint unique not null,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists users_telegram_idx on public.users (telegram_id);

-- Carry over the Phase 1 dev user so existing local rows keep working.
insert into public.users (id, telegram_id, username, first_name)
values ('00000000-0000-0000-0000-000000000001', 0, 'devuser', 'Dev')
on conflict (id) do nothing;

-- Point reels/categories at users. Rows whose user_id has no matching user are
-- reassigned to the dev user so the FK can be added without data loss.
update public.reels r
set user_id = '00000000-0000-0000-0000-000000000001'
where not exists (select 1 from public.users u where u.id = r.user_id);

update public.categories c
set user_id = '00000000-0000-0000-0000-000000000001'
where not exists (select 1 from public.users u where u.id = c.user_id);

alter table public.reels
  drop constraint if exists reels_user_id_fkey,
  add constraint reels_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;

alter table public.categories
  drop constraint if exists categories_user_id_fkey,
  add constraint categories_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;

-- Where the save came from, so the web UI can show it and we can debug ingest.
alter table public.reels
  add column if not exists source_channel text not null default 'app'
    check (source_channel in ('app', 'telegram', 'web'));

-- Web sessions: opaque token → user. Kept in Postgres so the bot and web agree
-- on identity without a shared in-memory store.
create table if not exists public.sessions (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sessions_user_idx on public.sessions (user_id);

-- login_codes: short-lived codes the bot hands out for website login.
-- Chosen over the Telegram Login Widget because that widget requires a real
-- registered domain and does not work against localhost — a code you receive in
-- a DM and paste into the site works locally with no tunnel or domain.
create table if not exists public.login_codes (
  code text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists login_codes_user_idx on public.login_codes (user_id);

-- RLS -----------------------------------------------------------------------
-- Replace the Phase 1 permissive policies with nothing: no policy means no
-- access for anon/authenticated. All legitimate access is server-side via
-- service_role, which bypasses RLS.
drop policy if exists "own reels" on public.reels;
drop policy if exists "own categories" on public.categories;
drop policy if exists "own notes" on public.notes;
drop policy if exists "own profile" on public.profiles;

alter table public.users       enable row level security;
alter table public.sessions    enable row level security;
alter table public.login_codes enable row level security;

-- Belt and braces: revoke direct table grants from the public-facing roles.
revoke all on public.reels, public.categories, public.notes,
              public.profiles, public.users, public.sessions,
              public.login_codes
  from anon, authenticated;
