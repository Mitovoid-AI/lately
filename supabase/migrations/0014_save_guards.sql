-- 0014 — Save guards (review fixes, GitHub #3 #5 #17).
--
-- 1. save_reel() accepts only reel, post and share links, the same rule as the
--    API (backend/app/urls.py, SAVEABLE_URL): /reel|reels|p|tv/<code>, the
--    permalink /<username>/reel|p|tv/<code>, or a /share/ short link. Any other
--    instagram.com page (profile, story, explore, audio) is BAD_URL, and the
--    shortcode is read from the permalink form too.
-- 2. save_reel() locks the user's profile row before the duplicate check, so one
--    user's saves run one at a time: two shares of the same reel at once can no
--    longer both pass the check (and both be charged to the monthly quota).
-- 3. The hourly rate limit counts public.save_events (the append-only log the
--    monthly quota trigger uses, 0010) instead of live reels rows, so
--    save → delete → save can't dodge it.
-- 4. reels.fail_reason: why a partial card could not be completed. The worker
--    writes it; the API returns it for partial saves and clears it whenever it
--    re-enqueues the save.
--
-- Additive and idempotent: safe to run again, and on a live database with
-- 0001-0013 and existing rows.

alter table public.reels
  add column if not exists fail_reason text
    check (fail_reason in ('fetch_blocked', 'unavailable', 'ai_unavailable', 'timed_out'));

comment on column public.reels.fail_reason is
  'Why a partial card could not be completed (worker); cleared when the save is re-enqueued';

-- Body as in 0013 apart from the URL rule (steps 1-2), the profile lock (step 3)
-- and the rate count (step 6). `create or replace` keeps its grants (0010).
create or replace function public.save_reel(
  p_user_id uuid,
  p_text text,
  p_channel text default 'app_share',
  p_source_url text default null,   -- pre-extracted URL; null → derive from text
  p_rate_per_hour int default 30
)
returns table (reel_id uuid, deduped boolean)
language plpgsql
as $$
declare
  v_url text;
  v_shortcode text;
  v_id uuid;
  v_quota int;
  -- Keep in step with SAVEABLE_URL in backend/app/urls.py (same pattern text).
  v_saveable constant text :=
    '^https?://(?:www\.)?instagram\.com/'
    '(?:(?:reel|reels|p|tv|(?!share/)[A-Za-z0-9._]{1,30}/(?:reel|p|tv))'
    '/(?!audio(?:[^A-Za-z0-9_-]|$))([A-Za-z0-9_-]+)'
    '|share/[A-Za-z0-9_-]+)';
begin
  -- 1. URL extraction + tracking-param strip is done in the API (Python),
  --    but the RPC re-validates the invariant: a reel, post or share link.
  v_url := coalesce(p_source_url, p_text);
  if v_url is null or v_url !~* v_saveable then
    raise exception 'BAD_URL';
  end if;

  -- 2. shortcode if the URL carries one (null for /share/ links; RESOLVE fills it)
  v_shortcode := (regexp_match(v_url, v_saveable, 'i'))[1];

  -- 3. one save at a time per user: the profile row lock serialises this user's
  --    concurrent calls, so the duplicate check below sees the other's insert
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles p where p.id = p_user_id for update;

  -- 4. dedup: second share of the same reel returns the existing save
  if v_shortcode is not null then
    select r.id into v_id from public.reels r
    where r.auth_user_id = p_user_id and r.shortcode_key = v_shortcode;
    if v_id is not null then
      return query select v_id, true;
      return;
    end if;
  end if;

  -- 5. quota: saves this calendar month, unless the user holds a paid plan
  select case when not public.has_paid_plan(p.plan, p.plan_expires_at)
              then p.saves_free_limit end into v_quota
  from public.profiles p where p.id = p_user_id;
  if (select count(*) from public.reels r
      where r.auth_user_id = p_user_id
        and r.created_at >= date_trunc('month', now())) >= v_quota then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  -- 6. rate: saves made in the last hour (append-only log: deletes don't refund)
  if (select count(*) from public.save_events e
      where e.auth_user_id = p_user_id
        and e.created_at >= now() - interval '1 hour') >= p_rate_per_hour then
    raise exception 'RATE_LIMITED';
  end if;

  -- 7. insert pending save + enqueue the enrich job (stage: resolve)
  insert into public.reels
    (auth_user_id, user_id, source_url, shortcode, shortcode_key, status, source_channel)
  values
    (p_user_id, p_user_id, v_url, v_shortcode, v_shortcode, 'pending',
     case p_channel
       when 'app_share' then 'app'
       when 'meta_dm'   then 'telegram'   -- legacy check tolerates channel
       else 'web'
     end)
  on conflict (auth_user_id, shortcode_key) where shortcode_key is not null do nothing
  returning id into v_id;

  if v_id is null then           -- lost a race to a concurrent duplicate
    select r.id into v_id from public.reels r
    where r.auth_user_id = p_user_id and r.shortcode_key = v_shortcode;
    return query select v_id, true;
    return;
  end if;

  insert into public.jobs (kind, payload, stage)
  values ('enrich', jsonb_build_object('reel_id', v_id, 'user_id', p_user_id), 'resolve');

  return query select v_id, false;
end;
$$;

-- Same lockdown as every function in public (0010): the service role only.
revoke execute on function public.save_reel(uuid, text, text, text, int)
  from public, anon, authenticated;
