# Lately frontend app (from Stitch) — design

Date: 2026-10-04 · Branch: `qa` · Status: revised after "build the whole frontend first"

## 1. Goal

Build the **whole** Lately frontend from the Stitch project **"Lately UX & Stitch
Pipeline"** (`5728339997427647518`) as an Expo app in `frontend/`, next to `backend/`.
Every designed screen and control is built, even where the backend does not exist yet.
The app talks to the backend **only through an HTTP API**; a single contract file in
the frontend defines every call. Calls whose endpoint doesn't exist yet are answered by
built-in demo data, so the whole app works today and switches to the real backend one
endpoint at a time.

**Done means:**
- `frontend/` runs on web (verified now) and is ready for Android (share target next
  round). Every screen matches its Stitch screenshot at 390 px width.
- In **demo mode** every screen, tab, button and state works with no backend and no
  login setup.
- In **live mode** sign-in is real (Supabase) and the endpoints that exist today
  (`POST /saves`, `GET /saves`, `PATCH /saves/{id}`) are used; everything else falls
  back to demo data.
- The API contract (§6) is written down; it is the backend's to-do list.
- Frontend tests, typecheck and lint pass.

## 2. Decisions (made in chat)

| Question | Decision |
|---|---|
| Scope | Whole frontend as designed in Stitch; demo data where the backend isn't ready |
| Stack | Expo + expo-router + NativeWind (Stitch exports Tailwind; classes port ~1:1) |
| Layout | `frontend/` (new) + `backend/`; `website/` and old `app/` removed. `supabase/` → `backend/` happens in the backend round |
| Backend this round | None. Backend round follows, built to the contract |
| Missing designs | Generated in Stitch via MCP first, then coded (Curated, Stacks) |
| Sign-in | Live: email (link + 6-digit code) and Google via Supabase. Instagram/Facebook buttons built; they work in demo mode, and show "coming soon" in live mode (no provider yet) |
| Share target | Next round. "Paste link" / Save tab open the same Save sheet |
| Delete | ⋮ menu → Delete → confirm |
| Theme | Light (all Stitch screens are "— light") |

## 3. Stitch source

Screens (all light): `00 Sign up`, `01 Sign in`, `02 Library`, `03 Save sheet`,
`04 Card detail`, `05 Profile & Settings`, `06 Curated` (generated via MCP),
`07 Stacks` (generated via MCP), plus the two logo SVGs. Each screen's HTML +
full-size screenshot is saved to `docs/design/stitch/` as the visual reference.

States not drawn in Stitch are built from `docs/design/stitch-ui-prompts.md` with the
same tokens: Library empty (02b), card processing/partial, Save sheet variants
(03b–d), Card detail processing/partial (04b–c), Search (05/05b/05c), Check-your-inbox
(01b), and a simple stack detail (the stack's reels in the Library grid style).

Tokens come from the Tailwind config embedded in the Stitch HTML and the light design
system "Warm Editorial Media": background `#FAF8F5`, card `#FFFEFB`, raised `#F4EFEA`,
hairline `#E7E1D8`, text `#1C1A17` / `#6B655D` / `#9B948A`, accent `#D98A0B` (white
on-accent), success `#2E7D52`, danger `#D32F2F`, category colours (Dev `#4A6FA5`,
Food `#D35400`, Career `#7E57C2`, Fitness `#2E856E`, Style `#C24177`, Watch later
`#6B655D`). Type: **Newsreader** (display) + **Inter** (UI) at the Stitch scale.
Icons: Material Symbols → `@expo/vector-icons`.

## 4. Repo layout

```
reel-2-list/
├── frontend/                        NEW Expo app
│   ├── app/                         expo-router routes
│   │   ├── _layout.tsx              fonts, QueryClient, session, auth gate
│   │   ├── (auth)/sign-in.tsx       00/01 Sign in | Sign up
│   │   ├── (auth)/check-email.tsx   01b code entry
│   │   ├── (tabs)/_layout.tsx       bottom tabs: Curated · Library · Save · Stacks
│   │   ├── (tabs)/curated.tsx       06 Curated
│   │   ├── (tabs)/index.tsx         02 Library
│   │   ├── (tabs)/save.tsx          Save tab → opens the Save sheet
│   │   ├── (tabs)/stacks.tsx        07 Stacks
│   │   ├── stack/[id].tsx           stack detail
│   │   ├── reel/[id].tsx            04 Card detail
│   │   ├── search.tsx               Search
│   │   ├── account.tsx              05 Profile & Settings
│   │   └── save-sheet.tsx           03 Save sheet (modal; `?text=`)
│   ├── src/api/
│   │   ├── contract.ts              every call + its types (the API contract)
│   │   ├── http.ts                  real FastAPI client (Bearer token)
│   │   ├── demo.ts                  demo implementation (in-memory, Stitch content)
│   │   └── index.ts                 picks http or demo per call
│   ├── src/auth/                    Supabase session + demo session
│   ├── src/components/              ReelCard, Chip, Button, Sheet, Skeleton, TabBar…
│   ├── src/lib/                     search filter + why-matched, dates, prefs
│   ├── src/theme/                   tokens (tailwind.config.js reads them)
│   └── assets/                      logos, Stitch sample images
└── backend/                         unchanged this round
```

## 5. Frontend behaviour

### Modes
`EXPO_PUBLIC_API_MODE=demo|live` (default `demo`).
- **demo:** every call → `demo.ts`. Data = the Stitch sample content (momo spot, GitHub
  tricks, Manali, visa repo, …, six stacks, curated picks). In-memory and mutable
  (saving, notes, delete, new stack all work until reload). Pending cards turn
  `enriched` after ~6 s so the processing state is visible. Special inputs trigger
  error states for testing (e.g. a non-Instagram link → BAD_URL).
- **live:** calls listed in `LIVE_ENDPOINTS` go to FastAPI; the rest still use demo
  data. Adding an endpoint to the backend = adding it to that list.

### Config (`frontend/.env`, git-ignored; `.env.example` committed)
`EXPO_PUBLIC_API_MODE`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public by design; the service-role key never
enters `frontend/`).

