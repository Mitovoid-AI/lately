# Phase 1 — Search v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /search?q=` returns the user's matching reels — thumbnail, title, note, Instagram link, "why it matched" — ranked by hybrid keyword + fuzzy + embedding search, with an eval harness that reports recall on the golden set.

**Architecture:** Everything in Postgres, scoped to one user's saves (`SEARCH.md` §4–§5). Migration 0004 adds the search columns plus a `refresh_search_columns()` function. The FINALIZE stage (Phase 2), the test fixtures and the eval seeder all call it, so the same code builds search columns everywhere. Search is built on **seeded cards** so it can be tested and tuned before enrichment exists.

**Tech Stack:** Postgres (`tsvector`, `pg_trgm`, pgvector `vector(768)`), FastAPI, asyncpg, httpx (OpenAI-compatible `/embeddings` API), pytest.

**Spec:** `SEARCH.md` (all sections; §12 is the schema), `PIPELINE.md` §6. **Depends on:** Phase 0 complete (`docs/superpowers/plans/2026-10-03-phase0-foundation.md`): `init_pool`/`pool`, the `db`/`make_user`/`jwt_for`/`client` fixtures, and the `db` marker.

**Not in this plan:** two of the v1 items in `SEARCH.md` §13 — "thumbnail → `visual_description` in STRUCTURE" and "Hinglish `likely_queries`" — are changes to the STRUCTURE prompt, so they belong to the Phase 2 plan. Uploading thumbnails to Storage is Phase 2 FETCH work. This phase creates the bucket and reads from it.

## Global Constraints

- Search is always scoped to `reels.auth_user_id = <verified sub>`.
- Embeddings: `text-embedding-3-small` through an OpenAI-compatible `/embeddings` endpoint with `dimensions=768`, to match `vector(768)`. L2-normalised. Documents and queries use the same model (there are no task types). The provider is chosen only by env vars: `EMBEDDINGS_API_KEY`, `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIMENSIONS` (see `backend/.env.example`).
- Field weights: **A** = title, `likely_queries`, user note · **B** = tags, entity names, category, `ocr_text` · **C** = summary, `visual_description` · **D** = caption, transcript.
- Fusion: RRF with **k = 60**. Weights: keyword **1.0**, meaning **1.0**, fuzzy **0.7**. Leg limits: keyword **50**, fuzzy **20**, meaning **50**. Fused cap **30**.
- Guessed category/place are **hints** with a **+0.008** boost each, **never filters**. Hard filters come only from date phrases and the `category` query param.
- Latency: p95 < **300 ms** without an LLM. A query embedding that takes longer than **2 s** is dropped (search continues without the meaning leg).
- Thumbnails are served from the public Storage bucket `thumbnails`, object path `{shortcode}.jpg`. Never store video.
- Seeded categories (`supabase/seed.sql`): Dev & Tools, Career & Jobs, Food & Places, Fitness, Style & Vibes, Watch Later.

## Review Focus

- **Noise-only or junk query** (`reel`, `that video`, 200+ chars, `c++ 🚀 "rooftop" -cafe`) → 200 or 422, never 500 or a SQL error → Task 4 `test_search_handles_symbols_and_emoji`, Task 5 `test_get_search_noise_only_query_returns_200`, `test_get_search_q_too_long_422`.
- **Embedding API down or slow** → results still arrive from keyword + fuzzy within budget → Task 5 `test_get_search_embedder_failure_degrades`.
- **User with zero saves** → `[]` with 200 → Task 5 `test_get_search_no_saves_returns_empty`.
- **Pending save** (no `reel_content` yet) → still findable by its note → Task 4 `test_search_pending_reel_matches_on_note`.
- **Same reel saved by two users** → each sees only their own note and row → Task 4 `test_search_scoped_to_user`.

## Shared test fixture

`backend/tests/fixtures/cards.json` holds 6 cards, used by tests (Tasks 1, 4, 5) and the eval (Task 6). Exact content matters, because the assertions below depend on it:

