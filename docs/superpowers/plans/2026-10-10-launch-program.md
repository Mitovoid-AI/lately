# Lately — Launch Program (everything working end to end, Play Store ready)

**Goal:** a signed Android build that a stranger can install, sign in, share an
Instagram reel into, get a real card within ~30 s, find it again by search, and
organise it into stacks — with the backend deployable to the cloud.

**Specs (binding):** `PIPELINE.md`, `BACKEND.md`, `SEARCH.md`, `INFRASTRUCTURE.md`,
`frontend/src/api/contract.ts` (the API contract — the app is the consumer; the
backend matches it, not the other way round).

## Workstreams (wave 1 runs in parallel, each in its own git worktree)

| WS | Owner | Scope | Owns (only it edits) | Migration |
|---|---|---|---|---|
| **S** search | agent | Phase 1 Tasks 4–6 (`docs/superpowers/plans/2026-10-03-phase1-search-v1.md`) + review gap 1 (keyword/fuzzy run concurrently with the query embedding; meaning leg merged in Python, same RRF weights) | `app/search/*` (except `seed.py`, `embed.py` — extend only), `app/routers/search.py`, `scripts/eval_search.py`, `tests/search/*`, `tests/db/test_search_*`, `tests/api/test_search_api.py` | none |
| **A** app API | agent | every contract endpoint not yet live: `GET/DELETE /saves/{id}`, `GET /saves` returning `SaveOut` (+ `category` filter), `PATCH /saves/{id}` returning `SaveOut` and enqueuing an `embed` job, `GET/PATCH /me/preferences`, stacks (`GET/POST /stacks`, `GET /stacks/{id}`, `POST /stacks/{id}/saves`, `DELETE /stacks/{id}/saves/{save_id}`), `GET /curated`, `POST /me/export` (202), `POST /retries/{reel_id}`, `GET /admin/health` (service-key header), `DELETE /me` (account deletion — Play Store requirement) | `app/routers/{saves,me,stacks,curated,admin}.py`, `app/models.py`, `tests/api/*` (except search), `tests/db/test_app_*` | `0006_app_features.sql` |
| **E** enrichment | agent | Phase 2: FETCH provider chain, TRANSCRIBE (Groq), STRUCTURE (OpenRouter, strict JSON), VISION pass-through (thumbnail goes into STRUCTURE), FINALIZE (writes card, `refresh_search_columns`, per-user embeddings via `embed` jobs), `embed` job kind, Postgres provider budget (review gap 2), `scripts/enrich_one.py`, `scripts/reembed.py` | `app/enrich/*`, `app/worker/*`, `tests/enrich/*`, `tests/worker/*` | `0007_enrichment.sql` |
| **F** app | agent | finish the 2026-10-04 fix pass (14 RED tests), make every endpoint live (`LIVE_ENDPOINTS` = all), Android share intent (receive text from Instagram's share sheet → save sheet), offline save queue, delete-save + delete-account UI, Android release config (package id, icons, adaptive icon, versionCode), privacy policy + terms screens/links | `frontend/**` | — |

**Shared files** (`app/main.py`, `app/deps.py`, `app/config.py`, `backend/.env.example`,
`tests/conftest.py`): each workstream may add lines (router include, a dependency, a
setting, a fixture) but never rewrites existing lines. The controller merges.

**Already on `qa`:** `app/services/saves_view.py` — `SaveOut`, `SaveDetailOut`,
`fetch_saves(db, user_id, ids)`, `fetch_save_detail(...)`. S and A both build
responses from it; do not redefine the shapes.

## Rules for every workstream

- TDD: failing test first, watch it fail, then implement. Commit per task with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test DB:** your own isolated database (`lately_test_<ws>`). Copy
  `Z:/TO DO/codes/saas/reel-2-list/backend/.env` into your worktree's `backend/.env`
  and change only the database name at the end of `TEST_DATABASE_URL`
  (`.../postgres` → `.../lately_test_<ws>`). After adding a migration, re-run
  `python scripts/make_test_db.py lately_test_<ws>` (re-applies all migrations).
  Never point tests at `/postgres`.
- **Python:** `Z:/TO DO/codes/saas/reel-2-list/backend/.venv/Scripts/python.exe`,
  run from your worktree's `backend/` (`-m pytest`, `-m ruff check app tests scripts`).
  New dependencies: add to `requirements.txt` + `pyproject.toml`, install into that venv.
- **No paid API calls.** Tests use fakes (`FakeEmbedder`, `httpx.MockTransport`).
  Never call OpenAI embeddings for real. OpenRouter `:free` / Groq free tier: at
  most 5 live calls total, only in a final smoke step.
- Never push. Never write to the cloud `postgres` database. No secrets in commits.
- Frontend: `npx jest`, `npx tsc --noEmit`, `npx expo lint` must be green.

## Wave 2 (controller, after merging wave 1)

1. Merge S, A, E, F into `qa`; full backend suite + frontend suite green.
2. Deploy kit: `backend/Dockerfile`, `fly.toml` (api + worker), `docs/deploy.md`.
3. Device-side fetch (removes the home-IP dependency): the app sends caption +
   thumbnail URL it can see at share time; server validates before trusting (trust rule).
4. Release build: `eas.json` + local Gradle release build → `app-release.aab`/`.apk`.
5. Store kit: listing copy, data-safety answers, privacy policy page, screenshots list.
6. Whole-branch review, fix pass, then hand the founder the checklist of steps
   only they can do (Play Console account, signing key custody, Supabase dashboard
   auth settings, API keys in Fly secrets, payments).