### Screens

**00/01 Sign in / Sign up** — one route with the Stitch toggle (copy and button layout
switch per tab, as in the two screens): pill "Your mindful vault", logo, wordmark,
tagline, reel image stack, feature pills, Google (accent), Instagram, Facebook, email.
- Demo: any button signs in as the demo user (Aanya Sharma).
- Live: email → `signInWithOtp` → **Check your inbox** (6-digit code → `verifyOtp`,
  resend, change email; the emailed link also works on web). Google →
  `signInWithOAuth`. Instagram/Facebook → "coming soon" toast.

**Tab bar** (from the Library screen): Curated · Library · Save · Stacks, marigold
active state. "Save" opens the Save sheet over the current tab.

**02 Library** — header (logo, "Lately", bookmark icon → Stacks, avatar → Account),
search field (→ Search; mic icon shown, inactive), category chips (All + categories;
filters the grid), "RECENTLY SAVED · N reels", 2-column grid of ReelCards with the
category icon badge, infinite scroll, pull-to-refresh, refetch every 4 s while any card
is pending, "Paste link" FAB → Save sheet, empty state (02b).

**ReelCard** — one component, three states from `status`: `pending` (shimmer,
"Getting details…", link, note), `enriched` (thumbnail, title, note in curly quotes,
category dot · relative date), `partial` ("Preview unavailable", caption line, note).
Fallbacks when fields are missing (no thumbnail → panel; no title → caption → link).

**03 Save sheet** — modal over a dimmed backdrop; input = shared/pasted text (paste
step when empty). Result states mapped from the API: saved (note field, quick chips
To try/To buy/To visit/To learn/Watch later, "Save note", "Skip"), already saved (loads
the card for its note/date, "Open card"), no reel link, monthly limit (loads usage for
limit/reset date), rate limited, network error ("Try again"). Auto-closes 5 s after the
result unless the note field is touched.

**04 Card detail** — top bar (back, "Reel Detail · Lately", share, logo); status line
(READY • SYNCED / GETTING DETAILS / PREVIEW UNAVAILABLE) with bookmark (add to a stack →
stack picker) and ⋮ (Delete → confirm); hero with "Reel" badge and "Open in Instagram";
creator + "Instagram"; title; category chip + "Saved N days ago"; Your note (inline
edit; empty → "Add a note"); Summary; Good to know; Places ("Open in Maps"); tags;
Original caption (collapsible); footer "Saved to Lately via …" + Export (shares the card
as text). Processing state: skeleton + 3-step tracker.