| shortcode | title | category | tags | entity_names | likely_queries | visual_description | transcript | note |
|---|---|---|---|---|---|---|---|---|
| `MANALI1` | Hampta Pass trek from Manali — 5 day plan | Food & Places | trek, himalaya, itinerary | Hampta Pass, Manali, Himachal Pradesh | manali trek route; himachal trekking ideas; pahad trip plan | snowy mountains, hikers with backpacks, tents by a river | day one we start from jobra | do this with college friends |
| `MOMO1` | Best momos in Lajpat Nagar under ₹100 | Food & Places | momos, street food, cheap eats | Lajpat Nagar, Delhi | that momo cafe; cheap momos delhi; momos wali jagah | steaming dumplings at a roadside stall | | |
| `GITHUB1` | 5 hidden GitHub search tricks | Dev & Tools | github, search, productivity | GitHub, github.dev | github tricks; find good repos | screen recording of github search | | use for finding repos |
| `JOBS1` | Repo listing companies that sponsor visas | Career & Jobs | jobs, visa, github repo | GitHub | repo for job search; visa sponsor companies list | scrolling a github readme | | |
| `PASTA1` | One-pot creamy pasta in 15 minutes | Food & Places | recipe, pasta, quick dinner | | easy pasta recipe; quick dinner idea | pasta in a pan | | |
| `GOA1` | Hidden beaches in South Goa | Food & Places | beach, travel, goa | Palolem, South Goa, Goa | goa beaches; beach trip ideas | turquoise water, palm trees, empty beach | | december trip? |

Each card also has `caption` (one short line) and `summary` (one sentence) in the JSON; their wording is free.

---

### Task 1: Migration 0004 — search columns + `refresh_search_columns()`

**Files:**
- Create: `supabase/migrations/0004_search.sql`
- Create: `backend/tests/fixtures/cards.json`, `backend/app/search/__init__.py`, `backend/app/search/seed.py`
- Create: `backend/tests/db/test_search_schema.py`

**Interfaces:**
- Produces (SQL), per `SEARCH.md` §12:
  - `reel_content` gains `creator_handle, ocr_text, visual_description, entity_names text[], match_text, tsv tsvector`.
  - `reels` gains `note_tsv` (generated, weight A), `opened_count` and `last_opened_at`.
  - `pg_trgm`, plus a GIN trigram index on `reel_content.match_text`.
  - `public.refresh_search_columns(p_shortcode text) returns void`, which runs the FINALIZE update from §12.
  - Bucket `thumbnails`: `insert into storage.buckets (id, name, public) values ('thumbnails','thumbnails',true) on conflict (id) do nothing`.
- Produces (Python) `app/search/seed.py`: `async def seed_card(db: asyncpg.Pool, user_id: UUID, card: Mapping[str, Any], embedder: Embedder | None) -> UUID`. It upserts `reel_content`, inserts a `reels` row (`status 'enriched'`, `source_url https://www.instagram.com/reel/{shortcode}/`, `thumbnail_path` `{shortcode}.jpg`, the card's `note`), calls `refresh_search_columns`, and sets `reels.embedding` when an embedder is given. It returns the reel id. (`Embedder` arrives in Task 3; until then, type it with a forward reference.)

- [ ] **Step 1: Write the failing tests**

```python
pytestmark = pytest.mark.db

async def test_refresh_puts_title_in_weight_a_and_transcript_in_d(db, make_user):
    uid = await make_user(); await seed_card(db, uid, CARDS["MANALI1"], None)
    tsv = "(select tsv from public.reel_content where shortcode='MANALI1')"
    assert await db.fetchval(f"select ts_filter({tsv}, '{{a}}') @@ to_tsquery('english','hampta')")
    assert not await db.fetchval(f"select ts_filter({tsv}, '{{a}}') @@ to_tsquery('english','jobra')")
    assert await db.fetchval(f"select ts_filter({tsv}, '{{d}}') @@ to_tsquery('english','jobra')")

async def test_refresh_indexes_entity_parents(db, make_user): ...
    # MANALI1 tsv @@ to_tsquery('english','himachal')
async def test_match_text_has_title_tags_entities(db, make_user): ...
    # match_text contains 'Hampta Pass', 'trek', 'Himachal Pradesh'
async def test_note_tsv_follows_note_updates(db, make_user): ...
    # update note → note_tsv @@ 'college' with weight A; set note null → empty tsvector
async def test_thumbnails_bucket_is_public(db):
    assert await db.fetchval("select public from storage.buckets where id='thumbnails'") is True
```

- [ ] **Step 2: Run — expect failure**: `python -m pytest tests/db/test_search_schema.py -v` → FAIL (columns and function missing).
- [ ] **Step 3: Write `0004_search.sql` and `seed.py`** per Interfaces.
- [ ] **Step 4: Run — expect pass**: `supabase db reset` then `python -m pytest tests/db/test_search_schema.py -v` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): search columns, refresh_search_columns(), thumbnails bucket"`

