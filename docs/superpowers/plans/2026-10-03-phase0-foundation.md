# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A save goes API → Postgres → queue → worker → `enriched` against a real local Supabase, with every known Part 1 bug fixed and covered by a test.

**Architecture:** Keep the existing FastAPI + asyncpg + Postgres-queue design (`BACKEND.md`). Add a local Supabase stack (Docker) as the test database, fix the SQL in migration 0003 (schema, `save_reel`, queue RPCs with leases), fix the Python DB pool, and make the worker concurrent and lease-aware.

**Tech Stack:** Python ≥ 3.12 (dev 3.14), FastAPI, asyncpg, pytest + pytest-asyncio (`asyncio_mode = "auto"`), PyJWT[crypto], Supabase CLI 2.x + Docker Desktop, GitHub Actions.

**Spec:** `PIPELINE.md` §3–§8, `BACKEND.md` §3–§6 and §10, `docs/superpowers/plans/2026-10-03-roadmap.md`.

**Run everything from `backend/` with the venv active** (`.venv\Scripts\activate` on Windows), except `supabase` commands, which run from the repo root.

## Global Constraints

- Branch `qa`; commits pushed as `ashutoshroy02`; never push to `main` directly.
- The API never calls Instagram or an AI API on the catch path; `POST /saves` p95 < 150 ms.
- Identity comes only from the verified JWT `sub`, never from a request body.
- Error body: `{"error": {"code": "...", "message": "..."}}`; 4xx = user's problem, 5xx = ours.
- List endpoints keyset-paginate (`before` cursor), never offset.
- Free quota: `saves_free_limit` default **20** saves per calendar month. Rate limit: **30** saves per hour (`RATE_LIMIT_PER_HOUR=30`).
- Retry backoff `run_at = now() + 2^attempts minutes`; **max 3 attempts**, then `jobs_dead`.
- Per-user in-flight job cap: **10**. Stuck-job threshold: **10 minutes** (`WORKER_STUCK_AFTER_MINUTES=10`).
- Migrations live in `supabase/migrations/`, numbered, idempotent (safe to re-run).
- DB tests must **fail, not skip,** in CI (`REQUIRE_DB=1`).

## Review Focus

- **Double-tapped share** (two identical `POST /saves` at once) → exactly one `reels` row, both responses carry the same `reel_id` → Task 3 `test_save_reel_concurrent_duplicates_one_row`.
- **`/share/` links and `?igsh=` tracking params** → accepted (201), not 422 → Task 6 `test_post_saves_accepts_share_link_and_igsh_params`.
- **Worker dies mid-job** → after the sweep the job resumes from its saved stage, and the dead worker can no longer advance it → Task 7 `test_crash_mid_job_resumes_from_saved_stage`.
- **Empty queue** → `claim_job` returns no row and the worker sleeps (no busy loop) → Task 4 `test_claim_job_returns_no_rows_when_queue_empty`.
- **Duplicate share when the user is at quota** → returns the existing save (`deduped=true`), not 429 → Task 3 `test_save_reel_duplicate_at_quota_returns_deduped`.

## Bug ↔ task map

| # | Bug | Task |
|---|---|---|
| 1 | `profiles.saves_free_limit` missing → every save fails | 2 |
| 2 | `reels.user_id` FK → Telegram `public.users` → real users fail | 2 |
| 9 | 0003 index uses `array_to_string()` (STABLE) → migration rejected | 2 |
| 5 | `save_reel`: `/share/` links crash, wrong id returned, concurrent dup → 500 | 3 |
| 4 | `claim_job` without `SKIP LOCKED` → double claim | 4 |
| 11 | `claim_job returns public.jobs` → all-NULL row on empty queue → worker busy-loops | 4 |
| 3 | DSN uses service-role key as DB password; asyncpg on pooler needs `statement_cache_size=0` | 5 |
| 10 | `pool()` is `async def` but called as `pool().acquire()` → AttributeError on every DB call | 5 |
| 8 | `deps.py` docstring claims user-JWT/RLS reads; code uses one privileged pool | 6 |
| 7 | worker: one job at a time, holds a connection across external calls, no lease | 7 |

