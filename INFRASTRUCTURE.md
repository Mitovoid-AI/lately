# Lately — Infrastructure Plan for 1M Users

**Deep-researched scaling plan for the existing stack.** This is the backend-first
blueprint: build this, then wrap the app/frontend around it. The product principle
that must survive every stage is in `PLAN.md` §2 and it does not change with scale:
**capture must never fail.**

---

## 0. What the project is today (so the plan has a baseline)
~
Two thin clients — a web app + Telegram bot (`website/`) and an Android app
(`app/`) — write Instagram reel saves into one Supabase Postgres. Every save is a
row with `status: pending|enriched|partial`. Enrichment is a three-step pipeline:
fetch the reel page (`fetchReel.ts`), transcribe audio (`transcribe.ts`, Groq
Whisper), structure it (`structure.ts`, Gemini Flash, Zod-validated). Search is a
Postgres `tsvector` generated column + GIN index. Identity is Telegram-based with
an opaque session token in a `sessions` table; all D~B access is server-side via
`service_role` (RLS denies anon/authenticated entirely, migration `0002`).

**What this codebase gets right for scale, and you should keep:**
- Capture decoupled from enrichment (`status` column, enrichment allowed to fail
  and retry). This *is* a queue-shaped design already.
- Server-side-only DB access through one data layer (`reels.ts`) — every query
  filtered by `user_id`. When you add caching/replicas, there is one choke point.
- Service-role isolation + closed RLS. Many apps retrofit this; you have it.
- Parser versioning mindset (`PARSER_VERSION`), degradations instead of crashes.

**What breaks first at scale (verified against the current code):**

| # | Bottleneck | Where it is today | Why it breaks |
|---|---|---|---|
| 1 | Enrichment runs **inline in the request** | `api/save/route.ts` line 26: `await enrichReel(...)` | A save request holds the HTTP connection for 5–15s across two external APIs. At concurrency, your serverless function pool and Supabase connection pool saturate; saves time out. Violates capture-never-fails under load. |
| 2 | Single Postgres does **OLTP + queue + search + sessions** | whole DB | FTS + HNSW (when added) + writes share compute. Also single-region — user in Brazil is ~300ms+ away from Mumbai. |
| 3 | Long-polling Telegram bot | `scripts/bot.ts` | Long polling cannot receive webhooks from Telegram at scale; one process = one consumer; you cannot horizontally scale it. |
| 4 | Opaque session tokens in Postgres checked **on every request** | `sessions` table | Every API route does a token lookup — at 1M users that's an extra PK read on the hottest path. Fine until ~100k DAU, then it's real load. |
| 5 | `search_vector` recomputed on **every row update** | migration `0001` (generated column) | Every enrichment write-back re-tokenises the whole transcript/caption. Wasted CPU at millions of rows. |
| 6 | No rate limiting, no quota enforcement | nowhere in code | `profiles.saves_this_month` exists but nothing enforces it. First viral spike = open wallet drain on Groq/Gemini. |
| 7 | `listReels` paginates by nothing | `reels.ts` `listReels()` | `select("*").order(created_at desc)` with no limit. Fine for 100 rows; catastrophic for 10k saves per user. |

Everything below is sequenced to fix these in the order they'll actually hurt.

---

## 1. Target architecture at 1M users (the picture to build toward)

