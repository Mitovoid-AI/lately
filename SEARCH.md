# Lately — Search Design (find a reel by what you remember)

> Expands `PIPELINE.md` §6. `PIPELINE.md` stays the canonical pipeline contract;
> this doc is the detail for everything search touches: what gets indexed, how a
> query runs, how results are ranked, and how we measure it. Related:
> `BACKEND.md` (routes), `INFRASTRUCTURE.md` (scaling), `data/golden-set.csv`
> (evaluation).

---

## 1. Goal

User types what they *remember*, not what the reel *says*:

| Query | What the user means |
|---|---|
| `manali treks` | the Hampta Pass trek reel (caption never says "trek") |
| `mountain reel` | anything with mountains in it — maybe only visible, never spoken |
| `that momo cafe` | a food place; name forgotten, area maybe |
| `repo for job search` | a GitHub link mentioned on screen |
| `pahad wali reel` | Hinglish for "the mountain one" |

→ the right reel is in the **top 5**, shown as **thumbnail + title + your note +
Instagram link**, with a short "why it matched".

**Success criteria**

| Metric | Target | Measured on |
|---|---|---|
| recall@5 | ≥ 90% | golden set (§11) |
| recall@1 | ≥ 70% | golden set |
| search latency p95 (no LLM) | < 300 ms | `metrics` table, `stage='search'` |
| search latency p95 (LLM assist triggered) | < 1.5 s | same |

---

## 2. What gets saved, and when it becomes searchable

A save is searchable from the first second — by the note — and gets richer as
the worker stages complete (`PIPELINE.md` §5).

| Moment | Stored | Where | Searchable by |
|---|---|---|---|
| CATCH (t=0) | `source_url`, `shortcode`, user's "why" note, `created_at`, channel | `reels` | note, URL / handle exact match |
| FETCH | caption, creator handle, **thumbnail copied to Storage** | `reel_content` + Storage | + caption keywords |
| TRANSCRIBE | transcript | `reel_content` | + spoken words |
| VISION / STRUCTURE | `ocr_text`, `visual_description`, title, summary, category, tags, entities, `likely_queries` | `reel_content` | + on-screen text, visuals, meaning |
| FINALIZE | `tsv`, `match_text` (shared); per-user `embedding` = card + note | both | full hybrid search |

**Thumbnail rule.** Instagram CDN URLs are signed and expire within days — never
use them as the display source. Copy the image to Storage bucket `thumbnails`
at `thumbnails/{shortcode}.jpg` (public bucket: content is already public on
Instagram and the path carries no user data). The Android app may upload it at
share time when it has fetched the page on-device (`INFRASTRUCTURE.md` §4).
Never store video (ToS — `INFRASTRUCTURE.md` §4).

**Pending / partial cards** stay in results: they match on note and caption, and
show a "still processing" badge instead of hiding.

---

## 3. The search document (what is indexed per reel)

Shared fields live on `reel_content` (one row per reel, written once by
FINALIZE). The note is per user and lives on `reels`.

| Weight | Fields | Why this weight |
|---|---|---|
| **A** | title, `likely_queries`, **user's note** | closest to how people phrase recall; the note is the strongest signal we have |
| **B** | tags, entity names, category, `ocr_text` | precise names: places, products, tools, repos |
| **C** | summary, `visual_description` | what the reel is about / looks like |
| **D** | caption, transcript | long and noisy; useful, but shouldn't dominate |

**Entities** (from STRUCTURE) are typed and normalized so region queries work:

```json
[
  {"type": "place", "name": "Hampta Pass", "parent": "Manali", "region": "Himachal Pradesh", "country": "India"},
  {"type": "food",  "name": "momos"},
  {"type": "tool",  "name": "github.dev"},
  {"type": "url",   "name": "https://github.com/..."}
]
```

FINALIZE flattens names + parents + regions into `entity_names text[]` so
`himachal trips` finds the Manali reel even though the reel never says
"Himachal".

**Hinglish / synonym seeding.** The STRUCTURE prompt asks for 5–8
`likely_queries` *including common Hinglish / Hindi phrasings* where natural
(`manali trek`, `pahad trip`, `momos wali jagah`). This is doc-side query
expansion: free at query time, done once per reel.

**Embedding text** (per user, `reels.embedding`): title + summary +
`likely_queries` + tags + entity names + `visual_description` + **note**.
Re-embed when the note changes (enqueue a small `embed` job from the note
PATCH). Model: `text-embedding-3-small` via any OpenAI-compatible
`/embeddings` endpoint, requested at `dimensions=768` to match `vector(768)`,
same model for documents and queries. Provider is env-only (`EMBEDDINGS_*`),
so moving to another model is a config change plus a re-embed backfill.