---

### Task 1: Local Supabase stack + DB test harness

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Move: `backend/migrations/0003_pipeline.sql` → `supabase/migrations/0003_pipeline.sql` (delete `backend/migrations/`)
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/db/__init__.py`, `backend/tests/db/test_migrations.py`
- Modify: `backend/pyproject.toml` (`[tool.pytest.ini_options]` markers)

**Interfaces:**
- Produces (conftest):
  - env defaults set at import, before `app.config.settings` is first called: `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`), `DATABASE_URL = TEST_DATABASE_URL`, `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_SERVICE_ROLE_KEY=test-service-role`, `SUPABASE_JWT_AUDIENCE=authenticated`.
  - fixture `db` → `asyncpg.Pool` on `TEST_DATABASE_URL`. If unreachable: `pytest.skip("local Supabase not running — run `supabase start`")`, or `pytest.fail` when `REQUIRE_DB=1`. Before yielding it runs `truncate public.jobs, public.jobs_dead, public.metrics, public.reels, public.reel_content, public.profiles restart identity cascade`.
  - fixture `make_user` → `async def make_user(email: str | None = None) -> uuid.UUID`. It inserts `auth.users (id, email, aud, role)` with `aud = role = 'authenticated'`.
  - marker `db`: `markers = ["db: needs local Supabase (supabase start)"]`. Every test under `tests/db/`, `tests/api/` and `tests/worker/` is marked `db`.

- [ ] **Step 0: Gate — was 0003 ever applied to the cloud project?**
In the Supabase dashboard → Table editor, check whether `public.jobs` exists. **If it does not** (expected), Tasks 2–4 edit `0003_pipeline.sql` in place. **If it does**, put Tasks 2–4's SQL in a new `supabase/migrations/0004_fixes.sql` instead (same content, `create or replace` / `add column if not exists`), and renumber the Phase 1 search migration to `0005`.

- [ ] **Step 1: Start the stack**

Run (repo root, Docker Desktop running): `supabase init` then `supabase start`
Expected: prints `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

- [ ] **Step 2: Write the failing test** — `tests/db/test_migrations.py`

```python
pytestmark = pytest.mark.db

async def test_pipeline_schema_exists(db):
    tables = {r["tablename"] for r in await db.fetch(
        "select tablename from pg_tables where schemaname = 'public'")}
    assert {"reels", "reel_content", "profiles", "jobs", "jobs_dead", "metrics"} <= tables
    fns = {r["proname"] for r in await db.fetch(
        "select proname from pg_proc where pronamespace = 'public'::regnamespace")}
    assert {"save_reel", "claim_job", "release_job"} <= fns
    cols = {r["column_name"] for r in await db.fetch(
        "select column_name from information_schema.columns "
        "where table_schema='public' and table_name='profiles'")}
    assert "saves_free_limit" in cols
```

- [ ] **Step 3: Apply migrations and run — expect failure**

Run: `supabase db reset` (repo root), then `python -m pytest tests/db/test_migrations.py -v`
Expected: `db reset` errors on `reel_content_search_idx` ("functions in index expression must be marked IMMUTABLE"), so the 0003 tables are missing and the test FAILS. Task 2 fixes this.

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml supabase/migrations/0003_pipeline.sql backend/tests backend/pyproject.toml
git rm -r backend/migrations
git commit -m "test: local Supabase stack and DB test harness"
```

---

### Task 2: Fix 0003 schema bugs (#1, #2, #9)

**Files:**
- Modify: `supabase/migrations/0003_pipeline.sql`
- Create: `backend/tests/db/test_save_reel.py`

**Interfaces:**
- Consumes: `db`, `make_user` (Task 1).
- Produces: `profiles.saves_free_limit int not null default 20`. `reels.user_id` is nullable with no FK. No `reel_content_search_idx` (search columns arrive in Phase 1 migration 0004).

- [ ] **Step 1: Write the failing test**

```python
pytestmark = pytest.mark.db
URL = "https://www.instagram.com/reel/C8xYz12/"

