-- Lately — 0007: enrichment (Phase 2, workstream E)
--
-- 1. reel_content fetch columns: which provider produced the media, the reel
--    duration, and the provider's transient metadata (signed media URLs are
--    short-lived; the worker re-fetches them on a late retry).
-- 2. provider_budget + take_provider_token(): a Postgres token bucket per
--    external provider (Instagram fetch, LLM, Groq, embeddings, scraper) so N
--    workers share one rate limit. No budget → the worker reschedules the job
--    without consuming an attempt (app/worker/loop.py, Reschedule).
-- 3. jobs index for embed-job dedup.
--
-- Idempotent: safe to run multiple times.

-- ============================================================
-- 1. reel_content fetch columns
-- ============================================================
alter table public.reel_content
  add column if not exists fetch_source text,          -- embed_page | ytdlp | scraper | null (gave up)
  add column if not exists duration_s   real,
  add column if not exists fetch_meta   jsonb;

-- ============================================================
-- 2. provider budget
-- ============================================================
create table if not exists public.provider_budget (
  provider     text primary key,
  window_start timestamptz,              -- current one-minute window
  used         int not null default 0,   -- tokens taken in that window
  per_minute   int,                      -- null = no per-minute cap
  per_day      int,                      -- null = no daily cap
  day_start    timestamptz,              -- current 24 h window
  day_used     int not null default 0
);
alter table public.provider_budget add column if not exists day_start timestamptz;
alter table public.provider_budget add column if not exists day_used int not null default 0;

alter table public.provider_budget enable row level security;
revoke all on public.provider_budget from anon, authenticated;

-- Defaults sized for the free tiers the launch runs on; tune with an UPDATE.
insert into public.provider_budget (provider, per_minute, per_day) values
  ('instagram',  10,   1000),
  ('scraper',    10,    500),
  ('llm',        16,    900),
  ('groq',       18,   1800),
  ('embeddings', 500, 50000)
on conflict (provider) do nothing;

-- take_provider_token: 0 = token granted; otherwise the seconds until one may be.
-- A provider without a row is unlimited. Row lock (FOR UPDATE) makes concurrent
-- takes from many workers serialise, so the budget is never overspent.
create or replace function public.take_provider_token(p_provider text)
returns int
language plpgsql
set search_path = ''
as $$
declare
  b public.provider_budget;
  v_now timestamptz := clock_timestamp();
begin
  select * into b from public.provider_budget where provider = p_provider for update;
  if not found then
    return 0;
  end if;

  if b.window_start is null or v_now >= b.window_start + interval '1 minute' then
    b.window_start := v_now;
    b.used := 0;
  end if;
  if b.day_start is null or v_now >= b.day_start + interval '1 day' then
    b.day_start := v_now;
    b.day_used := 0;
  end if;

  if b.per_day is not null and b.day_used >= b.per_day then
    update public.provider_budget set window_start = b.window_start, used = b.used,
      day_start = b.day_start, day_used = b.day_used where provider = p_provider;
    return greatest(1, ceil(extract(epoch from (b.day_start + interval '1 day' - v_now)))::int);
  end if;
  if b.per_minute is not null and b.used >= b.per_minute then
    update public.provider_budget set window_start = b.window_start, used = b.used,
      day_start = b.day_start, day_used = b.day_used where provider = p_provider;
    return greatest(1, ceil(extract(epoch from (b.window_start + interval '1 minute' - v_now)))::int);
  end if;

  update public.provider_budget
  set window_start = b.window_start, used = b.used + 1,
      day_start = b.day_start, day_used = b.day_used + 1
  where provider = p_provider;
  return 0;
end;
$$;

revoke execute on function public.take_provider_token(text) from public, anon, authenticated;

-- ============================================================
-- 3. embed-job dedup lookups (FINALIZE, note PATCH, scripts/reembed.py)
-- ============================================================
create index if not exists jobs_embed_reel_idx
  on public.jobs ((payload->>'reel_id')) where kind = 'embed';