---

### Task 2: Query normalisation + rule parser (pure)

**Files:**
- Create: `backend/app/search/query.py`, `backend/tests/search/__init__.py`, `backend/tests/search/test_query.py`

**Interfaces:**
- Produces:

```python
@dataclass(frozen=True)
class ParsedQuery:
    text: str                          # normalized; used by keyword, fuzzy, embedding
    place_hint: str | None = None      # original casing from known_places
    category_hint: str | None = None   # one of the seeded categories
    saved_after: datetime | None = None
    saved_before: datetime | None = None

NOISE_WORDS: frozenset[str]   # reel reels video videos post posts saved save that
                              # wo woh jo wahi wala wali waala waali vala vali ki ka ke
CATEGORY_WORDS: dict[str, str]
    # Food & Places: recipe food cafe restaurant momo momos place trip travel trek beach
    # Dev & Tools: github code coding tool tools dev repo ai
    # Career & Jobs: job jobs resume interview career visa
    # Fitness: workout gym fitness exercise diet
    # Style & Vibes: outfit style fashion aesthetic

def normalize_query(raw: str) -> str: ...
def parse_query(raw: str, *, now: datetime, known_places: Iterable[str]) -> ParsedQuery: ...
```

- Rules:
  - **Normalise:** lowercase, collapse whitespace, drop `NOISE_WORDS`. If nothing is left, return the lowercased, trimmed input.
  - **Date phrases**, with an optional leading `from|in|since`, are removed from `text`:
    - `today` → [start of today, —)
    - `yesterday` → [start of yesterday, start of today)
    - `last week` → `now - 7 days`
    - `last month` → `now - 30 days`
    - `this month` → first of this month
    - month names (full or 3-letter) → [1st of the most recent such month ≤ now, 1st of the next month). `may` counts only after `in` / `from` / `since`.
  - **Category:** the first token (or the token with a trailing `s` removed) found in `CATEGORY_WORDS` becomes `category_hint`. The word stays in `text`.
  - **Place:** the longest `known_places` entry appearing as whole words in `text` (case-insensitive) becomes `place_hint`.

- [ ] **Step 1: Write the failing tests** (`NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)`)

```python
@pytest.mark.parametrize("raw,places,exp", [
    ("manali treks", {"Manali"}, ParsedQuery("manali treks", place_hint="Manali", category_hint="Food & Places")),
    ("mountain reel", set(), ParsedQuery("mountain")),
    ("pahad wali reel", set(), ParsedQuery("pahad")),
    ("reel", set(), ParsedQuery("reel")),
    ("that momo cafe", set(), ParsedQuery("momo cafe", category_hint="Food & Places")),
    ("github tricks from june", set(), ParsedQuery("github tricks", category_hint="Dev & Tools",
        saved_after=datetime(2026,6,1,tzinfo=UTC), saved_before=datetime(2026,7,1,tzinfo=UTC))),
    ("pasta recipe last week", set(), ParsedQuery("pasta recipe", category_hint="Food & Places",
        saved_after=NOW - timedelta(days=7))),
    ("goa beach december", set(), ParsedQuery("goa beach", category_hint="Food & Places",
        saved_after=datetime(2025,12,1,tzinfo=UTC), saved_before=datetime(2026,1,1,tzinfo=UTC))),
    ("things i may need", set(), ParsedQuery("things i may need")),
    ("", set(), ParsedQuery("")),
])
def test_parse_query(raw, places, exp):
    assert parse_query(raw, now=NOW, known_places=places) == exp
```