async def test_save_reel_first_save_for_new_auth_user(db, make_user):
    uid = await make_user()
    row = await db.fetchrow("select * from public.save_reel($1, $2, 'app_share', $3)", uid, URL, URL)
    assert row["deduped"] is False
    reel = await db.fetchrow("select * from public.reels where id = $1", row["reel_id"])
    assert reel["auth_user_id"] == uid and reel["status"] == "pending"
    assert reel["shortcode_key"] == "C8xYz12"
    assert await db.fetchval("select count(*) from public.jobs where payload->>'reel_id' = $1",
                             str(row["reel_id"])) == 1
```

- [ ] **Step 2: Run it — expect failure**

Run: `python -m pytest tests/db/test_save_reel.py -v` → FAIL (schema missing or FK / column error).

- [ ] **Step 3: Edit `0003_pipeline.sql`**
  - After `create table if not exists public.profiles (...)`, add `alter table public.profiles add column if not exists saves_free_limit int not null default 20;`.
  - In §2, add `alter table public.reels drop constraint if exists reels_user_id_fkey;` and `alter table public.reels alter column user_id drop not null;`.
  - Delete the `reel_content_search_idx` statement and add a comment pointing to Phase 1 migration 0004.

- [ ] **Step 4: Run — expect pass**

Run: `supabase db reset` then `python -m pytest tests/db -v`
Expected: `test_pipeline_schema_exists` and `test_save_reel_first_save_for_new_auth_user` PASS.

- [ ] **Step 5: Commit** — `git commit -am "fix(db): 0003 applies cleanly; saves work for Supabase auth users"`

---

### Task 3: Rewrite `save_reel` (#5) + hourly rate limit

**Files:**
- Modify: `supabase/migrations/0003_pipeline.sql` (§7 `save_reel`)
- Modify: `backend/tests/db/test_save_reel.py`

**Interfaces:**
- Produces: `public.save_reel(p_user_id uuid, p_text text, p_channel text default 'app_share', p_source_url text default null, p_rate_per_hour int default 30) returns table (reel_id uuid, deduped boolean)`. It raises `'BAD_URL'`, `'QUOTA_EXCEEDED'` or `'RATE_LIMITED'` (SQLSTATE P0001; `app/services/jobs.map_rpc_error` already maps these by message).
- Order of checks: **BAD_URL → existing (user, shortcode) returns deduped → monthly quota → hourly rate → insert**.

- [ ] **Step 1: Write the failing tests** (add to `test_save_reel.py`)

```python
async def test_save_reel_share_link_without_shortcode(db, make_user):
    uid = await make_user(); url = "https://www.instagram.com/share/AbCd12"
    row = await db.fetchrow("select * from public.save_reel($1,$2,'app_share',$3)", uid, url, url)
    reel = await db.fetchrow("select * from public.reels where id=$1", row["reel_id"])
    assert reel["shortcode_key"] is None and row["deduped"] is False

async def test_save_reel_duplicate_returns_same_id_deduped(db, make_user): ...
    # second call: same reel_id, deduped True; exactly 1 reels row, 1 jobs row

async def test_save_reel_concurrent_duplicates_one_row(db, make_user): ...
    # asyncio.gather of 5 save_reel calls with the same URL on separate pool connections
    # → all succeed, one distinct reel_id, 1 reels row, 1 jobs row

async def test_save_reel_returns_inserted_id_not_latest(db, make_user): ...
    # save A, then save B: B's returned id == id of the row whose shortcode is B's

