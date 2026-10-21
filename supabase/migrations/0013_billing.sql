-- 0013 — Lately Pro billing (RevenueCat on Google Play Billing).
--
-- The plan on profiles is now written by the billing webhook / POST
-- /billing/sync (backend/app/services/billing.py), never by a client.
--   plan_expires_at  end of the paid period; null = no expiry (lifetime, or a
--                    manual pro grant)
--   plan_changed_at  time of the billing event or sync that last set the plan;
--                    an older event arriving late is ignored. Setting it to
--                    'infinity' by hand makes a manual grant immune to events.
-- has_paid_plan() is the one place that decides "is this user paid right now";
-- save_reel() and the enforce_save_quota() trigger use it, so an expired pro
-- is capped again. One day of slack so a late renewal webhook never blocks a
-- paying user (the app's sync fixes the rest).
-- billing_events keeps every webhook delivery: its primary key makes redelivery
-- a no-op, and the payload is the audit trail.

alter table public.profiles
  add column if not exists plan_expires_at timestamptz,
  add column if not exists plan_changed_at timestamptz;

create or replace function public.has_paid_plan(p_plan text, p_expires timestamptz)
returns boolean
language sql
stable
as $$
  select coalesce(
    p_plan = 'lifetime'
      or (p_plan = 'pro' and (p_expires is null or p_expires > now() - interval '1 day')),
    false);
$$;

-- Same lockdown as every function in public (0010): the service role only.
revoke execute on function public.has_paid_plan(text, timestamptz) from public, anon, authenticated;

-- save_reel() and enforce_save_quota(): bodies as in 0012; only the quota
-- lookup changed (the cap applies when the user does not hold a paid plan).
-- `create or replace` keeps their grants (0010 revoked client access).
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
begin
  -- 1. URL extraction + tracking-param strip is done in the API (Python),
  --    but the RPC re-validates the invariant: a URL must exist.
  v_url := coalesce(p_source_url, p_text);
  if v_url is null or v_url !~ '^https?://'
     or v_url !~* 'instagram\.com' then
    raise exception 'BAD_URL';
  end if;

  -- 2. shortcode if the URL carries one (null for /share/ links; RESOLVE fills it)
  v_shortcode := (regexp_match(
    v_url, 'instagram\.com/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)', 'i'))[1];

  -- 3. dedup: second share of the same reel returns the existing save
  if v_shortcode is not null then
    select r.id into v_id from public.reels r
    where r.auth_user_id = p_user_id and r.shortcode_key = v_shortcode;
    if v_id is not null then
      return query select v_id, true;
      return;
    end if;
  end if;

  -- 4. quota: saves this calendar month, unless the user holds a paid plan
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;
  select case when not public.has_paid_plan(p.plan, p.plan_expires_at)
              then p.saves_free_limit end into v_quota
  from public.profiles p where p.id = p_user_id;
  if (select count(*) from public.reels r
      where r.auth_user_id = p_user_id
        and r.created_at >= date_trunc('month', now())) >= v_quota then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  -- 5. rate: saves in the last hour
  if (select count(*) from public.reels r
      where r.auth_user_id = p_user_id
        and r.created_at >= now() - interval '1 hour') >= p_rate_per_hour then
    raise exception 'RATE_LIMITED';
  end if;

  -- 6. insert pending save + enqueue the enrich job (stage: resolve)
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
  select case when not public.has_paid_plan(p.plan, p.plan_expires_at)
              then p.saves_free_limit end into v_quota
  from public.profiles p where p.id = new.auth_user_id;
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

-- Webhook deliveries (idempotency + audit). No FK to auth.users: RevenueCat
-- sends anonymous ids too, and DELETE /me removes a user's rows by app_user_id.
create table if not exists public.billing_events (
  id           text primary key,         -- RevenueCat event id
  type         text not null,
  app_user_id  text,
  environment  text,                     -- PRODUCTION | SANDBOX
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists billing_events_app_user_idx on public.billing_events (app_user_id);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;
