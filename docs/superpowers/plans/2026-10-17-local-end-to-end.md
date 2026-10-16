# Lately — local end-to-end build (share a reel → card → search)

**Goal:** on this PC, a reel shared into the app is saved, the worker builds its card
in the background (fetch → transcribe → structure → finalize → embed), and the saved
pool can be searched by meaning, keyword or fuzzy text. Everything runs locally against
the dev Supabase project; nothing is pushed.

**Audit (2026-10-17) — what is already true**
- Dev DB (`postgres` on project `jsvgezmgvwnldcnrjdzg`) carries every migration
  0001–0010: its schema matches a fresh `make_test_db` build exactly.
- The live chain works from this PC: Instagram's embed page returns caption, handle,
  thumbnail and video URL; the OpenRouter free model returns a valid card (with the
  thumbnail as image input) in ~35 s.
- Google is enabled in Supabase Auth, the Google OAuth client is valid (Google shows its
  sign-in page for it). Supabase does not validate `redirect_to` until the callback, so
  the redirect allow-list can only be checked in the dashboard.

**Gaps found**
1. `TEST_DATABASE_URL` points at the dev database, so any test run wipes dev data.
2. `scripts/debug.py` stage check predates the `embed`/`export` job kinds (false FAIL)
   and its help still says port 8000 (the API runs on 8001).
3. `scripts/enrich_one.py` crashes printing emoji on a Windows console.
4. No service-role key → thumbnails keep Instagram's signed CDN URL, which expires in
   days → every card loses its image.
5. No launch entry for the worker; no one-command way to run API + worker.
6. Phone builds point the API at `localhost` (unreachable from a phone); the PC's Wi-Fi
   IP has to be typed into `.env` and changes with the network.
7. No live end-to-end check that drives the real API, worker and search together.

## Phase 1 — local dev safety and tooling
1. Point `TEST_DATABASE_URL` (local `.env` only) at `lately_test_e2e`.
2. Confirm `lately_test_e2e` carries 0001–0010 (`make_test_db`).
3. Run one fast test file against it to prove the switch.
4. `debug.py`: the stage check knows the separate `embed` and `export` job kinds.
5. `debug.py`: help text and examples use port 8001.
6. `enrich_one.py`: UTF-8 stdout on Windows.
7. Add a `backend-worker` launch configuration.
8. Add `scripts/dev.py`: starts API + worker together, one Ctrl+C stops both.
9. Re-run `debug.py --live`: all PASS.
10. Commit.

## Phase 2 — thumbnails that don't expire (no service-role key needed)
1. Migration 0011: `public.thumbnails (shortcode pk, data bytea, content_type, created_at)`,
   RLS on, no client policies (served only through the API).
2. `ThumbnailStore`: with no service-role key, store the verified image bytes in the
   table and return `db:{shortcode}` as `thumbnail_path`.
3. Never store bytes that aren't an image or exceed the size cap (same rules as Storage).
4. `saves_view.thumbnail_url`: `db:{sc}` → `/thumbnails/{sc}.jpg` (API-relative).
5. `GET /thumbnails/{shortcode}.jpg`: public, long cache headers, 404 when missing.
6. STRUCTURE's image input reads `db:` thumbnails straight from the table.
7. The app resolves API-relative thumbnail URLs against its API base URL.
8. Tests: store fallback, route, view mapping, app URL resolution.
9. Apply 0011 to the dev DB and the test DB.
10. Commit.

## Phase 3 — live end-to-end harness (`scripts/e2e_live.py`)
1. Refuse any `DATABASE_URL` that mentions prod.
2. Use a dedicated dev user (`e2e@lately.test`) created in the dev DB's auth schema.
3. Drive the real FastAPI app in-process; identity is the dev user (token checks are
   covered by the unit tests; this harness tests everything after them).
4. `POST /saves` for each URL in a list file.
5. Run the real worker loop in-process until the queue drains or a timeout.
6. Print a per-reel table: status, source, title, category, seconds.
7. Run a list of search queries through `GET /search` and print the top results.
8. Optional `--expect` file: query → shortcode that must be in the top 3 (exit 1 if not).
9. `--reset` removes only the e2e user's saves.
10. Commit.

## Phase 4 — run a real pool through the pipeline
1. Pool: 23 public reels (food, fitness, nature, tech).
2. Run the harness on 3 reels first; inspect the cards.
3. Fix any stage failure found (each with a regression test).
4. Run the rest of the pool.
5. Check every save ends `enriched` (or `partial` with a reason).
6. Check thumbnails are `db:` paths and the route serves real JPEGs.
7. Check embed jobs ran and `reels.embedding` is set.
8. Check metrics rows per stage and the share → card time.
9. Re-save one reel: duplicate is a no-op; a second user hits the cache.
10. Note the provider budgets used (OpenRouter free has a daily cap).

## Phase 5 — search over the pool
1. Write 12 queries with known answers (English, Hinglish, typos, vague).
2. Run them through `GET /search`; record the top-3 hits.
3. Check the meaning leg (embedding) ran, not only keyword/fuzzy.
4. Check category filter and empty-query behaviour.
5. Fix wrong rankings found (with tests).
6. Check the "why it matched" text is sensible.
7. Save the expectations as the harness `--expect` file.
8. Re-run until all pass.
9. Check latency per query.
10. Commit.

## Phase 6 — the app in live mode on the local backend
1. In Expo Go / dev builds, a `localhost` API URL is replaced with the dev machine's host
   (from the Metro host the app was loaded from), so the phone reaches port 8001 on any
   network.
2. Tests for that resolution.
3. The `.env` comment says the IP no longer needs typing.
4. Check the share sheet → `POST /saves` → pending card → polling → ready card path.
5. Check search screen calls `/search` live.
6. Check thumbnails render from the API route.
7. jest, tsc, lint green.
8. Web live build loads without errors against the local API.
9. Update `frontend/README.md` run steps.
10. Commit.

## Phase 7 — Google sign-in
1. Code review of the native and web OAuth paths (PKCE verifier storage, redirect
   dedupe, auth-callback route).
2. Fix defects found, with tests.
3. A sign-in that ends on the wrong page (redirect not allow-listed) shows a message
   naming the redirect URL to add, instead of a silent "cancelled".
4. `docs/auth-setup.md`: a troubleshooting table (symptom → dashboard fix).
5. Tests green.
6. Commit.

## Phase 8 — finish
1. Full backend suite (in chunks) against the test DB.
2. Frontend jest, tsc, lint.
3. Final harness run on the whole pool with `--expect`.
4. `SETUP.md`: run-it-locally section (one command).
5. Commit locally; do not push.
