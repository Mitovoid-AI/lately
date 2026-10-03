-- Lately — 0003: pipeline data model (PIPELINE.md §8, founder architecture)
--
-- Replaces the Telegram-era schema direction: users are Supabase auth users
-- (auth.users), RLS is real again (auth.uid()), and the shared-content cache
-- (reel_content) means expensive work happens once per reel, not once per save.
--
-- Idempotent: safe to run multiple times.

-- ============================================================
-- 1. reel_content — shared card content, one row per unique reel
-- ============================================================
create table if not exists public.reel_content (
  shortcode       text primary key,
  source_url      text not null,
  caption         text,
  transcript      text,
  title           text,
  summary         text,
  steps           jsonb,
  category        text,
  tags            text[],
  entities        jsonb,
  search_text     text,
  likely_queries  text[],
  thumbnail_path  text,
  media_status    text not null default 'pending'
                    check (media_status in ('pending','partial','ready','failed')),
  parser_version  int,
  fetched_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- Full-text search lives on the shared content (PIPELINE.md §6).
create index if not exists reel_content_search_idx
  on public.reel_content
  using gin (to_tsvector('english',
    coalesce(search_text, '') || ' ' ||
    coalesce(title, '')      || ' ' ||
    coalesce(summary, '')    || ' ' ||
    coalesce(caption, '')    || ' ' ||
    coalesce(array_to_string(tags, ' '), '') ||
    coalesce(array_to_string(likely_queries, ' '), '')));

-- ============================================================
-- 2. reels — per-user saves, now pointers into reel_content
-- ============================================================
do $$ begin
  -- columns
  alter table public.reels add column if not exists shortcode_key text
    references public.reel_content(shortcode) on delete set null;
  alter table public.reels add column if not exists auth_user_id uuid
    references auth.users(id) on delete cascade;
  alter table public.reels add column if not exists note text;
  -- embedding: card + user note (Part 3 fills it; pgvector extension first)
  execute 'create extension if not exists vector';
  alter table public.reels add column if not exists embedding vector(768);
exception
  when undefined_file then raise notice 'pgvector not available; skip embedding column';
  when duplicate_object then null;
end $$;

-- Backfill: existing dev rows owned by the seeded dev user → that auth user.
-- (Dev user is expected to exist in auth.users with this id; harmless if not.)
update public.reels
set auth_user_id = '00000000-0000-0000-0000-000000000001'::uuid
where auth_user_id is null;

-- Backfill shortcodes already parsed into rows without a content link.
update public.reels r
set shortcode_key = r.shortcode
where shortcode_key is null and shortcode is not null;

-- Unique(user, shortcode): double share is a no-op (PIPELINE.md §3 step 4).
create unique index if not exists reels_user_shortcode_idx
  on public.reels (auth_user_id, shortcode_key)
  where shortcode_key is not null;

create index if not exists reels_user_created_idx
  on public.reels (auth_user_id, created_at desc);

-- ============================================================
-- 3. profiles — now keyed to auth.users (quota via Postgres count)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','lifetime')),
  saves_free_limit int not null default 20,
  saves_this_month int not null default 0,
  quota_reset_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4. jobs / jobs_dead — the queue (PIPELINE.md §4, §7)
-- ============================================================
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'enrich',
  payload jsonb not null,               -- { reel_id, user_id, shortcode }
  stage text not null default 'resolve',
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists jobs_due_idx
  on public.jobs (run_at) where locked_at is null;

create table if not exists public.jobs_dead (
  id uuid primary key,
  kind text,
  payload jsonb,
  stage text,
  attempts int,
  last_error text,
  failed_at timestamptz not null default now()
);

-- ============================================================
-- 5. metrics — door, stage, duration_ms, outcome, cost (PIPELINE.md §8)
-- ============================================================
create table if not exists public.metrics (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  door text,                            -- app_share | meta_dm | web | ...
  stage text,                           -- resolve | fetch | transcribe | vision | structure | finalize | catch
  duration_ms int,
  outcome text,                         -- ok | error | skipped | cache_hit
  cost_usd numeric(10,6),
  detail jsonb
);

create index if not exists metrics_at_idx on public.metrics (at desc);

-- ============================================================
-- 6. RLS — real policies again (Supabase auth is the identity source)
-- ============================================================
alter table public.reel_content enable row level security;
alter table public.reels        enable row level security;
alter table public.profiles     enable row level security;
alter table public.jobs         enable row level security;
alter table public.jobs_dead    enable row level security;
alter table public.metrics      enable row level security;

-- reel_content is shared read-only to authenticated clients; only the
-- service_role (worker/API server) writes it.
drop policy if exists "auth read content" on public.reel_content;
create policy "auth read content" on public.reel_content
  for select to authenticated using (true);

drop policy if exists "own reels" on public.reels;
create policy "own reels" on public.reels
  for all to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- jobs/jobs_dead/metrics: service-side only. No anon/authenticated policies =
-- no access. Belt and braces:
revoke all on public.reel_content, public.reels, public.profiles,
              public.jobs, public.jobs_dead, public.metrics
  from anon;

-- ============================================================
-- 7. RPCs — save_reel (catch path) and claim_job (worker claim)
-- ============================================================

-- save_reel: the entire CATCH path in one atomic Postgres call.
--   quota via count (no Redis), dedup via unique index, enqueue included.
-- Returns the reel id, or raises with a clear SQLSTATE for 4xx mapping:
--   P0001 'QUOTA_EXCEEDED'  → 429
--   P0001 'RATE_LIMITED'    → 429
--   P0001 'BAD_URL'         → 422
create or replace function public.save_reel(
  p_user_id uuid,
  p_text text,
  p_channel text default 'app_share',
  p_source_url text default null   -- pre-extracted URL; null → derive from text
)
returns table (reel_id uuid, deduped boolean)
language plpgsql
as $$
declare
  v_url text;
  v_shortcode text;
  v_existing record;
  v_quota int;
  v_rate int;
begin
  -- 1. URL extraction + tracking-param strip is done in the API (Python),
  --    but the RPC re-validates the invariant: a URL must exist.
  v_url := coalesce(p_source_url, p_text);
  if v_url is null or v_url !~ '^https?://'
     or v_url !* 'instagram\.com' then
    raise exception 'BAD_URL';
  end if;

  -- 2. shortcode if the URL carries one (else null; RESOLVE fixes it later)
  v_shortcode := (
    select m[1] from regexp_matches(
      v_url, 'instagram\.com/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)', 'i'
    ) as m
    limit 1
  );

  -- 3. quota: saves this calendar month (Postgres count — PIPELINE.md §3 step 3)
  select coalesce(p.saves_free_limit, 20) into v_quota
  from public.profiles p where p.id = p_user_id;
  if v_quota is null then
    insert into public.profiles (id) values (p_user_id)
    on conflict (id) do nothing;
    v_quota := 20;
  end if;

  select count(*) into v_rate
  from public.reels r
  where r.auth_user_id = p_user_id
    and r.created_at >= date_trunc('month', now());
  if v_rate >= v_quota then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  -- 4. dedup: unique(user, shortcode) — second share of the same reel is a no-op
  if v_shortcode is not null then
    select id into v_existing from public.reels
    where auth_user_id = p_user_id and shortcode_key = v_shortcode
    limit 1;
    if found then
      return query select v_existing.id, true;
      return;
    end if;
  end if;

  -- 5. insert pending save + enqueue the enrich job (stage: resolve)
  with reel as (
    insert into public.reels
      (auth_user_id, user_id, source_url, shortcode, shortcode_key,
       status, source_channel)
    values
      (p_user_id, p_user_id, v_url,
       v_shortcode, v_shortcode,
       'pending',
       case p_channel
         when 'app_share' then 'app'
         when 'meta_dm'   then 'telegram'   -- legacy check tolerates channel
         else 'web'
       end)
    returning id
  )
  insert into public.jobs (kind, payload, stage)
  select 'enrich',
         jsonb_build_object('reel_id', reel.id, 'user_id', p_user_id),
         'resolve'
  from reel
  returning '00000000-0000-0000-0000-000000000000'::uuid into v_existing.id;

  -- fetch the inserted reel id back (single-row table guarantee by unique idx)
  select r.id into v_existing.id
  from public.reels r
  where r.auth_user_id = p_user_id
  order by r.created_at desc
  limit 1;

  return query select v_existing.id, false;
end;
$$;

-- claim_job: atomic FIFO claim with per-user in-flight cap (PIPELINE.md §4).
--   Called by workers: select * from public.claim_job('worker-name');
create or replace function public.claim_job(p_worker text default 'w')
returns public.jobs
language sql
as $$
  with candidates as (
    select j.*
    from public.jobs j
    where j.locked_at is null
      and j.run_at <= now()
      -- per-user in-flight cap of 10: a user flooding saves waits,
      -- everyone else is unaffected (PIPELINE.md §4)
      and (
        (j.payload->>'user_id') is null
        or (
          select count(*) from public.jobs j2
          where j2.locked_at is not null
            and j2.payload->>'user_id' = j.payload->>'user_id'
        ) < 10
      )
    order by j.run_at
    limit 1
  )
  update public.jobs j
  set locked_at = now(),
      attempts  = j.attempts + 1
  from candidates c
  where j.id = c.id
  returning j.*;
$$;

-- release_job: finish or requeue with backoff; dead after max_attempts.
create or replace function public.release_job(
  p_job_id uuid,
  p_error text default null
)
returns void
language plpgsql
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then return; end if;

  if p_error is null then
    delete from public.jobs where id = p_job_id;
    return;
  end if;

  if j.attempts >= j.max_attempts then
    insert into public.jobs_dead (id, kind, payload, stage, attempts, last_error)
    values (j.id, j.kind, j.payload, j.stage, j.attempts, p_error);
    delete from public.jobs where id = p_job_id;
  else
    update public.jobs
    set locked_at = null,
        run_at    = now() + power(2, j.attempts) * interval '1 minute',
        last_error = p_error
    where id = p_job_id;
  end if;
end;
$$;