---

## 4. The search toolbox

Embeddings alone are weak on rare names, typos, Hinglish, dates and personal
context. Each method covers a gap; v1 ships the first five.

| # | Method | Catches | Example | Built with | Phase |
|---|---|---|---|---|---|
| 1 | Keyword full-text (weighted) | exact names, rare words | `hampta pass`, `github.dev` | `tsvector` + `ts_rank_cd` | **v1** |
| 2 | Fuzzy / trigram | typos, Hinglish spellings | `manaali`, `momoz` | `pg_trgm` on `match_text` | **v1** |
| 3 | Embeddings | meaning, synonyms, cross-language | `mountain reel` → trek card | pgvector, exact per-user scan | **v1** |
| 4 | Structured filters | category, date saved, place | `food I saved last month` | columns + `WHERE` | **v1** (rule-parsed) |
| 5 | `likely_queries` (doc expansion) | vague recall phrasing | `repo for job search` | STRUCTURE output, weight A | **v1** |
| 6 | LLM query understanding | messy queries → text + filters | `manali trek reels from june` | small LLM, cached | v2 |
| 7 | Query expansion | words absent from card | `mountain` → himalaya, hills, snow | same LLM call / synonym table | v2 |
| 8 | Place hierarchy | region finds city | `himachal trips` | `entity_names` (§3) — v1 data, v2 filter UI | v1/v2 |
| 9 | Reranker on top-30 | final ordering | pick best 5 of 30 | cross-encoder (Cohere / Jina / Voyage hosted, or open `bge-reranker`) or LLM | v2 |
| 10 | Visual search | content only in pixels | `the blue cafe reel` | text route first (§9); image embeddings later | v1 (thumbnail) / later |
| 11 | Personal signals | which of many matches you meant | often-opened, recent | `opened_count`, `last_opened_at` | later |
| 12 | Conversational | iterative narrowing | "not the momo one, the rooftop one" | LLM calling this search as a tool | later |
| 13 | Browse (no query) | user doesn't know what to type | "Travel · Himachal (12)" | group by category / place; "similar reels" via embeddings | v2 |

**Why per-user scale changes the design.** Search is always scoped to one
user's saves — hundreds, rarely thousands. So:
- vector search is an **exact scan** of the user's rows (no HNSW: an HNSW index
  filtered by `user_id` loses recall, and exact over ~500 rows is a few ms);
- keyword / fuzzy predicates evaluate over the user's rows directly — the GIN
  indexes are optional at v1;
- expensive steps (reranker, even "send all 80 card titles to an LLM") are
  affordable as a **fallback** when cheap retrieval isn't confident.

Revisit when any user passes ~5k saves.

---

## 5. Query pipeline

```
query: "manali treks"
   │
   ├─ 1. NORMALIZE  lowercase, unaccent, drop noise words
   │                (reel, video, post, that, wo, woh, wala, wali, waala, vala)
   │
   ├─ 2. UNDERSTAND rules first: date phrases ("last week", "june"),
   │                category words ("recipe", "cafe"), place names already in
   │                THIS user's entity_names
   │                → text="manali treks"  hints={place: Manali}
   │                Guessed category/place are HINTS (boost), never filters —
   │                a wrong guess must not hide the right reel. Hard filters
   │                come only from date phrases and UI filter chips.
   │                LLM (v2) only if: > 6 words, rules found nothing, or
   │                previous attempt had low confidence. Cached by normalized query.
   │
   ├─ 3. RETRIEVE   in parallel, scoped to auth_user_id, hard filters applied
   │      ├ keyword  (tsv || note_tsv)          → top 50
   │      ├ fuzzy    (match_text, word_similarity) → top 20
   │      └ meaning  (embedding <=> query_vec)  → top 50
   │
   ├─ 4. FUSE       reciprocal rank fusion, k=60
   │                weights: keyword 1.0 · meaning 1.0 · fuzzy 0.7
   │                + hint boosts: place ∈ entity_names, category = hint
   │                → top 30
   │
   ├─ 5. RERANK (v2) only when top-1/top-2 fused margin is small or the
   │                query is long → top 10
   │
   └─ 6. RETURN     cards + match reasons
```

Query embedding is an external call (~100–300 ms): run it in parallel with the
keyword/fuzzy legs and cache by normalized query text.

### Retrieval SQL (v1)

`$1` user id · `$2` normalized query · `$3` query embedding · `$4` filters jsonb
(hard: `category` from a UI chip, `saved_after` / `saved_before` from date
phrases) · `$5` hints jsonb (soft: `category`, `place` guessed from the query)

