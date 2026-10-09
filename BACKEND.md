# Lately — Python Backend Plan (FastAPI + Supabase)

Decision: the whole backend moves to **Python/FastAPI** — routes, enrichment
pipeline, and workers. Supabase stays the platform (Postgres, Auth, Storage).
The existing Node code in `website/` is the reference implementation; it gets
deleted once Python reaches parity.

> **Superseded in part by `PIPELINE.md` §2–10 (founder's canonical
> architecture):** Door 1 is the Android share sheet; the Telegram bot is a
> LATER door, replaced by the IG DM bot (Meta webhook). Quota/rate-limit via
> Postgres count (no Redis at v1). FIFO queue + per-user in-flight cap (fair-RR
> deferred). Stages now include VISION and STRUCTURE emits `likely_queries`.
> Where this doc and `PIPELINE.md` disagree, `PIPELINE.md` wins.

Supabase auth changes the security model for the better: requests carry a
Supabase JWT, `auth.uid()` exists again, and **real RLS returns**. Migration
0002's "service_role everywhere + manual user_id filters" approach is retired.

Related docs: `INFRASTRUCTURE.md` (platform scaling), `PIPELINE.md` (processing
design), `SEARCH.md` (search design), `PLAN.md` (product phases).

---

## 1. Architecture

```
Android app / Web / Telegram
        │  Authorization: Bearer <supabase JWT>
        ▼
┌─────────────────────────────┐
│  FastAPI (uvicorn, async)   │  catch path only: validate JWT, insert,
│  /save /search /retry /me   │  enqueue, return. No Instagram, no AI.
└──────────┬──────────────────┘
           │ service_role (server-side only)
           ▼
┌──────────────┐     ┌──────────────────────────────┐
│   Supabase   │     │  Worker process (Python)     │
│   Postgres   │◀────│  enrich loop: claim job →    │
│  jobs/reels  │     │  fetch → transcribe →        │
└──────────────┘     │  structure → finalize        │
                     └──────────────────────────────┘
```

Two processes, one codebase:

| Process | Entry | Scale unit |
|---|---|---|
| API | `uvicorn app.main:app --workers N` | CPU/conn-pool bound; scale on request latency |
| Worker | `python -m app.worker` | queue depth; scale on backlog (PIPELINE.md §4) |

The API process **never** calls Instagram, Groq, or Gemini. That split is the
"capture must never fail" guarantee from `PLAN.md` §2, enforced by process
boundary instead of discipline.

---

## 2. Project layout

```
backend/
├── app/
│   ├── main.py               # FastAPI app factory, middleware, routers
│   ├── config.py             # pydantic-settings, env-driven
│   ├── deps.py               # get_current_user (JWKS verify), db pool
│   ├── urls.py               # extract/normalize URL, strip tracking, shortcode (port of instagram.ts)
│   ├── models.py             # pydantic request/response models
│   ├── routers/
│   │   └── saves.py          # POST /saves (catch), GET /saves, PATCH /saves/{id} (note)
│   ├── services/
│   │   └── jobs.py           # enqueue, quota check (Postgres count), claim SQL
│   ├── worker/
│   │   ├── __main__.py       # `python -m app.worker` entrypoint
│   │   ├── loop.py           # concurrent, lease-aware claim → stages → advance/release loop
│   │   └── stages.py         # stage registry: resolve now; fetch/transcribe/vision/structure/finalize in Parts 2–3
│   ├── enrich.py             # (Part 2) fetch_reel/transcribe/structure ports of *.ts
│   └── search.py             # (Part 3) hybrid FTS + pgvector
├── scripts/
│   ├── debug.py              # self-check; --live (read-only DB) and --api <url>
│   └── db_reset.py           # wipe + re-apply supabase/migrations on TEST_DATABASE_URL
├── tests/
│   ├── conftest.py           # TEST_DATABASE_URL, db/make_user, signed test JWTs, API client
│   ├── test_urls.py          # URL extraction/shortcode/tracking-strip cases
│   ├── test_stages.py        # stage graph + stub contract
│   ├── test_deps_pool.py     # pool built from DATABASE_URL
│   ├── db/                   # migrations, save_reel, queue RPCs, RLS   (-m db)
│   ├── api/                  # /saves contract with real JWT verification (-m db)
│   └── worker/               # worker loop, crash/resume, end-to-end    (-m db)
├── pyproject.toml            # deps + ruff + mypy config
├── .env.example
└── Dockerfile                # one image, two commands (api / worker)

supabase/                     # repo root: Supabase CLI project
├── config.toml
├── migrations/               # 0001_init, 0002_users_and_rls, 0003_pipeline (applied in order)
└── seed.sql
```

