-- Stand-in for the Supabase-managed schemas (auth, storage, extensions) in a
-- plain Postgres database, so extra disposable test databases on the same
-- cluster can run the migrations. Only what migrations and tests touch.
-- Never applied to a real Supabase project database: make_test_db.py only
-- targets databases named lately_test_*.

create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
create table if not exists auth.users (
  id                 uuid primary key,
  aud                text,
  role               text,
  email              text,
  raw_user_meta_data jsonb,
  raw_app_meta_data  jsonb,
  last_sign_in_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create table if not exists auth.identities (
  id            uuid primary key default extensions.gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null,
  identity_data jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id         text primary key,
  name       text not null,
  public     boolean default false,
  created_at timestamptz default now()
);