- [ ] **Step 2: Run — expect failure**: `python -m pytest tests/search/test_query.py -v` → FAIL (module missing).
- [ ] **Step 3: Implement** in `app/search/query.py`.
- [ ] **Step 4: Run — expect pass**: the same command → 10 PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(search): query normalisation and rule parser"`

---

### Task 3: Embedders + embedding text

**Files:**
- Create: `backend/app/search/embed.py`, `backend/tests/search/test_embed.py`
- Modify: `backend/app/config.py`: `embeddings_api_key: str = ""`, `embeddings_base_url: str = "https://api.openai.com/v1"`, `embeddings_model: str = "text-embedding-3-small"`, `embeddings_dimensions: int = 768`, `search_embed_timeout_seconds: float = 2.0`. Also remove `gemini_api_key`.

**Interfaces:**
- Produces:

```python
EMBED_DIM = 768
class Embedder(Protocol):
    async def embed(self, texts: list[str], task: Literal["document", "query"]) -> list[list[float]]: ...

class FakeEmbedder:      # deterministic, offline: hashed bag-of-words → 768-d, L2-normalised
    async def embed(self, texts, task): ...

class OpenAIEmbedder:    # POST {base_url}/embeddings {"model", "input": texts, "dimensions"}
    def __init__(self, api_key: str, base_url: str, model: str, dimensions: int = EMBED_DIM,
                 client: httpx.AsyncClient | None = None): ...
    async def embed(self, texts, task): ...   # `task` ignored (symmetric model); order by
                                              # response data[i].index; L2-normalise

class LruCache:          # tiny in-process cache for query vectors
    def __init__(self, maxsize: int = 1024): ...
    def get(self, key: str) -> list[float] | None: ...
    def put(self, key: str, value: list[float]) -> None: ...

def card_embedding_text(card: Mapping[str, Any], note: str | None) -> str: ...
    # title + summary + likely_queries + tags + entity_names + visual_description + note, newline-joined, skipping empties

def to_pgvector(vec: list[float]) -> str: ...   # "[0.1,0.2,...]" for a $n::vector parameter
```

- [ ] **Step 1: Write the failing tests**

```python
async def test_fake_embedder_deterministic_and_unit_length(): ...   # same text → same vec; |v| ≈ 1
async def test_fake_embedder_shared_words_are_closer(): ...
    # cos("manali trek", "trek in manali") > cos("manali trek", "pasta recipe")
async def test_openai_embedder_request_shape_and_normalises(): ...
    # httpx.MockTransport asserts POST https://api.openai.com/v1/embeddings,
    # header Authorization == "Bearer test-key",
    # JSON == {"model": "text-embedding-3-small", "input": ["a", "b"], "dimensions": 768};
    # response data out of order [{"index": 1, ...}, {"index": 0, "embedding": [3.0, 4.0, 0...]}]
    # → output[0][:2] == [0.6, 0.8] (sorted by index, normalised)
async def test_openai_embedder_raises_on_http_error(): ...   # 429 → httpx.HTTPStatusError
def test_card_embedding_text_includes_note_and_likely_queries(): ...
def test_lru_cache_evicts_oldest(): ...   # maxsize 2: put a, b, c → get(a) is None
```

- [ ] **Step 2: Run — expect failure**; **Step 3: Implement**; **Step 4: Run — expect pass** (`python -m pytest tests/search/test_embed.py -v`).
- [ ] **Step 5: Commit** — `git commit -m "feat(search): embedder protocol, fake + OpenAI-compatible embedders"`

---

### Task 4: Retrieval SQL + "why it matched"

**Files:**
- Create: `backend/app/search/retrieve.py`, `backend/app/search/why.py`
- Create: `backend/tests/search/test_why.py`, `backend/tests/db/test_search_retrieve.py`

**Interfaces:**
- Consumes: `ParsedQuery` (Task 2), `to_pgvector`/`FakeEmbedder` (Task 3), `seed_card` (Task 1).
- Produces:

```python
ALL_LEGS: frozenset[str] = frozenset({"keyword", "fuzzy", "meaning"})

@dataclass(frozen=True)
class Hit:
    reel_id: UUID
    score: float
    matched_by: tuple[str, ...]

async def search(db: asyncpg.Pool, user_id: UUID, parsed: ParsedQuery,
                 query_vec: list[float] | None, *, category: str | None = None,
                 legs: frozenset[str] = ALL_LEGS, limit: int = 30) -> list[Hit]: ...

def build_why(card: Mapping[str, Any], parsed: ParsedQuery, matched_by: Sequence[str]) -> list[str]: ...
```

- The SQL is `SEARCH.md` §5 verbatim, as one static string. Each leg's `where` gains a `$n::boolean` toggle from `legs`. The meaning leg also requires `$3 is not null`. Hard filters go in `$4` (`category`, `saved_after`, `saved_before`) and hints in `$5` (`place`, `category`). An empty `parsed.text` returns `[]` without querying.
- `build_why` returns at most 2 items, in this order:
  - `"📍 {place_hint}"` if the place is in the card's `entity_names`
  - `'your note: "{note}"'`, truncated to 60 chars with `…`, if any query token of 3+ chars appears in the note
  - otherwise `"similar meaning"` if `"meaning"` is in `matched_by`

- [ ] **Step 1: Write the failing tests** — `test_search_retrieve.py`. Fixture `seeded` seeds all 6 cards for user A with `FakeEmbedder()`, plus `MANALI1` for user B with note `"b's private note"`. Each query goes through `parse_query(..., known_places=<A's entity_names>)`:

```python
pytestmark = pytest.mark.db
# helper: top(q, k) -> list[str] of shortcodes for user A,
#         query_vec = (await FakeEmbedder().embed([parsed.text], "query"))[0]

async def test_keyword_finds_exact_place(seeded):          assert (await top("manali treks", 1)) == ["MANALI1"]
async def test_fuzzy_finds_misspelling(seeded):            assert "MANALI1" in await top("manaali", 3)
async def test_visual_description_matches(seeded):         assert (await top("mountain reel", 1)) == ["MANALI1"]
async def test_hinglish_likely_query_matches(seeded):      assert (await top("pahad wali reel", 1)) == ["MANALI1"]
async def test_entity_parent_region_matches(seeded):       assert (await top("himachal trips", 1)) == ["MANALI1"]
async def test_likely_query_exact_phrase(seeded):          assert (await top("repo for job search", 1)) == ["JOBS1"]
async def test_note_match_ranks_first(seeded):             assert (await top("college friends", 1)) == ["MANALI1"]
async def test_meaning_leg_alone_finds_card(seeded): ...
    # legs={"meaning"}, query_vec = MANALI1's own stored embedding → top1 MANALI1
async def test_search_scoped_to_user(seeded): ...
    # user A searching "private note" → no MANALI1 hit from user B
async def test_category_hard_filter(seeded): ...           # category="Dev & Tools" → only GITHUB1/JOBS1 possible
async def test_saved_after_filter_excludes_older(seeded): ...
    # backdate GOA1's reels.created_at by 60 days; "goa beaches last month" → GOA1 not in results
    # ("last month" alone normalises to empty text → [] by design)
async def test_search_pending_reel_matches_on_note(db, make_user): ...
    # reel with no reel_content (save_reel /share/ link), note "cafe to try" → found for "cafe"
async def test_search_handles_symbols_and_emoji(seeded): ...
    # 'c++ 🚀 "rooftop" -cafe' → returns a list (possibly empty), no exception
async def test_empty_text_returns_empty_without_query(seeded): ...
```

`test_why.py` (pure): place plus note → `["📍 Manali", 'your note: "do this with college friends"']`; meaning only → `["similar meaning"]`; no signals → `[]`; a long note is truncated to 60 chars with `…`.