```sql
with q as (
  select websearch_to_tsquery('english', $2) as tq
),
mine as (                                   -- the user's corpus (hundreds of rows)
  select r.id, r.embedding, r.created_at, rc.category, rc.entity_names,
         coalesce(rc.tsv, ''::tsvector) || coalesce(r.note_tsv, ''::tsvector) as doc,
         coalesce(rc.match_text, '') || ' ' || coalesce(r.note, '')          as match_text
  from public.reels r
  left join public.reel_content rc on rc.shortcode = r.shortcode_key
  where r.auth_user_id = $1
    and ($4->>'category'     is null or rc.category = $4->>'category')
    and ($4->>'saved_after'  is null or r.created_at >= ($4->>'saved_after')::timestamptz)
    and ($4->>'saved_before' is null or r.created_at <  ($4->>'saved_before')::timestamptz)
),
kw as (
  select m.id, row_number() over (order by ts_rank_cd(m.doc, q.tq) desc) as rk
  from mine m, q
  where m.doc @@ q.tq
  order by rk limit 50
),
fz as (
  select m.id, row_number() over (order by word_similarity($2, m.match_text) desc) as rk
  from mine m
  where $2 <% m.match_text
  order by rk limit 20
),
vec as (
  select m.id, row_number() over (order by m.embedding <=> $3) as rk
  from mine m
  where m.embedding is not null
  order by rk limit 50
)
fused as (
  select id, sum(w / (60 + rk)) as score, array_agg(src) as matched_by
  from (
    select id, rk, 1.0 as w, 'keyword' as src from kw
    union all select id, rk, 0.7, 'fuzzy'   from fz
    union all select id, rk, 1.0, 'meaning' from vec
  ) x
  group by id
)
select f.id,
       f.score
         + case when $5->>'place' is not null
                 and m.entity_names @> array[$5->>'place'] then 0.008 else 0 end
         + case when $5->>'category' is not null
                 and m.category = $5->>'category' then 0.008 else 0 end  as score,
       f.matched_by
from fused f join mine m using (id)
order by score desc, m.created_at desc
limit 30;
```

Hint boost `0.008` ≈ half of a rank-1 hit in one leg (`1/61`): enough to break
ties toward the guessed place/category, not enough to outrank a strong match.

The API then loads card fields for the returned ids and builds match reasons.

---

## 6. Ranking signals

| Signal | Effect | Phase |
|---|---|---|
| RRF fused score | base order | v1 |
| exact entity hit (query term ∈ `entity_names`) | boost | v1 |
| recency (`created_at`) | small boost, tie-break | v1 |
| reranker score | replaces fused order for top 30 | v2 |
| `opened_count`, `last_opened_at` | boost reels you actually return to | later |
| click on result after a query | training data for learning-to-rank | later |

---

## 7. Result card + "why it matched"

`GET /search?q=` returns, per result:

```json
{
  "reel_id": "…",
  "thumbnail_url": "https://<ref>.supabase.co/storage/v1/object/public/thumbnails/C8xYz.jpg",
  "title": "Hampta Pass trek from Manali — 5-day plan",
  "note": "do this in june",
  "source_url": "https://www.instagram.com/reel/C8xYz/",
  "category": "Travel",
  "status": "enriched",
  "matched_by": ["keyword", "meaning"],
  "why": ["📍 Manali", "your note: \"do this in june\""]
}
```

`why` comes from what matched: the entity hit, a `ts_headline` snippet from the
note or title, or the matching `likely_query`. Showing *why* is what makes a
vague search feel trustworthy.

---

## 8. Hinglish and multilingual queries

- **Noise words** (step 1) include Hinglish fillers: `wala`, `wali`, `waala`,
  `vala`, `wo`, `woh`, `jo`, `wahi`.
- **Keyword** uses the `english` config for stemming (`treks` → `trek`). Hindi
  words pass through mostly unchanged — harmless.
- **Trigram** absorbs spelling variants (`manaali`, `momoz`, `pahaad`).
- **Embeddings** are multilingual, so `pahad` lands near "mountain".
- **`likely_queries`** seed Hinglish phrasings at write time (§3).

---

## 9. Visual search

`PIPELINE.md` §5 runs VISION (keyframes → on-screen text) only when there's no
speech and the caption is weak — right for cost. But `mountain reel`-type
queries need a description of what's *visible* even when the reel has speech.

**Proposal (cheap, no extra call):** pass the **thumbnail image** into the
existing STRUCTURE LLM call (multimodal input) and add `visual_description` to
its output schema. One image adds a few hundred input tokens to a call we
already make. Keyframe VISION stays conditional for `ocr_text`.

**Later:** image embeddings (CLIP / SigLIP-style) on thumbnail + keyframes for
pure visual similarity ("more reels that look like this"). Only if the golden
set shows visual misses the text route can't fix.