async def test_save_reel_quota_exceeded(db, make_user): ...
    # profiles.saves_free_limit = 2 → 3rd distinct URL raises asyncpg.RaiseError matching "QUOTA_EXCEEDED"

async def test_save_reel_duplicate_at_quota_returns_deduped(db, make_user): ...
    # limit 1, save URL1, save URL1 again → deduped True (no exception)

async def test_save_reel_rate_limited(db, make_user): ...
    # p_rate_per_hour = 2 → 3rd distinct URL within the hour raises "RATE_LIMITED"

async def test_save_reel_bad_url(db, make_user): ...
    # "https://example.com/x" raises "BAD_URL"
```

- [ ] **Step 2: Run — expect failures** (`/share/` link → "record v_existing is not assigned yet"; concurrent dup → unique violation; no RATE_LIMITED).

- [ ] **Step 3: Rewrite `save_reel`**. Use a `uuid` variable, not a record, for the inserted id. Insert step:

```sql
insert into public.reels (auth_user_id, user_id, source_url, shortcode, shortcode_key, status, source_channel)
values (p_user_id, p_user_id, v_url, v_shortcode, v_shortcode, 'pending', v_channel)
on conflict (auth_user_id, shortcode_key) where shortcode_key is not null do nothing
returning id into v_id;
if v_id is null then           -- lost a race to a concurrent duplicate
  select id into v_id from public.reels where auth_user_id = p_user_id and shortcode_key = v_shortcode;
  return query select v_id, true; return;
end if;
insert into public.jobs (kind, payload, stage)
values ('enrich', jsonb_build_object('reel_id', v_id, 'user_id', p_user_id), 'resolve');
return query select v_id, false;
```

Rate check: `count(*)` of the user's `reels` with `created_at >= now() - interval '1 hour'` must be `< p_rate_per_hour`.

- [ ] **Step 4: Run — expect pass**: `supabase db reset` then `python -m pytest tests/db/test_save_reel.py -v` → all PASS.

- [ ] **Step 5: Commit** — `git commit -am "fix(db): save_reel handles share links, races, and hourly rate limit"`

---

### Task 4: Queue RPCs with leases (#4, #11)

**Files:**
- Modify: `supabase/migrations/0003_pipeline.sql` (§4 `jobs` columns, §7 RPCs)
- Create: `backend/tests/db/test_queue.py`

**Interfaces:**
- Produces:
  - `jobs` gains `locked_by text` and `heartbeat_at timestamptz`.
  - `claim_job(p_worker text) returns setof public.jobs`. It returns 0 or 1 rows and sets `locked_at = heartbeat_at = now()`, `locked_by = p_worker` and `attempts + 1`.
  - `advance_job(p_job_id uuid, p_worker text, p_stage text, p_payload jsonb default null) returns boolean`. It returns false if `locked_by <> p_worker`, sets `heartbeat_at = now()`, and replaces `payload` when one is given.
  - `heartbeat_job(p_job_id uuid, p_worker text) returns boolean`.
  - `release_job(p_job_id uuid, p_worker text, p_error text default null) returns void`. It does nothing when `locked_by <> p_worker`. On success it deletes the job; on error it backs off, then moves the job to `jobs_dead`.
  - `sweep_stuck_jobs(p_stale interval default interval '10 minutes') returns int`. It covers locked jobs where `coalesce(heartbeat_at, locked_at) < now() - p_stale`. Jobs with `attempts >= max_attempts` move to `jobs_dead` with `last_error = 'stuck: worker lost'`; the rest are unlocked (`locked_at = locked_by = null`). Returns the number of rows touched.

- [ ] **Step 1: Write the failing tests**

```python
pytestmark = pytest.mark.db

async def test_claim_job_returns_no_rows_when_queue_empty(db):
    assert await db.fetch("select * from public.claim_job('w1')") == []

async def test_claim_job_concurrent_claims_get_distinct_jobs(db, make_user): ...
    # enqueue 3 jobs (via save_reel, 3 users); gather 10 claim_job calls on separate
    # connections → exactly 3 non-empty results, 3 distinct ids