- [ ] **Step 2: Run — expect failure**: `python -m pytest tests/search/test_why.py tests/db/test_search_retrieve.py -v` → FAIL.
- [ ] **Step 3: Implement** `retrieve.py` and `why.py`.
- [ ] **Step 4: Run — expect pass**: the same command → all PASS. If a ranking assertion fails, tune the weights in `SEARCH.md` §5 and here together; never loosen the test to `top(k)` with a bigger k without noting it in `SEARCH.md`.
- [ ] **Step 5: Commit** — `git commit -m "feat(search): hybrid retrieval with RRF, hints, and match reasons"`

---

### Task 5: `GET /search`

**Files:**
- Create: `backend/app/routers/search.py`
- Modify: `backend/app/models.py` (`SearchResult`), `backend/app/main.py` (include the router), `backend/app/deps.py` (`get_embedder`)
- Create: `backend/tests/api/test_search_api.py`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `GET /search?q=<str, 1..200>&category=<str|None>&limit=<int 1..50, default 20>` → `list[SearchResult]`.
  - `class SearchResult(BaseModel): reel_id: UUID; thumbnail_url: str | None; title: str | None; note: str | None; source_url: str; category: str | None; status: str; matched_by: list[str]; why: list[str]`
  - `def get_embedder() -> Embedder | None` returns an `OpenAIEmbedder` built from the `EMBEDDINGS_*` settings when `EMBEDDINGS_API_KEY` is set, else `None`. Tests override it with `app.dependency_overrides`.
  - Test fixture `seeded_api_user` (in `tests/api/conftest.py`): creates a user, seeds the 6 fixture cards with `FakeEmbedder()`, sets `app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()`, clears the route's `LruCache`, and yields the user id.
- Flow:
  1. Load `known_places` (`select distinct unnest(rc.entity_names) … where r.auth_user_id = $1 limit 500`).
  2. `parse_query(q, now=utcnow(), known_places=…)`.
  3. Embed the query: `LruCache` first, otherwise `asyncio.wait_for(embedder.embed([text], "query"), search_embed_timeout_seconds)`. On any exception, `query_vec = None` and log a warning.
  4. `search(...)`.
  5. Load card fields for the hit ids, re-checking `auth_user_id`.
  6. `build_why`.
  7. Set `thumbnail_url = f"{supabase_url}/storage/v1/object/public/thumbnails/{thumbnail_path}"` when a path exists.
  8. Insert a `metrics` row: `door='api', stage='search', duration_ms, outcome` (`ok` or `no_embed`).

- [ ] **Step 1: Write the failing tests**

```python
pytestmark = pytest.mark.db

async def test_get_search_returns_card_fields_and_why(client, seeded_api_user, jwt_for): ...
    # q="manali treks" → [0].title starts "Hampta Pass", thumbnail_url ends "/thumbnails/MANALI1.jpg",
    # source_url "https://www.instagram.com/reel/MANALI1/", "📍 Manali" in why
async def test_get_search_401_without_token(client): ...
async def test_get_search_works_without_embedder(client, seeded_api_user, jwt_for): ...
    # override get_embedder → None; "manali treks" still top1 MANALI1; "meaning" not in matched_by
async def test_get_search_embedder_failure_degrades(client, seeded_api_user, jwt_for): ...
    # embedder raising TimeoutError → 200, top1 MANALI1, metrics outcome 'no_embed'
async def test_get_search_noise_only_query_returns_200(client, seeded_api_user, jwt_for): ...  # q="reel"
async def test_get_search_q_too_long_422(client, seeded_api_user, jwt_for): ...               # 201 chars
async def test_get_search_no_saves_returns_empty(client, make_user, jwt_for): ...             # → []
async def test_query_embedding_is_cached(client, seeded_api_user, jwt_for): ...
    # counting FakeEmbedder: two identical searches → embed called once for the query
```

- [ ] **Step 2: Run — expect failure**; **Step 3: Implement**; **Step 4: Run — expect pass** (`python -m pytest tests/api/test_search_api.py -v`).
- [ ] **Step 5: Commit** — `git commit -m "feat(api): GET /search with graceful embedding fallback"`

---

### Task 6: Eval harness (golden set)