Dependencies (pinned at install time, latest stable as of Sept 2026):

```
fastapi, uvicorn[standard], pydantic, pydantic-settings,
httpx, pyjwt[crypto], asyncpg,
pytest, pytest-asyncio, ruff, mypy
# Part 2 adds: groq, google-genai; Part 4 adds supabase (py) + hmac (stdlib) for Meta webhook sigs
```

---

## 3. Auth: Supabase JWT → verified identity in FastAPI

**Flows:**
- **Web:** magic link (email OTP) → Supabase JS on the frontend hands the access
  token to the API as `Authorization: Bearer …`
- **Android (Door 1):** Supabase auth via `gotrue` — magic link + **Google
  one-tap** (configure the Google provider in the Supabase dashboard with your
  Android client ID; deep-link back to the app with the tokens)
- **IG DM bot (Door 2, later):** Meta webhook + one-time link code; payloads
  trusted only after `X-Hub-Signature-256` verification (PIPELINE.md §8 trust
  rule)
- **Telegram:** demoted to a later door; same one-time-code linking pattern
  applies if/when built

**Verification middleware — the one security-critical file:**

```python
# app/deps.py
from fastapi import Depends, HTTPException, Request
from supabase import create_client
import jwt  # pyjwt
import httpx, time

_jwks: dict | None = None

def _jwks_cached() -> dict: ...  # fetch once, refresh on kid miss

async def get_current_user(request: Request) -> AuthUser:
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not token:
        raise HTTPException(401, "missing bearer token")
    try:
        claims = jwt.decode(
            token, _jwks_cached(), algorithms=["ES256", "RS256"],
            audience=settings.supabase_audience,   # project ref / JWT audience
            options={"verify_aud": True},
        )
    except JWTError:
        raise HTTPException(401, "invalid token")
    return AuthUser(id=claims["sub"], email=claims.get("email"))
```

Verify JWKS signature (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`)
— **never** decode without verification, never accept a `user_id` field from
the request body as identity.

---

## 4. Database: migration 0003 brings back real RLS

Current state (migration 0002): RLS closed to public roles, everything through
`service_role`, identity by Telegram id. With Supabase auth:

```sql
-- 0003_auth_rls.sql
-- 1. Link profiles to auth users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','lifetime')),
  saves_this_month int not null default 0,
  quota_reset_at timestamptz,
  saves_free_limit int not null default 20
);

-- 2. Per-user tables get FK to auth.users
alter table public.reels
  add column if not exists auth_user_id uuid references auth.users(id);
-- (backfill: set auth_user_id = user_id for existing dev-user rows)

-- 3. THE POLICIES — this is the upgrade vs migration 0002
alter table public.reels enable row level security;
drop policy if exists "own reels" on public.reels;
create policy "own reels" on public.reels
  for all using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- same pattern for categories, notes, profiles
