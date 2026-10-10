-- 0008 — Data exports (POST /me/export → worker `export` job → GET /me/export).
-- One row per finished export; the worker keeps only the newest per user.

create table if not exists public.exports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  data       jsonb not null
);
create index if not exists exports_user_created_idx on public.exports (user_id, created_at desc);

-- Server-side only, like every other table: the API reads it with its own role.
alter table public.exports enable row level security;
revoke all on public.exports from anon, authenticated;