**Files:**
- Create: `backend/app/search/eval.py`, `backend/scripts/eval_search.py`
- Create: `backend/tests/fixtures/golden-fixture.csv` (same columns as `data/golden-set.csv`; 8 rows for the 6 fixture cards: `manali treks`, `mountain reel`, `pahad wali reel`, `that momo cafe`, `github tricks`, `repo for job search`, `easy pasta`, `goa beaches`, with `reel_url = https://www.instagram.com/reel/<SHORTCODE>/`)
- Create: `backend/tests/search/test_eval.py`, `backend/tests/db/test_eval_fixture.py`

**Interfaces:**
- Consumes: `seed_card`, `parse_query`, `search`, the embedders, `parse_shortcode` (`app/urls.py`).
- Produces:

```python
def recall_at_k(ranked: Sequence[Sequence[str]], expected: Sequence[str], k: int) -> float: ...
def mrr(ranked: Sequence[Sequence[str]], expected: Sequence[str]) -> float: ...
def p95(values: Sequence[float]) -> float: ...           # nearest-rank

@dataclass
class EvalReport:
    recall1: float; recall5: float; mrr: float; p95_ms: float
    misses: list[tuple[str, str, list[str]]]             # (query, expected, top5 got)

def load_golden(path: Path) -> list[tuple[str, str]]: ...
    # (what_i_remembered_it_as, shortcode); skips blank rows

async def run_eval(db: asyncpg.Pool, golden: list[tuple[str, str]], cards: list[Mapping[str, Any]],
                   embedder: Embedder | None, legs: frozenset[str] = ALL_LEGS) -> EvalReport: ...
    # eval user 00000000-0000-0000-0000-00000000e7a1: ensures auth user, deletes its reels,
    # seeds cards, runs every query, times each search()
```

- Script: `python scripts/eval_search.py --golden PATH --cards PATH [--embedder fake|real] [--legs keyword,fuzzy,meaning]`. `real` uses `EMBEDDINGS_*` from `.env`. It prints one table row (`legs | recall@1 | recall@5 | MRR | p95 ms`) followed by the misses. It needs `DATABASE_URL`.

- [ ] **Step 1: Write the failing tests**

```python
def test_recall_at_k():
    ranked = [["a", "b"], ["c", "d"]]
    assert recall_at_k(ranked, ["b", "x"], 1) == 0.0
    assert recall_at_k(ranked, ["b", "x"], 2) == 0.5
def test_mrr():  assert mrr([["a", "b"], ["c", "d"]], ["b", "x"]) == 0.25
def test_p95():  assert p95([float(i) for i in range(1, 101)]) == 95.0
def test_load_golden_skips_blank_rows(tmp_path): ...     # data/golden-set.csv shape, 3 real + 2 blank → 3

# tests/db/test_eval_fixture.py
async def test_eval_fixture_recall_at_5_is_perfect(db):
    report = await run_eval(db, load_golden(FIXTURE_CSV), CARDS, FakeEmbedder())
    assert report.recall5 == 1.0 and report.misses == []
```

- [ ] **Step 2: Run — expect failure**; **Step 3: Implement**; **Step 4: Run — expect pass** (`python -m pytest tests/search/test_eval.py tests/db/test_eval_fixture.py -v`).
- [ ] **Step 5: Script check**

Run: `python scripts/eval_search.py --golden tests/fixtures/golden-fixture.csv --cards tests/fixtures/cards.json --embedder fake`
Expected: a row with `recall@5 1.00` and `p95 ms` below 300. Then run with `--legs keyword` and `--legs keyword,fuzzy` to fill the comparison table in `SEARCH.md` §11 for the fixture.

- [ ] **Step 6: Commit and push to `qa`** (ask the user before pushing)

```bash
git add backend/app/search backend/scripts/eval_search.py backend/tests
git commit -m "feat(search): golden-set eval harness"
git push origin qa
```

**Phase 1 exit:** all tests green locally and in CI. `eval_search.py` on the fixture shows recall@5 = 1.00 and p95 < 300 ms. Once ~30 real golden rows exist **and** Phase 2 produces real cards, the same script gives the real numbers, and those decide what goes into search v2.