-- service_role still bypasses RLS for the worker; keep it server-side only.
```

API + client read path: the API calls PostgREST (`supabase-py`) **with the
user's own JWT** — RLS scopes every query automatically. The service_role key
is used only by the worker pipeline and admin operations (quota counters,
`generateLink`), never in the request path.

**Telegram linking** (no password, no widget on localhost):

```sql
create table if not exists public.telegram_links (
  telegram_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
```

Bot verifies the login payload → admin `generateLink` → stores the link → bot
hands the user a session (or the web app completes sign-in with the returned
link tokens).

**Migration order to run by hand in the SQL editor:** `0003`, then `0004`
(jobs/DLQ/`reel_content` cache — full SQL already written in `PIPELINE.md` §2/§5
and `INFRASTRUCTURE.md` §5).

---

## 5. Route table (v1 — Part 1 ships the first three)

| Part | Method | Path | Auth | What it does | Ported from |
|---|---|---|---|---|---|
| 1 | POST | `/saves` | JWT | CATCH: extract URL, strip tracking, quota+rate check (Postgres), insert `pending`, enqueue `{kind: enrich, stage: resolve}`, return 201 | `reels.ts saveReel` + `api/save` |
| 1 | GET | `/saves` | JWT | list w/ keyset pagination (`before` cursor) | `reels.ts listReels` |
| 1 | PATCH | `/saves/{id}` | JWT | attach the "why?" note (follow-up, skippable) | — |
| 2 | POST | `/retries/{reel_id}` | JWT | re-enqueue enrichment from FETCH | `api/retry` |
| 3 | GET | `/search?q=` | JWT | hybrid FTS + pgvector search | — |
| 3 | GET | `/me` | JWT | profile + quota state | — |
| 4 | POST | `/meta/webhook` | X-Hub-Signature-256 | Door 2 IG DM bot | — |
| — | GET | `/healthz` | none | liveness for Fly/Cloud Run probes | — |

Conventions: `4xx` = user's problem (quota, bad URL, rate limit), `5xx` = ours;
errors as `{"error": {"code": "...", "message": "..."}}`; every list endpoint
keyset-paginates, never offset. Quota and rate-limit checks happen **inside
POST /saves next to the insert** (Postgres count — no Redis at v1,
PIPELINE.md §3).

---

## 6. Worker (Part 1 skeleton, Parts 2–3 fill the stages)

Staged state machine per `PIPELINE.md` §5: `resolve → fetch → transcribe →
vision → structure → finalize`, progress persisted in `jobs.stage` so retries
resume from the last good stage.

- **Part 1 (now):** claim loop (`claim_job()` RPC — FIFO + per-user in-flight
  cap, `FOR UPDATE SKIP LOCKED`), RESOLVE stage (follow `/share/` redirect →
  shortcode; `reel_content` cache-hit jump to FINALIZE), finalize stub,
  backoff/DLQ/stuck-sweep. The loop is real; later stages are registered
  no-op stubs so the end-to-end path works from day one.
- **Part 2:** FETCH (provider chain) + TRANSCRIBE (Groq, conditional) +
  STRUCTURE (Gemini, pydantic `StructuredReel`, `likely_queries`, golden-set
  pytest as the quality gate).
- **Part 3:** VISION (keyframes → on-screen text, only if no speech AND caption
  weak), per-user embedding = card + note, hybrid search, deliver jobs.

Async note: all I/O in `httpx.AsyncClient` with connection reuse and explicit
timeouts on every external call — a hung upstream must fail the stage, not
hang the worker.

Trust rule (PIPELINE.md §8): client-supplied caption/transcript never enters
shared `reel_content` unless validated; prefer server-fetched data.

---

## 7. Deployment

- **One Docker image, two containers**: `uvicorn app.main:app` and
  `python -m app.worker` (same image, different command) → Fly.io or Cloud Run.
- Health probes on `/healthz`; worker liveness = heartbeat in the jobs table.
- Secrets via platform env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_JWT_AUDIENCE`, `GROQ_API_KEY` (Part 2), `GEMINI_API_KEY` (Part 2),
  `META_APP_SECRET` (Part 4).
- Config via `pydantic-settings` — fail fast at boot on missing keys
  (mirrors `website/src/lib/config.ts` behavior).

---

## 10. Port-and-delete checklist (definition of done)

**Part 1 (coded now):**
- [x] Migration 0003 applied (reel_content, reels rework, jobs/metrics, RLS, RPCs) — dev project, 2026-10-04
- [ ] `/saves` POST returns < 150ms p95 (catch only — no Instagram, no AI inline)
- [ ] `/saves` GET (keyset) + PATCH note
- [ ] Worker loop claims via `claim_job()`, RESOLVE runs, cache-hit path reaches FINALIZE stub
- [x] Double share = no-op (unique index), quota enforced via Postgres count
- [x] URL tests + RESOLVE tests pass

**Parts 2–4:**
- [ ] Worker processes a shared reel end-to-end: fetch → transcribe → vision → structure → finalize
- [ ] Golden-set pytest passes ≥ current Node quality
- [ ] IG DM bot door (Meta webhook, X-Hub-Signature-256)
- [ ] Google + magic-link sign-in working on web; Google on Android
- [ ] RLS verified: user A cannot read user B's saves (test with two JWTs)
- [ ] Hybrid search live; success criteria from PIPELINE.md §10 tracked
- [ ] `website/` Node backend deleted; docs updated to Python