---

## 10. Browse and discovery (no query)

- **Auto-collections:** group by category and top place region —
  "Travel · Himachal (12)", "Recipes (30)". Pure SQL over `reel_content`.
- **Similar reels:** nearest neighbours of a card's embedding within the
  user's saves.
- **Timeline:** keyset-paginated `GET /saves` (already built).

---

## 11. Evaluation — the golden set decides

`data/golden-set.csv` already has the right shape: `what_i_remembered_it_as` is
a real query and `reel_url` is the expected answer. Today it has 3 example rows
— fill it to **~30 real reels**, with queries written from memory a few days
after saving.

A script runs every query against every config and reports:

| Config | recall@1 | recall@5 | MRR | p95 ms |
|---|---|---|---|---|
| keyword only | | | | |
| keyword + note | | | | |
| + meaning (embeddings) | | | | |
| + fuzzy | | | | |
| + rule filters | | | | |
| + reranker (v2) | | | | |

Run it on every change to the STRUCTURE prompt, embedding text, weights, or
ranking. Add a method only when the table shows misses it would fix.

---

## 12. Schema changes (migration 0004 sketch)

```sql
create extension if not exists pg_trgm;

-- shared content: new fields + search columns written by FINALIZE
alter table public.reel_content
  add column if not exists creator_handle     text,
  add column if not exists ocr_text           text,
  add column if not exists visual_description text,
  add column if not exists entity_names       text[],
  add column if not exists match_text         text,      -- title + tags + entity_names
  add column if not exists tsv                tsvector;  -- weighted A–D (§3)

-- 0003's expression index uses array_to_string(), which Postgres marks STABLE,
-- not IMMUTABLE, so an index on it is rejected. tsv is written by FINALIZE instead.
drop index if exists public.reel_content_search_idx;
create index if not exists reel_content_trgm_idx
  on public.reel_content using gin (match_text gin_trgm_ops);

-- per-user: note is weight A, plus ranking signals
alter table public.reels
  add column if not exists note_tsv tsvector
    generated always as (setweight(to_tsvector('english', coalesce(note, '')), 'A')) stored,
  add column if not exists opened_count   int not null default 0,
  add column if not exists last_opened_at timestamptz;
```

FINALIZE writes the search columns in one statement (stable functions are fine
in an `UPDATE`; content is written once per reel, so no recompute churn —
`INFRASTRUCTURE.md` §0 bottleneck #5):

```sql
update public.reel_content set
  match_text = concat_ws(' ', title,
                 array_to_string(tags, ' '), array_to_string(entity_names, ' ')),
  tsv =
       setweight(to_tsvector('english', concat_ws(' ', title,
                   array_to_string(likely_queries, ' '))), 'A')
    || setweight(to_tsvector('english', concat_ws(' ',
                   array_to_string(tags, ' '), array_to_string(entity_names, ' '),
                   category, ocr_text)), 'B')
    || setweight(to_tsvector('english', concat_ws(' ', summary, visual_description)), 'C')
    || setweight(to_tsvector('english', concat_ws(' ', caption, transcript)), 'D')
where shortcode = $1;
```

Storage: create bucket `thumbnails` (public read, service-role write).

---

## 13. Phasing

| Phase | Ships |
|---|---|
| **v1** (with Part 3) | keyword (weighted, incl. note) · fuzzy · embeddings · rule-parsed filters · RRF · match reasons · thumbnail in Storage · thumbnail → `visual_description` in STRUCTURE · Hinglish `likely_queries` · golden-set script |
| **v2** | LLM query understanding + expansion · reranker on top 30 · place filter UI · auto-collections · similar reels · conditional keyframe VISION for `ocr_text` |
| **later** | image embeddings · personal ranking signals · learning-to-rank from clicks · conversational search · geo ("near me", PostGIS) |

---

## 14. Open questions

1. **Search-as-you-type or on submit?** As-you-type → keyword + fuzzy only per
   keystroke, full hybrid on pause/submit.
2. **LLM query understanding budget** — per query, or only on fallback?
3. **Reranker** — hosted (per-call cost, no ops) vs open model (needs a GPU or
   slow on CPU) vs skip until the golden set says otherwise.
4. **Thumbnail source** — device upload at share time, server fetch in FETCH, or
   both with device first.
5. **Shared vs per-user embeddings** — per-user (card + note) is planned; the
   alternative is one shared card embedding + a separate small note embedding,
   fused at query time (cheaper when many users save the same reel).
6. **Category list** — seeded categories (`supabase/seed.sql`) are Dev & Tools,
   Career & Jobs, Food & Places, Fitness, Style & Vibes, Watch Later. No
   "Travel": trek / trip reels land in Food & Places. Add Travel?
