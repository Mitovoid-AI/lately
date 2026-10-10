# Lately — Reel Processing Pipeline (canonical architecture)

> **Source of truth:** the architecture diagram supplied by the founder
> (reproduced in §10). This doc is the implementation contract for how thousands
> of shared reels become structured cards. `INFRASTRUCTURE.md` covers platform
> scaling; `BACKEND.md` covers the Python implementation.

---

## 1. Goal

Shared Instagram reel → searchable card, including the user's "why" note.

Stack assumptions: Supabase Postgres (`jobs` table, pgvector, tsvector), FastAPI
API routes, stateless worker process(es).

## 2. Doors

| Door | When | Notes |
|---|---|---|
| **1. Android share sheet** | **build first** | receives URL text only |
| **2. IG DM bot** | later | Creator account + Meta webhook + one-time link code; payloads trusted only after `X-Hub-Signature-256` verification |
| Clipboard, iOS share ext, Telegram, WhatsApp, bulk import | later | |

**All doors converge on one function:** `saveReel(userId, text, channel)`.

## 3. CATCH (sync, ~100ms, never touches Instagram or AI)

1. Extract URL from text, strip tracking params
2. Shortcode from URL if present (else null — `/share/` shortlinks resolve later)
3. Check quota + rate limit (Postgres count)
4. INSERT `reels` row, `status=pending`; `unique(user_id, shortcode)` → double
   share is a no-op
5. Enqueue job `{kind: enrich, reel_id, stage: resolve}`
6. Return ok → UI shows "Saved" + optional "why?" note, sent as a follow-up
   PATCH (skippable)

Offline (app door): queue locally in the app, retry when online.

## 4. QUEUE — Postgres `jobs` table

- Columns: `id, payload, stage, attempts, run_at, locked_at`
- Claim = `UPDATE … FOR UPDATE SKIP LOCKED` (atomic)
- **Plain FIFO + per-user in-flight cap.** Fair round-robin is DEFERRED until
  real load (see §9).

## 5. WORKER — stateless, resumable, progress saved per stage

| Stage | What happens |
|---|---|
| **1 RESOLVE** | URL → shortcode (follow `/share/` redirect). If `reel_content.media_status == 'ready'` → jump straight to FINALIZE (cache hit). |
| **2 FETCH** | Provider chain: (later) on-device data → scraper API by URL → oEmbed / caption-only → give up: `media_status=partial` |
| | Built: this save's device hint (`DeviceHintProvider`, see §8 trust rule) → embed page → yt-dlp → scraper API → give up |
| **3 TRANSCRIBE** | audio only (**costly**). Skip if partial OR caption strong |
| **4 VISION** | 2–3 keyframes → on-screen text (**costly**). Only if no speech AND caption weak |
| **5 STRUCTURE** | ONE LLM call → validated JSON: `title, summary, category, tags, entities, steps, search_text, likely_queries` (5–8 user questions) |
| **6 FINALIZE** | write shared `reel_content` (key = shortcode); batch-mark all `reels` rows with this shortcode `enriched`; per-user embedding = card + user's note; enqueue deliver job (bot reply, if any) |

## 6. SEARCH

Query → Postgres full-text (tsvector on `search_text`) **+** pgvector similarity
(title + summary + likely_queries + user note) → hybrid rank → filter
category/tags → cards.

Full search design — indexed fields and weights, query pipeline, fuzzy /
Hinglish handling, reranking, thumbnails, golden-set evaluation: `SEARCH.md`.

## 7. Failure handling

- Stage error → retry with backoff `run_at = now() + 2^attempts minutes`, max 3
- After 3 → move to `jobs_dead` (+ `last_error`); admin re-drive
- Cron every 1 min: `locked_at < now() - 10min` → unlock, resume from stage
- **Fetch fail ≠ card fail:** card becomes `partial` (caption-only), UI asks
  for a note, retry button re-enqueues from FETCH
- User never loses a save (catch is independent of enrich)

## 8. Data model

- **`reel_content`** (shared, PK `shortcode`): `source_url, caption, transcript,
  title, summary, steps, category, tags, entities, search_text, likely_queries,
  thumbnail_path, media_status(pending|partial|ready|failed), parser_version,
  fetched_at`
- **`reels`** (per user): `id, user_id, shortcode_key → reel_content, channel,
  note, embedding, status(pending|enriched|partial), created_at`
- **`jobs` / `jobs_dead`**: as above + `stage` column
- **`metrics`**: `door, stage, duration_ms, outcome, cost`

### Trust rule
Do **not** write client-supplied caption/transcript into shared `reel_content`
unless validated; prefer server-fetched data. Meta webhook payloads are trusted
only after `X-Hub-Signature-256` verification.

**Device hints** (FETCH provider 0, migration 0009). After a save the app reads
`instagram.com/p/{sc}/embed/captioned/` from the phone (residential IP; the cloud
worker's IP is often blocked) and sends `POST /saves/{id}/hint`
`{caption, creator_handle, thumbnail_url, video_url, duration_s, shortcode}`:
- Owner only (404 otherwise), 202. Caption ≤ 5000 chars, handle
  `^[A-Za-z0-9._]{1,30}$`, duration 0..3600 (else 422); media URLs must be https
  on `*.cdninstagram.com` / `*.fbcdn.net` (default port, no credentials) or they
  are dropped. Stored on that user's save only (`reels.device_hint`); the API
  writes nothing shared. The worker re-validates it when it reads it.
- FETCH tries the save's own hint first, then the server chain. It skips the hint
  when the shared row already holds server-fetched data, and the upsert refuses
  to let device data replace server data. Content from a hint is written with
  `fetch_source = 'device'` and `device_user_id` = the supplying user.
- The thumbnail from a hint is kept only after the server downloads a real image
  from that CDN URL itself (no redirects); otherwise it is dropped.
- RESOLVE's cache hit reuses a `device` card only for the supplying user's saves.
  Anyone else's save runs FETCH: their own hint, or the server chain (a successful
  server fetch overwrites the device data and clears `device_user_id`).
- FINALIZE marks a save `enriched` only if the card is ready and trusted for that
  save's user (server-fetched, or device-sourced by that same user); otherwise
  `partial`, which the user can retry.
- A hint that arrives after FETCH: a `partial` save is re-enqueued from FETCH
  (by the hint API when no job is queued, or by FINALIZE when the hint is newer
  than the one its FETCH saw).
- Known limit: `reel_content` is shared per shortcode, so a device card written
  for user B is what another saver of the same reel sees until a server fetch
  replaces it; their save is marked `partial` (retryable), not `enriched`.

## 9. Deferred until real load

Fair round-robin claim, Redis rate limit, circuit breaker, pgmq, Supabase
Realtime, worker autoscaling.

## 10. Success criteria

- share → card < 30s
- vague query finds the reel (golden set of ~30)
- partial cards recoverable
- track: time-to-card, partial rate, cost/card

---

## 11. Build parts

- **Part 1 (this repo, `backend/`):** CATCH route + jobs queue + migration
  0003 (`reel_content`, `reels` rework, `jobs`/`jobs_dead`/`metrics`, RLS,
  `save_reel()`/`claim_job()` RPCs) + worker skeleton with RESOLVE stage.
- **Part 2:** FETCH + TRANSCRIBE + STRUCTURE stages (provider chain, Groq,
  Gemini, pydantic validation, golden-set tests).
- **Part 3:** VISION stage + hybrid search (pgvector) + deliver jobs.
- **Part 4:** Door 2 (IG DM bot via Meta webhook), more doors.