**05 Profile & Settings** — everything on the Stitch screen: avatar with camera badge,
name, @handle · email, chips (saved reels, collections, member since), connected
Instagram pill; **Reading Experience & Appearance** (reading font Newsreader / Inter /
Lora, text size slider 14–20 px, theme Light / Dark / System); **Account & Security**
(password & security, connected accounts, download vault archive); **Reading
Preferences** (push digests, offline reading checkboxes); Log out; version footer.
Reading font and text size are stored on the device and applied to card-detail
summary/note text. Theme stays light this round (Dark/System are selectable and saved;
a note says the dark theme is coming). Other rows open the matching flow against the
contract (demo data until the backend has it). Log out ends the session.

**06 Curated** and **07 Stacks** — built to the generated Stitch screens. Stacks:
tiles open a stack detail; "+ New stack" opens a name sheet. Curated: picks open the
card or a filtered list.

**Search** — focused field + back; Recent (stored on device) and Try chips; results
list with "why it matched" chips and "N reels"; no-results state. Uses `search()` from
the contract (demo: matches title/note/caption/link/tags over all demo saves).

## 6. API contract (`frontend/src/api/contract.ts`)

All calls send `Authorization: Bearer <Supabase access token>`. Errors are
`{ error: { code, message } }`.

| Call | HTTP | Backend today |
|---|---|---|
| `createSave(text)` | `POST /saves` | ✅ exists |
| `listSaves({before, limit, category})` | `GET /saves` | ✅ exists (needs card fields: title, caption, category, thumbnail_url, creator) |
| `setNote(id, note)` | `PATCH /saves/{id}` | ✅ exists |
| `getSave(id)` | `GET /saves/{id}` | 🆕 |
| `deleteSave(id)` | `DELETE /saves/{id}` | 🆕 |
| `getMe()` | `GET /me` (profile, plan, usage, counts, connected accounts) | 🆕 |
| `updatePreferences(p)` | `PATCH /me/preferences` | 🆕 (device-only until then) |
| `search(q)` | `GET /search?q=` | 🆕 Phase 1 |
| `listStacks()` / `createStack(name)` | `GET /stacks` / `POST /stacks` | 🆕 |
| `getStack(id)` | `GET /stacks/{id}` | 🆕 |
| `addToStack(stackId, saveId)` | `POST /stacks/{id}/saves` | 🆕 |
| `getCurated()` | `GET /curated` | 🆕 |
| `requestExport()` | `POST /me/export` | 🆕 |

Shapes (TypeScript types in `contract.ts`) are the source of truth for the backend
round. `thumbnail_url` is a full URL or `null`.

## 7. Errors

The HTTP client turns `{error:{code,message}}` into `ApiError(code, status)`; screens
switch on `code`. Network failure → `ApiError("NETWORK")`. Live `401` → refresh the
session once, retry, else sign out. Reads retry twice; `POST /saves` never retries
automatically. Unknown errors show an inline message; no screen crashes.

## 8. Testing and verification

- **Unit/component (jest-expo + React Native Testing Library):** ReelCard states +
  fallbacks; Save sheet state mapping for every API outcome; HTTP client (bearer header,
  error parsing, 401 refresh); demo API behaviour (save → pending → enriched, delete,
  stacks); search + why-matched; mode routing (`LIVE_ENDPOINTS`).
- **Static:** `tsc --noEmit`, ESLint. New `.github/workflows/frontend-ci.yml` runs
  install + lint + typecheck + test on `qa`/`main`.
- **Visual:** Expo web in the built-in browser at 390×844, demo mode; every screen
  compared side by side with its Stitch screenshot; every tab, button and state
  clicked through. (Demo mode needs no real login, so this is fully checkable here.)
- **Live smoke (optional this round):** needs CORS on the backend (first item of the
  backend round) and one real sign-in by the user.

## 9. Setup the user does later (live mode)

Supabase dashboard: Site URL + redirect URLs (`http://localhost:8081/**`,
`lately://**`); Magic Link email template includes `{{ .Token }}`; Google provider
(Google Cloud OAuth client, redirect `https://jsvgezmgvwnldcnrjdzg.supabase.co/auth/v1/callback`).
Built-in mailer is rate-limited (a few emails/hour) — fine for dev.

## 10. Next rounds (not this one)

1. **Backend to the contract:** CORS, card fields on `GET /saves`, `GET/DELETE
   /saves/{id}`, `GET /me`, then stacks/curated/export; `supabase/` → `backend/`.
2. **Android share target** (expo-share-intent, dev build on the phone, offline queue).
3. Phase 2 enrichment (real thumbnails/titles/summaries), `GET /search` (Phase 1),
   dark theme, Instagram/Facebook login if a provider path exists.
