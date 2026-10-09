"""Create an isolated disposable test database on the test cluster.

Parallel workers can't share one test database: every test run truncates its
tables. This creates `<name>` next to TEST_DATABASE_URL's database (only if it
doesn't exist yet; it never drops a database), loads the auth/storage stand-in
(supabase/test/bootstrap.sql) and applies every migration via db_reset.
Prints the new URL with the password masked; set TEST_DATABASE_URL to it.

Usage (from backend/):  python scripts/make_test_db.py lately_test_search
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_reset

BOOTSTRAP = db_reset.ROOT / "supabase" / "test" / "bootstrap.sql"


def with_database(url: str, name: str) -> str:
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, "/" + name, p.query, p.fragment))


async def main(name: str) -> None:
    if not re.fullmatch(r"lately_test_[a-z0-9_]+", name):
        sys.exit("name must look like lately_test_<word>")
    base = db_reset.target_url()
    if "prod" in base.lower():
        sys.exit("refusing: base URL mentions 'prod'")
    admin = await asyncpg.connect(base, statement_cache_size=0, timeout=15)
    try:
        exists = await admin.fetchval("select 1 from pg_database where datname = $1", name)
        if not exists:
            await admin.execute(f'create database "{name}"')
    finally:
        await admin.close()
    url = with_database(base, name)
    conn = await asyncpg.connect(url, statement_cache_size=0, timeout=15)
    try:
        await conn.execute(BOOTSTRAP.read_text(encoding="utf-8"))
        await conn.execute(
            f"alter database \"{name}\" set search_path = \"$user\", public, extensions")
    finally:
        await conn.close()
    await db_reset.reset(url)
    password = urlsplit(url).password
    print(url.replace(password, "***") if password else url)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1]))