async def test_claim_job_respects_per_user_inflight_cap(db, make_user): ...
    # one user with 11 queued jobs → 10 claims succeed, 11th returns []

async def test_advance_job_rejects_non_owner(db, make_user): ...
    # claimed by 'w1' → advance_job(id,'w2','fetch') is False; by 'w1' is True and stage == 'fetch'

async def test_release_job_backoff_then_dead_after_max_attempts(db, make_user): ...
    # claim+release with error 3 times (reset run_at=now() between) → after 3rd: jobs empty,
    # jobs_dead has the row with last_error; after 1st: run_at >= now()+interval '2 minutes' - 5s

async def test_sweep_unlocks_stale_and_dead_letters_exhausted(db, make_user): ...
    # job A attempts 1, heartbeat 11 min ago → unlocked; job B attempts 3, stale → jobs_dead
```

- [ ] **Step 2: Run — expect failure** (empty queue returns one all-NULL row; concurrent claims return duplicate ids; new functions missing).

- [ ] **Step 3: Implement.** The claim is the only part with a non-obvious algorithm:

```sql
create or replace function public.claim_job(p_worker text)
returns setof public.jobs language sql as $$
  with c as (
    select j.id from public.jobs j
    where j.locked_at is null and j.run_at <= now()
      and ((j.payload->>'user_id') is null or (
        select count(*) from public.jobs j2
        where j2.locked_at is not null and j2.payload->>'user_id' = j.payload->>'user_id') < 10)
    order by j.run_at
    limit 1
    for update skip locked
  )
  update public.jobs j
  set locked_at = now(), heartbeat_at = now(), locked_by = p_worker, attempts = j.attempts + 1
  from c where j.id = c.id and j.locked_at is null
  returning j.*;
$$;
```

Drop the old signatures first (`drop function if exists public.claim_job(text); drop function if exists public.release_job(uuid, text);`), because the return type and parameters change.

- [ ] **Step 4: Run — expect pass**: `supabase db reset` then `python -m pytest tests/db -v` → all PASS.

- [ ] **Step 5: Commit** — `git commit -am "fix(db): lease-based job queue with SKIP LOCKED claims and sweep"`

---

### Task 5: DB pool and config (#3, #10)

**Files:**
- Modify: `backend/app/config.py`, `backend/app/deps.py`, `backend/app/main.py`, `backend/app/routers/saves.py`, `backend/.env.example`
- Create: `backend/tests/test_deps_pool.py`

**Interfaces:**
- Produces:
  - `Settings.database_url: str` (required, env `DATABASE_URL`) and `Settings.db_pool_max_size: int = 10`.
  - `async def init_pool() -> asyncpg.Pool` (idempotent).
  - `def pool() -> asyncpg.Pool`, which raises `RuntimeError("pool not initialised — call init_pool()")` before init.
  - `async def close_pool() -> None`.
  - `_region` and `SUPABASE_DB_REGION` are removed.
  - Every call site uses `async with pool().acquire() as conn:` or the pool's own `fetch` / `fetchrow` / `fetchval` / `execute` methods.
  - The app lifespan calls `init_pool()` on startup and `close_pool()` on shutdown.

- [ ] **Step 1: Write the failing tests**

```python
async def test_init_pool_uses_database_url_and_disables_statement_cache(monkeypatch):
    captured = {}
    async def fake_create_pool(dsn, **kw): captured.update(dsn=dsn, **kw); return object()
    monkeypatch.setattr(deps.asyncpg, "create_pool", fake_create_pool)
    monkeypatch.setattr(deps, "_pool", None)
    await deps.init_pool()
    assert captured["dsn"] == os.environ["DATABASE_URL"]
    assert captured["statement_cache_size"] == 0

def test_pool_before_init_raises(monkeypatch):
    monkeypatch.setattr(deps, "_pool", None)
    with pytest.raises(RuntimeError, match="init_pool"):
        deps.pool()
