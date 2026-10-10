-- 0010 — Pre-launch hardening (backend review 2026-10-10).
-- (0009 is reserved for device hints.)

-- 1. A save whose enrich job is dead-lettered must not stay "pending" forever:
--    it becomes "partial", so the app shows its retry button. Covers both
--    release_job() and sweep_stuck_jobs(), which are the only writers of jobs_dead.
create or replace function public.on_job_dead()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'enrich' and new.payload ? 'reel_id' then
    update public.reels set status = 'partial'
    where id = (new.payload->>'reel_id')::uuid and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_dead_mark_partial on public.jobs_dead;
create trigger jobs_dead_mark_partial
  after insert on public.jobs_dead
  for each row execute function public.on_job_dead();

-- 2. The monthly quota counts saves *created*, not saves still present, so
--    "save, delete, save again" can't reset it (each new save costs an
--    enrichment). Enforced on every insert into reels, whatever the door.
create table if not exists public.save_events (
  id           bigserial primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index if not exists save_events_user_created_idx
  on public.save_events (auth_user_id, created_at desc);
alter table public.save_events enable row level security;
revoke all on public.save_events from anon, authenticated;

-- First apply only: count this month's existing saves.
insert into public.save_events (auth_user_id, created_at)
select r.auth_user_id, r.created_at from public.reels r
where r.auth_user_id is not null
  and r.created_at >= date_trunc('month', now())
  and not exists (select 1 from public.save_events);

create or replace function public.enforce_save_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_quota int;
begin
  if new.auth_user_id is null then
    return new;
  end if;
  select p.saves_free_limit into v_quota from public.profiles p where p.id = new.auth_user_id;
  if v_quota is not null and (
       select count(*) from public.save_events e
       where e.auth_user_id = new.auth_user_id
         and e.created_at >= date_trunc('month', now())) >= v_quota then
    raise exception 'QUOTA_EXCEEDED';
  end if;
  insert into public.save_events (auth_user_id) values (new.auth_user_id);
  return new;
end;
$$;

drop trigger if exists reels_enforce_quota on public.reels;
create trigger reels_enforce_quota
  before insert on public.reels
  for each row execute function public.enforce_save_quota();

-- 3. Retries are capped per save (POST /retries/{id}): 3 per rolling day.
alter table public.reels
  add column if not exists retry_count        int not null default 0,
  add column if not exists retry_window_start timestamptz;

-- 4. Defence in depth: the app never talks to PostgREST, so the client roles
--    (which hold the shipped publishable key) get no table reads and no
--    function calls. Every function we own in public is revoked from PUBLIC,
--    anon and authenticated; extension-owned functions are left alone.
revoke select on public.reel_content, public.reels, public.profiles from authenticated;

do $$
declare
  f text;
begin
  foreach f in array coalesce((
    select array_agg(p.oid::regprocedure::text)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')), '{}')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