```
                        ┌──────────────────────────────┐
   Instagram share ──▶  │  Clients: Android app (RN),  │
   (on-device fetch)    │  Web (Next.js), Telegram     │
                        └──────────────┬───────────────┘
                                       │  HTTPS + short-lived JWT
                        ┌──────────────▼───────────────┐
                        │   Edge / API layer (stateless)│   ← Fly.io / Cloud Run,
                        │   Next.js API + bot webhook   │     autoscaled, N replicas
                        └──────┬───────────────┬───────┘
                               │               │
                    write save │               │ enqueue job
                               ▼               ▼
                     ┌──────────────┐   ┌─────────────────────┐
                     │   Postgres   │   │  Queue (pgmq on     │
                     │  (primary,   │   │  same PG, managed   │
                     │   pooled)    │◀──│  later)             │
                     └──────┬───────┘   └──────────┬──────────┘
                            │                      │ consume
                            │                      ▼
                            │           ┌─────────────────────────┐
                            │           │  Enrichment workers     │
                            │           │  fetch → Whisper → LLM  │
                            │           │  (horizontally scaled)  │
                            │           └─────────────────────────┘
                            │
        ┌───────────────────┼──────────────────────┬─────────────────┐
        ▼                   ▼                      ▼                 ▼
 ┌─────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌──────────────┐
 │ Read replica │   │ Object storage   │   │ Redis        │   │ Embeddings + │
 │ (search read │   │ (thumbnails via  │   │ (sessions,   │   │ pgvector on  │
 │  traffic)    │   │  Supabase/Cf R2) │   │  cache, RL)  │   │ replica      │
 └─────────────┘   └──────────────────┘   └──────────────┘   └──────────────┘
```

Key idea: the **write path stays one Postgres** (it's write-light: a save is one
insert). The **read and AI paths fan out**. You do not shard Postgres, ever, in
this plan — sharding is the thing you do when you've outgrown 1M users, and it
destroys the simplicity that lets a small team operate this.

**Load math to sanity-check the target** (assumptions stated so you can dispute
them): 1M registered users, ~15% DAU = 150k daily actives, ~5 saves/DAU =
**750k saves/day ≈ 9 saves/sec average, 10× peak ≈ 90/s**. Search is the hotter
path: 150k users × 10 searches = 1.5M searches/day ≈ 17/s avg, ~170/s peak.
One well-indexed Postgres handles both easily; the reason the architecture above
still exists is *isolation* (AI spikes must never stall saves) and *geography*,
not raw TPS.

---

## 2. Stage-by-stage plan

Stages are gated by load, not dates. Don't skip ahead — each stage exists because
the previous one's bottleneck becomes measurable.

### Stage 0 — Harden what exists (do now, before any load)
*Cost: ~$25/mo. Prereq for every other stage.*

1. **Pull enrichment out of the request.** `api/save/route.ts` should insert with
   `status: 'pending'` and return immediately. Enrichment moves to a job.
   Even before a real queue exists: a small `jobs` table + a worker script
   (`SELECT ... FOR UPDATE SKIP LOCKED`) running on Fly/Render, one process.
   This is Stage 1's skeleton — write it once, scale it later.
2. **Keyset pagination** in `listReels` (`created_at + id` cursor, limit 25–50).
   Also add `limit` to the bot's list path.
3. **Enforce quota** — `profiles.saves_this_month` is already written; check it in
   `saveReel` and return a clean "monthly limit reached" error. Add per-user
   rate limits (Redis token bucket, e.g. 30 saves/hour) at the API layer.
4. **Move parser/caption fetch behind a flag** so enrichment can degrade to
   caption-only when Instagram blocks a datacenter IP (which it will — see §4).
5. **Backups**: Supabase PITR add-on. Untestable without this.

### Stage 1 — 1k → 10k users: the queue becomes real
*Cost: ~$50–100/mo (Supabase Pro + small worker).*

1. **Supabase Pro plan** — needed for: no project pausing, compute upgrades,
   PITR, and (importantly) `pgmq` via Supabase Queues.
2. **Enrichment workers on Fly.io** (or Cloud Run). Same Node code as today —
   `enrich.ts` is already a pure function of `reel.id` — packaged as a worker
   container consuming from `pgmq` (or `pg-boss`, same thing conceptually).
   Scale rule: **one worker per ~0.5 enrichments/sec**, autoscale on queue depth.
3. **Connection pooling via Supavisor** in transaction mode for all serverless /
   API traffic. Direct connections only for the worker's long transactions.
   Prepares you for Stage 3's replica split.