```

- [ ] **Step 2: Run — expect failure**: `python -m pytest tests/test_deps_pool.py -v` → FAIL (`init_pool` missing).

- [ ] **Step 3: Implement.** `create_pool(settings().database_url, min_size=1, max_size=settings().db_pool_max_size, statement_cache_size=0)`. `backend/.env.example` already lists every variable that Phases 0–2 read (updated 2026-10-03), so Settings field names must match it exactly: `DATABASE_URL`, `DB_POOL_MAX_SIZE`, `WORKER_CONCURRENCY`, `WORKER_HEARTBEAT_SECONDS`, and so on.
  In `saves.py`, pass `settings().rate_limit_per_hour` as the 5th `save_reel` argument and map `BadUrl` → 422 `BAD_URL`.

- [ ] **Step 4: Run — expect pass**: `python -m pytest -m "not db" -v` → all PASS (the existing 15 tests plus the 2 new ones).

- [ ] **Step 5: Commit** — `git commit -am "fix: DB pool from DATABASE_URL, initialised in lifespan"`

---

### Task 6: API contract tests + RLS backstop (#8)

**Files:**
- Modify: `backend/tests/conftest.py` (JWT fixtures, app client)
- Create: `backend/tests/api/__init__.py`, `backend/tests/api/test_saves_api.py`, `backend/tests/db/test_rls.py`
- Modify: `backend/app/deps.py` (module docstring), `backend/app/routers/saves.py` (200 for a deduped save), `backend/app/main.py` (error-shape handler)

**Interfaces:**
- Consumes: `init_pool`/`pool` (Task 5), the new `save_reel` (Task 3).
- Produces (conftest):
  - fixture `jwt_for` → `def jwt_for(user_id: uuid.UUID) -> str`. It signs ES256 with a test P-256 key, `kid="test-kid"`, `aud="authenticated"`, `sub=str(user_id)` and `exp` one hour ahead.
  - an autouse patch makes `app.deps._jwks` return `{"keys": [<public JWK, kid "test-kid">]}`.
  - fixture `client` → `httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")`, after `await init_pool()`.
- Behaviour: `POST /saves` returns **201** for a new save and **200** for `deduped=true`.

- [ ] **Step 1: Write the failing tests**

```python
pytestmark = pytest.mark.db

async def test_post_saves_401_without_token(client): ...            # 401
async def test_post_saves_201_creates_pending_reel_and_job(client, make_user, jwt_for, db): ...
async def test_post_saves_200_on_duplicate_with_same_id(client, make_user, jwt_for): ...
async def test_post_saves_422_when_no_instagram_link(client, make_user, jwt_for): ...
    # body {"text": "look at this"} → 422, json()["error"]["code"] == "BAD_URL"  (no "detail" wrapper)
async def test_post_saves_accepts_share_link_and_igsh_params(client, make_user, jwt_for): ...
    # "https://www.instagram.com/share/AbCd12" and
    # "https://www.instagram.com/reel/C8xYz12/?igsh=abc123" → both 201
async def test_post_saves_429_quota(client, make_user, jwt_for, db): ...  # limit 1 → 2nd distinct → 429 QUOTA_EXCEEDED
async def test_get_saves_only_returns_own_reels(client, make_user, jwt_for): ...
async def test_get_saves_keyset_pagination(client, make_user, jwt_for): ...
    # 3 saves; limit=2 → 2 newest; before=<2nd created_at> → the oldest only
async def test_patch_note_404_for_other_users_reel(client, make_user, jwt_for): ...
```

`tests/db/test_rls.py`:

```python
async def test_rls_authenticated_role_sees_only_own_reels(db, make_user): ...
    # in one transaction: set local role authenticated;
    # select set_config('request.jwt.claims', json.dumps({"sub": str(a), "role": "authenticated"}), true)
    # → select count(*) from public.reels returns only A's rows;
    # insert with auth_user_id = b raises asyncpg.InsufficientPrivilegeError (RLS with-check)
```

