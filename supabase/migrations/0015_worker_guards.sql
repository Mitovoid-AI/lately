-- 0015 — Worker guards (review fixes, GitHub #17 #18).
--
-- 1. A save whose enrich job is dead-lettered becomes "partial" (0010) and now
--    also gets reels.fail_reason (0014), read from the job's last error:
--    'llm unavailable…' → ai_unavailable, anything else (stage deadlines,
--    "stuck: worker lost", repeated stage errors) → timed_out. The worker
--    writes the reason itself for saves it finishes as partial.
-- 2. Indexes for the worker's sweep that re-enqueues embed jobs for enriched
--    saves left without an embedding (backend/app/worker/loop.py _REEMBED).
--
-- Additive and idempotent: safe to run again, and on a live database with
-- 0001-0014 and existing rows.

-- Body as in 0010 plus the fail_reason. `create or replace` keeps its grants.
create or replace function public.on_job_dead()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'enrich' and new.payload ? 'reel_id' then
    update public.reels
    set status = 'partial',
        fail_reason = case when new.last_error ilike 'llm unavailable%' then 'ai_unavailable'
                           else 'timed_out' end
    where id = (new.payload->>'reel_id')::uuid and status = 'pending';
  end if;
  return new;
end;
$$;

-- Same lockdown as every function in public (0010): the service role only.
revoke execute on function public.on_job_dead() from public, anon, authenticated;

create index if not exists reels_enriched_unembedded_idx
  on public.reels (created_at desc) where status = 'enriched' and embedding is null;

create index if not exists jobs_dead_embed_reel_idx
  on public.jobs_dead ((payload->>'reel_id')) where kind = 'embed';