4. **Structured failures**: `failure_reason` enum + a dead-letter queue so a
   poisoned job (e.g. a reel that always 404s) can't spin forever. Add a small
   admin endpoint to re-drive DLQ jobs.
5. **Webhook-based Telegram bot** on the same API server. Kill long polling.
   Telegram sends an HTTPS POST per message → you verify → enqueue enrichment →
   return 200 in <100ms. This alone lets the bot layer scale horizontally.
6. **Uptime + alerting**: Better Stack / Grafana Cloud free tiers; alert on queue
   depth > 500, enrichment error rate > 5%, DB CPU > 70%.

### Stage 2 — 10k → 100k users: caching + read scaling
*Cost: ~$300–500/mo.*

1. **Redis** (Upstash or Fly Redis): (a) sessions — `sessions` table becomes
   write-through cache, TTL = session expiry, API reads session from Redis
   first; (b) hot-read cache for `listReels` first page per user (60s TTL);
   (c) rate-limit counters. Sessions in Redis removes the hottest PK lookup.
2. **Read replica** (Supabase read replica add-on): point **search and list
   reads** at it; keep writes + queue on primary. The single choke-point data
   layer (`reels.ts`) makes this a `db()` parameter, not a rewrite.
3. **Compute upgrade** on primary when DB CPU > 60% sustained, not before.
4. **CDN everything static**: Next.js on Vercel/Fly behind Cloudflare; thumbnails
   already come from Instagram's CDN (you're only storing paths — keep it that
   way, see §4).
5. **Observability upgrade**: OpenTelemetry traces on the enrichment pipeline
   (each span = one stage), so you can see *which* stage is failing when error
   rate rises. Sentry for exceptions.

### Stage 3 — 100k → 1M users: geographic + semantic scale
*Cost: ~$1.5–3k/mo (still <1% of revenue at this point).*

1. **pgvector + HNSW** for semantic search — as a **complement** to FTS, not a
   replacement. Hybrid search (FTS ∪ vector, reciprocal-rank-fused) is the
   quality bar users actually feel. Embeddings generated in the enrichment
   worker (one extra API call, ~$0.0001/save). **Caveat from research:** HNSW
   RAM is the constraint, not TPS — budget ~1–2GB per million vectors at 768
   dims, keep the index on a memory-optimised replica, and consider
   `pgvectorscale` if recall drops.
2. **Regional read replicas** (Supabase supports read replicas in other regions):
   US + EU replicas for read traffic, single write region stays Mumbai (or move
   primary to US if that's where traffic concentrates — pick by measuring, then
   commit; cross-region writes are not in this plan's future, they add
   distributed-consensus complexity no small team wants).
3. **Supavisor pool size tuning** + verify every serverless route uses pooled
   connections, workers use direct ones.
4. **Partitioning** `reels` by `created_at` month (declarative range
   partitioning) once the table passes ~50–100M rows. This is a rewrite of the
   table, so do it in a maintenance window; with 1M users × ~2k saves avg you'll
   cross 2B rows only at the *very* top of this stage.
5. **Viral-spike defense**: the rate limits from Stage 0, plus a queue-depth
   circuit breaker — if enrichment backlog > 30 min, enrichment degrades to
   caption-only (fast path) and full processing catches up later. Capture stays
   instant; enrichment quality degrades gracefully instead of the pipeline
   collapsing.

### Stage 4 — Beyond 1M (only if you get there)
Sharding, multi-region writes, dedicated search cluster (Typesense/Qdrant),
Kafka-class queue. Listed only so you know it's not now.

---

## 3. Cost model (researched Sept 2026)

