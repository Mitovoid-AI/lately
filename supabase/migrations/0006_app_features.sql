-- Lately — 0006: app features (stacks, reading preferences)
--
-- Stacks are user-made collections of saves (frontend/src/api/contract.ts
-- Stack / StackDetail). Preferences hold the reader settings the app syncs
-- (contract Preferences; defaults = DEFAULT_PREFERENCES).
--
-- Every read and write goes through the API's own database connection, so RLS
-- is enabled with no policies and the client roles get no grants: anon and
-- authenticated cannot touch these tables directly.
--
-- Idempotent: safe to run multiple times.

-- ============================================================
-- 1. stacks + membership
-- ============================================================
create table if not exists public.stacks (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists stacks_user_updated_idx
  on public.stacks (auth_user_id, updated_at desc);

create table if not exists public.stack_saves (
  stack_id  uuid not null references public.stacks(id) on delete cascade,
  reel_id   uuid not null references public.reels(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (stack_id, reel_id)
);

create index if not exists stack_saves_reel_idx on public.stack_saves (reel_id);
create index if not exists stack_saves_stack_added_idx
  on public.stack_saves (stack_id, added_at desc);

-- A stack's updated_at is its last change: adding or removing a save (including
-- a save deleted from the library, via the cascade) bumps it.
create or replace function public.touch_stack()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.stacks set updated_at = now()
  where id = coalesce(new.stack_id, old.stack_id);
  return null;
end;
$$;

drop trigger if exists stack_saves_touch on public.stack_saves;
create trigger stack_saves_touch
  after insert or delete on public.stack_saves
  for each row execute function public.touch_stack();

-- ============================================================
-- 2. preferences — one row per user, created on first PATCH
-- ============================================================
create table if not exists public.preferences (
  auth_user_id     uuid primary key references auth.users(id) on delete cascade,
  reading_font     text not null default 'newsreader'
                     check (reading_font in ('newsreader', 'inter', 'lora')),
  text_size        int not null default 16 check (text_size in (14, 16, 18, 20)),
  theme            text not null default 'light'
                     check (theme in ('light', 'dark', 'system')),
  push_digests     boolean not null default true,
  offline_reading  boolean not null default true,
  updated_at       timestamptz not null default now()
);

-- ============================================================
-- 3. jobs lookup by reel (retry / embed dedup, account deletion)
-- ============================================================
create index if not exists jobs_reel_idx on public.jobs ((payload->>'reel_id'));

-- ============================================================
-- 4. RLS + grants: server-side only
-- ============================================================
alter table public.stacks      enable row level security;
alter table public.stack_saves enable row level security;
alter table public.preferences enable row level security;

revoke all on public.stacks, public.stack_saves, public.preferences from anon, authenticated;
revoke execute on function public.touch_stack() from public, anon, authenticated;