- [ ] **Step 2: Run — expect failure** (the duplicate returns 201, not 200; fixtures are missing).

- [ ] **Step 3: Implement.** Add the fixtures; the test key pair is generated per test session, so no key is committed. Return `JSONResponse(status_code=200, ...)` when deduped. In `main.py`, add an `HTTPException` handler: when `detail` is a dict with an `"error"` key, return it as the body as-is, so the spec's `{"error": {...}}` shape holds. Rewrite the `deps.py` docstring: "API routes use one service-role pool and **always** filter by the verified `auth_user_id`; RLS policies are the backstop for any direct client access."

- [ ] **Step 4: Run — expect pass**: `python -m pytest -v` → all PASS.

- [ ] **Step 5: Commit** — `git commit -am "test: API contract tests with signed JWTs; RLS backstop test"`

---

### Task 7: Concurrent, lease-aware worker (#7)

**Files:**
- Create: `backend/app/worker/loop.py`
- Modify: `backend/app/worker/__main__.py` (entrypoint only: `init_pool` → `run_forever`), `backend/app/worker/stages.py`, `backend/app/config.py`
- Modify: `backend/tests/test_stages.py` (new stage signature)
- Create: `backend/tests/worker/__init__.py`, `backend/tests/worker/test_worker_loop.py`

**Interfaces:**
- Consumes: the queue RPCs (Task 4) and `pool()` (Task 5).
- Produces:
  - Stage signature `async def stage(db: asyncpg.Pool, job: dict[str, Any]) -> str | None`. Stages query through `db.fetchrow` / `db.execute`, which acquire a connection per query, and may mutate `job["payload"]`.
  - `async def run_job(db: asyncpg.Pool, job: Mapping[str, Any], worker_id: str) -> None`.
  - `async def run_forever(db: asyncpg.Pool, worker_id: str, *, concurrency: int, poll_interval: float, stop: asyncio.Event) -> None`.
  - Settings `worker_concurrency: int = 8` and `worker_heartbeat_seconds: float = 30.0`.
- Behaviour:
  - Advance with `advance_job(id, worker_id, next, payload)`. If it returns false, the lease was lost, so stop silently.
  - Finish with `release_job(id, worker_id)`. On a stage exception, call `release_job(id, worker_id, str(exc))`.
  - On `NotImplementedError`, use the owner-checked update `locked_at = locked_by = null, attempts = greatest(attempts - 1, 0), run_at = now() + interval '5 minutes'`.
  - A heartbeat task calls `heartbeat_job` every `worker_heartbeat_seconds` while a job runs.
  - `sweep_stuck_jobs` runs every 60 s.
  - A semaphore limits jobs in flight to `concurrency`.
  - On an empty claim, sleep `poll_interval`.

- [ ] **Step 1: Write the failing tests**

```python
pytestmark = pytest.mark.db

async def test_run_job_walks_all_stages_to_finalize(db, make_user, monkeypatch): ...
    # patch fetch/transcribe/vision/structure to `return stages.NEXT[name]`;
    # save_reel with a /reel/ URL; claim; run_job → reels.status == 'enriched'; jobs empty

async def test_run_job_stage_error_backs_off(db, make_user, monkeypatch): ...
    # fetch raises RuntimeError("boom") → attempts 1, locked_by null, last_error 'boom',
    # run_at > now() + interval '50 seconds'

async def test_run_job_not_implemented_requeues_without_burning_attempt(db, make_user): ...
    # real stubs → after run_job: attempts 0, stage 'fetch', run_at ≈ now()+5min

async def test_run_forever_processes_jobs_concurrently(db, make_user, monkeypatch): ...
    # 3 users × 1 job; fetch sleeps 0.5 s then returns 'transcribe' (others pass through);
    # concurrency=3; stop when jobs empty → elapsed < 1.2 s, 3 reels enriched

async def test_crash_mid_job_resumes_from_saved_stage(db, make_user): ...
    # claim as 'w1', advance to 'transcribe', no release (crash);
    # set heartbeat_at = now() - interval '11 minutes'; sweep_stuck_jobs() → 1;
    # claim as 'w2' → stage 'transcribe'; advance_job(id,'w1','vision') is False
```