| Stage | Users | Supabase | Workers/hosts | Redis | AI usage* | Total/mo |
|---|---|---|---|---|---|---|
| 0 | 0–1k | $0 (free) | $0 (local) | $0 | $0 (free tiers) | **~$0** |
| 1 | 1k–10k | $25 (Pro) | ~$10 (1–2 workers) | $0 (free Upstash) | ~$10 | **~$50** |
| 2 | 10k–100k | $25–120 | ~$30 (4–8 workers) | ~$10 | ~$100 | **~$300** |
| 3 | 100k–1M | $300–1,000 (compute + replicas) | ~$100 (10–20 workers) | ~$50 | ~$1,000 | **~$1.5–2.5k** |

\* AI math, verified against current pricing (Sept 2026): Groq
`whisper-large-v3-turbo` ≈ **$0.04/audio-hour**; a reel averages ~45s audio →
~$0.0005/save. Gemini Flash-class ≈ **$0.10/1M input, $0.40/1M output tokens**;
a card (caption + transcript in, ~300 tokens out) ≈ ~$0.0003/save. Embeddings
≈ $0.00002/save. **Total ≈ $0.0008/save enriched.** At 750k saves/day that's
**~$600/mo** — the single largest line item at scale, and the reason the free
tier must end at 20 saves/month *with enforced quota* (Stage 0, item 3). A
typical free user at 20 saves/mo costs you $0.016/mo — fine. A power user at
2,000 saves/mo costs $1.60/mo — still fine against $4 Pro. The danger is abuse,
not average users.

Three cost rules:
1. **Transcription is the expensive step** — make it conditional: skip Whisper
   when caption alone yields a confident structure (the LLM call is 40% cheaper
   than whisper+LLM). Reels that are text-on-screen with no speech waste money.
2. **Batch API at 50% off** for retries/backfills (Groq and Gemini both support
   batch endpoints) — retries are exactly where money leaks at scale.
3. **Free tier = 20 saves/month, enforced server-side.** Never trust client
   enforcement; the quota check lives in `saveReel` next to the insert.

---

## 4. The constraint that doesn't scale away: Instagram

Everything in §2 assumed enrichment can fetch reels. Re-read `PLAN.md` §0 and §4:
Instagram blocks datacenter IPs aggressively. Your current `fetchReel.ts` works
from a home laptop and **will fail from Fly/Cloud Run within days**. This is the
hardest scaling constraint in the whole plan and no amount of money in Stage 3
fixes it cleanly.

The architecture already has the right answer — **fetch on-device** — and the
infrastructure plan is to finish that migration:

1. Move `fetchReel.ts` logic into the Android app (it already has the
   user's residential IP and session context). The app sends caption + a signed
   upload of the audio (or transcript) to the backend. Backend enrichment then
   starts from data it already has, no Instagram fetch needed.
2. For Telegram/web users (no on-device fetch possible), enrichment degrades to
   caption-only. That's already your `partial` state — it's a *feature*, not a
   failure; the UI should sell it as "fast save, full card needs the app."
3. Proxy pools are the wrong move at this stage: residential proxies cost more
   than the entire Stage-3 infra budget and are a Meta-ToS liability multiplier.
   If it ever comes to that, revisit at revenue, with the lawyer conversation
   from `PLAN.md` §4 first.
4. `PARSER_VERSION` remote config: keep the on-device parser versioned and
   remotely configurable (Supabase table the app polls), so an Instagram HTML
   change is a config push, not an app-store release cycle.

**ToS note (unchanged from PLAN.md, still true at 1M users):** never re-host
video, store only thumbnails + permalinks, keep derived text only, and make
users responsible for what they submit. At 1M users this is a real legal surface,
not a footnote.

---

## 5. Data model changes for scale (migration sketches)

Ordered; each is small. Run as numbered migrations when the stage that needs them
arrives — not before.

```sql
-- Stage 0/1: jobs (if not using pgmq/Supabase Queues)
create table if not exists jobs (
  id uuid primary key default uuid_generate_v4(),
  kind text not null,                    -- 'enrich' | 'embed' | 'digest'
  payload jsonb not null,                -- { reel_id }
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 3,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index jobs_due_idx on jobs (run_at) where locked_at is null;
-- Worker claims with: select ... where locked_at is null and run_at <= now()
--   order by run_at limit 1 for update skip locked;

-- Stage 0: enforce the quotas that already exist
alter table public.profiles
  add column if not exists saves_free_limit int not null default 20;

-- Stage 1: dead-letter storage
create table if not exists jobs_dead (
  id uuid primary key,
  kind text, payload jsonb, last_error text,
  failed_at timestamptz default now()
);

-- Stage 2: Redis-off fallback is the sessions table; no schema change.
-- Stage 3: embeddings + hybrid search
alter table public.reels
  add column if not exists embedding vector(768);
create index if not exists reels_embedding_idx
  on public.reels using hnsw (embedding vector_cosine_ops);

-- Stage 3: move search_vector from a generated column to a trigger so
-- enrichment write-backs don't re-tokenise transcripts on every update.
-- (Write as 0003_search_vector_trigger.sql when you get there.)
```

Other changes, by stage:
- **Stage 1:** add `enrichment_started_at` to `reels` (queue observability),
  an index on `(status, run_at)` for stuck-job sweeps.
- **Stage 2:** `reels_user_created_idx` is your workhorse — verify it's used for
  the keyset cursor (`where user_id = ? and (created_at, id) < (?, ?)`).
- **Stage 3:** monthly partitions on `reels(created_at)`; archive `partial`
  cards older than 12 months to cold storage if the table gets huge.

---

## 6. The 1M-user checklist (what "ready" means)

Measured, not aspirational — each of these has a number:

- [ ] Save p99 < 200ms, **independent of enrichment** (enrichment is async)
- [ ] Enrichment p95 < 60s under peak load; backlog < 5 min at steady state
- [ ] Search p95 < 300ms on the replica at 170 queries/s
- [ ] Queue depth alert wired; DLQ re-drive tested with a poisoned job
- [ ] Enforced per-user rate limits + monthly quota (verified with a script, not trust)
- [ ] Sessions served from Redis; Postgres session lookups < 5% of DB load
- [ ] PITR backups tested by an actual restore, not assumed
- [ ] On-device fetch ships; server-side Instagram fetch is fallback-only
- [ ] AI cost per save measured weekly; batch API used for retries
- [ ] Read replica lag < 5s (search results can be slightly stale; saves cannot)
- [ ] Load test at 3× projected peak before any viral moment (k6 script against
      save + search endpoints, run from multiple regions)

---

## 7. What NOT to build (equally important)

- **No Kubernetes.** Fly.io/Cloud Run autoscale containers fine at this scale.
- **No microservices.** One API server + one worker container + Postgres + Redis
  is the whole system. Split only when a component's scaling needs *conflict*,
  which at 1M users they mostly don't.
- **No sharding Postgres.** Vertical scaling + replicas + partitioning covers
  1M users with 100× headroom (OpenAI famously ran 800M users on a single
  Postgres before sharding — it's a late-stage tool, not a stage-1 one).
- **No event-sourcing, no CQRS, no service mesh, no GraphQL gateway.** Every one
  of these is a tax paid before its benefit exists at this size.
- **No React Native rewrite of the web app** or any frontend consolidation yet —
  the user's plan is backend-first, wrapper-app later; the current clients are
  thin enough that the backend plan above doesn't constrain them.

---

## 8. Immediate next actions (this week)

1. **Split capture from enrichment** — remove `await enrichReel(...)` from
   `api/save/route.ts`, insert `pending`, return. Add the `jobs` table + a worker
   script. *(Highest leverage single change in this document.)*
2. Add **keyset pagination** to `listReels`.
3. Add **quota + rate-limit enforcement** in `saveReel`.
4. Start the **on-device fetch migration** in `app/` (Phase 1 step 4 from
   `PLAN.md` — it's the same work, now justified twice: product reason in PLAN,
   infrastructure reason here).
5. Supabase **Pro plan + PITR** once the first real users land.
