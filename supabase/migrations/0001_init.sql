-- Lately — initial schema (PLAN.md §3)
-- Four tables. RLS enabled from the first migration so no authenticated user
-- can ever read another user's saves.

create extension if not exists "uuid-ossp";

-- profiles: plan, quota, counters. Keyed to auth.users in Phase 3; in Phase 1
-- a single seeded row owns everything.
create table if not exists public.profiles (
  id uuid primary key,
  plan text not null default 'free' check (plan in ('free', 'pro', 'lifetime')),
  saves_this_month integer not null default 0,
  quota_reset_at timestamptz
);

-- categories: user-editable, seeded with defaults from the founder's own behaviour.
create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  name text not null,
  emoji text,
  sort_order integer not null default 0
);

-- reels: the core object. Capture writes status='pending'; enrichment fills the rest.
create table if not exists public.reels (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  source_url text not null,
  shortcode text,
  status text not null default 'pending' check (status in ('pending', 'enriched', 'partial')),
  reason text,                       -- the one-line "why I saved this"
  caption text,
  transcript text,
  title text,
  summary text,
  steps jsonb,
  category text,
  tags text[],
  entities jsonb,
  thumbnail_path text,
  created_at timestamptz not null default now(),
  enriched_at timestamptz,
  failure_reason text,
  -- Full-text search over the fields worth remembering (Phase 1 search).
  search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(reason, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(caption, '') || ' ' ||
      coalesce(transcript, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(array_to_string(tags, ' '), '')
    )
  ) stored
);

create index if not exists reels_user_created_idx
  on public.reels (user_id, created_at desc);
create index if not exists reels_search_idx
  on public.reels using gin (search_vector);

-- notes: the user's own thoughts, kept separate from AI output.
create table if not exists public.notes (
  id uuid primary key default uuid_generate_v4(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- Row Level Security ---------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.categories enable row level security;
alter table public.reels      enable row level security;
alter table public.notes      enable row level security;

-- Phase 3 will scope these to auth.uid(). For Phase 1 (single seeded user with
-- the anon key) we grant the anon role access to its own rows by user_id.
--
-- ⚠️ SECURITY: These policies are intentionally permissive for single-user local
-- dev ONLY. Before onboarding ANY real user, replace `using (true)` with
-- `using (auth.uid() = user_id)` — otherwise every authenticated user can read
-- and modify everyone else's saves.
drop policy if exists "own reels" on public.reels;
drop policy if exists "own categories" on public.categories;
drop policy if exists "own notes" on public.notes;
drop policy if exists "own profile" on public.profiles;

create policy "own reels" on public.reels
  for all using (true) with check (true);
create policy "own categories" on public.categories
  for all using (true) with check (true);
create policy "own notes" on public.notes
  for all using (true) with check (true);
create policy "own profile" on public.profiles
  for all using (true) with check (true);