- [ ] **Step 2: Run — expect failure**: `python -m pytest tests/worker tests/test_stages.py -v` → FAIL (`loop` module missing).

- [ ] **Step 3: Implement.** Move the loop logic out of `__main__.py` into `loop.py`. `resolve` stops writing `jobs.payload` directly: it sets `job["payload"]["shortcode"]` and `run_job` persists it via `advance_job`. `_metric` uses `pool().execute(...)`.

- [ ] **Step 4: Run — expect pass**: `python -m pytest -v` → all PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(worker): concurrent lease-aware loop with heartbeat and sweep"`

---

### Task 8: Live check, CI, docs

**Files:**
- Modify: `backend/scripts/debug.py` (`check_db`: `init_pool`; check RPCs `save_reel, claim_job, release_job, advance_job, heartbeat_job, sweep_stuck_jobs`; error hint → `supabase/migrations/`)
- Create: `.github/workflows/backend-ci.yml`
- Modify: `.gitignore` (add `*.egg-info/`), `BACKEND.md` (§2 layout: migrations path; §10 tick the Part 1 boxes that are now proven)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Live check against local Supabase**

Run: `uvicorn app.main:app --port 8000` (terminal 1), `python -m app.worker` (terminal 2), then `python scripts/debug.py --live --api http://localhost:8000`
Expected: summary shows `0 failed`. `db (read-only)` and `api (running server)` PASS, not SKIP.

- [ ] **Step 2: Automated end-to-end test** — `backend/tests/worker/test_e2e.py`

```python
pytestmark = pytest.mark.db

async def test_save_via_api_then_worker_reaches_fetch(client, make_user, jwt_for, db):
    # POST /saves (signed test JWT) with a /reel/ URL → 201
    # claim_job('e2e') + run_job(db, job, 'e2e') → RESOLVE runs, fetch stub requeues
    # → jobs.stage == 'fetch', attempts == 0, reels.shortcode_key == the URL's shortcode
```

Run: `python -m pytest tests/worker/test_e2e.py -v` → PASS.
There is no test-only auth switch in app code: test JWKS patching exists only inside pytest fixtures. Real local sign-in (Supabase Auth issuing tokens) is exercised in Phase 3.

- [ ] **Step 3: CI workflow** — `.github/workflows/backend-ci.yml`

```yaml
name: backend
on:
  push: { branches: [qa, main] }
  pull_request: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    env: { REQUIRE_DB: "1" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.14" }
      - uses: supabase/setup-cli@v1
      - run: supabase start
      - run: pip install -r requirements-dev.txt && pip install -e .
        working-directory: backend
      - run: ruff check .
        working-directory: backend
      - run: python -m pytest -q
        working-directory: backend
      - run: mypy app
        working-directory: backend
        continue-on-error: true   # strict mypy not yet clean; make blocking once it is
```

- [ ] **Step 4: Commit and push to `qa`** (ask the user before pushing)

```bash
git add .github .gitignore BACKEND.md backend/scripts/debug.py backend/tests/worker/test_e2e.py
git commit -m "ci: backend tests on qa/main with local Supabase; e2e save test"
git push origin qa
```

Expected: the GitHub Actions run on `qa` is green. Check it in the GitHub UI (the `gh` CLI is logged in as the wrong account).

**Phase 0 exit:** `supabase db reset` is clean; `python -m pytest` passes all tests (none skipped locally); the `debug.py --live --api` summary shows `0 failed`; CI is green on `qa`.
