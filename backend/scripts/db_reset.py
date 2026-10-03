"""Reset the test/dev database and re-apply every migration.

Stands in for `supabase db reset` against the online dev project (no Docker):
drops everything the migrations created in schema `public` (keeping the
schema itself, so Supabase's grants and default privileges survive), then
applies supabase/migrations/*.sql in order and supabase/seed.sql, one
transaction per file.

Target: TEST_DATABASE_URL (env var → backend/.env → local Supabase CLI default).
Destructive by design — it refuses any URL that mentions "prod".

Usage (from backend/):  python scripts/db_reset.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import asyncpg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
SEED = ROOT / "supabase" / "seed.sql"
ENV_FILE = ROOT / "backend" / ".env"
LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# Names are collected into arrays first so cascading drops can't disturb a loop.
# Objects owned by an extension (deptype 'e') are left to their extension.
DROP_PUBLIC = """
do $$
declare
  n text;
begin
  foreach n in array coalesce((
    select array_agg(quote_ident(e.extname)) from pg_extension e
    where e.extnamespace = 'public'::regnamespace), '{}')
  loop execute format('drop extension if exists %s cascade', n); end loop;

  foreach n in array coalesce((
    select array_agg(format('%I.%I', 'public', c.relname)) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'm'), '{}')
  loop execute format('drop materialized view if exists %s cascade', n); end loop;

  foreach n in array coalesce((
    select array_agg(format('%I.%I', 'public', c.relname)) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'), '{}')
  loop execute format('drop view if exists %s cascade', n); end loop;

  foreach n in array coalesce((
    select array_agg(format('%I.%I', 'public', c.relname)) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')), '{}')
  loop execute format('drop table if exists %s cascade', n); end loop;

  foreach n in array coalesce((
    select array_agg(format('%s if exists %s',
             case p.prokind when 'p' then 'procedure' when 'a' then 'aggregate'
                            else 'function' end,
             p.oid::regprocedure::text))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')), '{}')
  loop execute 'drop ' || n || ' cascade'; end loop;

  foreach n in array coalesce((
    select array_agg(format('%I.%I', 'public', c.relname)) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'), '{}')
  loop execute format('drop sequence if exists %s cascade', n); end loop;

  foreach n in array coalesce((
    select array_agg(format('%I.%I', 'public', t.typname)) from pg_type t
    where t.typnamespace = 'public'::regnamespace and t.typtype in ('e', 'd')), '{}')
  loop execute format('drop type if exists %s cascade', n); end loop;
end $$;
"""


def target_url() -> str:
    if url := os.environ.get("TEST_DATABASE_URL"):
        return url
    if ENV_FILE.exists() and (url := dotenv_values(ENV_FILE).get("TEST_DATABASE_URL")):
        return url
    return LOCAL_DB


async def reset(url: str) -> None:
    conn = await asyncpg.connect(url, statement_cache_size=0, timeout=15)
    try:
        await conn.execute(DROP_PUBLIC)
        print("dropped public schema objects")
        for path in [*sorted(MIGRATIONS.glob("*.sql")), SEED]:
            if not path.exists():
                continue
            try:
                async with conn.transaction():
                    await conn.execute(path.read_text(encoding="utf-8"))
            except asyncpg.PostgresError as exc:
                print(f"FAILED {path.name}: {type(exc).__name__}: {exc}")
                raise SystemExit(1) from exc
            print(f"applied {path.name}")
    finally:
        await conn.close()


def main() -> None:
    url = target_url()
    if "prod" in url.lower():
        sys.exit("refusing to reset a database whose URL mentions 'prod'")
    parts = urlsplit(url)
    print(f"resetting {parts.hostname}:{parts.port} as {parts.username}")
    asyncio.run(reset(url))


if __name__ == "__main__":
    main()
