# Lately Frontend App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the whole Lately frontend from the Stitch screens as an Expo app in `frontend/`, running on web at `http://localhost:8081` in demo mode, with a typed API contract that the backend will implement next.

**Architecture:** expo-router app; screens live in `src/screens/*` and route files in `app/*` are thin wrappers. All data goes through one `LatelyApi` interface (`src/api/contract.ts`) with two implementations: `demo` (in-memory Stitch content) and `http` (FastAPI). `createApi` picks one per endpoint from `EXPO_PUBLIC_API_MODE` + `LIVE_ENDPOINTS`. Screens get the API from `ApiProvider` so tests inject a demo API with a fixed clock.

**Tech Stack:** Expo SDK 57 (`expo@57.0.x`), expo-router 57, NativeWind 4.2.x + tailwindcss 3.4.x, TypeScript strict, @tanstack/react-query 5, @supabase/supabase-js 2, expo-image, @expo-google-fonts (newsreader, inter, lora), @expo/vector-icons, jest-expo 57 + @testing-library/react-native 14. Node 24 / npm 12.

**Spec:** `docs/superpowers/specs/2026-10-04-frontend-app-design.md`

## Global Constraints

- All work on branch `qa`; commit after each task with explicit `git add <paths>`; never stage `BACKEND.md`, `docs/`, `backend/` or other unrelated files; do not push.
- Default mode is demo: `EXPO_PUBLIC_API_MODE` unset ⇒ `demo`. Only `EXPO_PUBLIC_*` env vars in `frontend/`; never a service-role key.
- Light theme only. Tokens (exact): background `#FAF8F5`, card `#FFFEFB`, raised `#F4EFEA`, hairline `#E7E1D8`, ink `#1C1A17`, ink-2 `#6B655D`, ink-3 `#9B948A`, accent `#D98A0B`, on-accent `#FFFFFF`, accent-pressed `#C27A08`, success `#2E7D52`, danger `#D32F2F`, danger-soft `#FDE2E1`.
- Categories (exact names → dot colour → icon): `Dev & Tools` `#4A6FA5` code · `Food & Places` `#D35400` restaurant · `Career & Jobs` `#7E57C2` work · `Fitness` `#2E856E` hiking · `Style & Vibes` `#C24177` checkroom · `Watch Later` `#6B655D` schedule.
- Type: Newsreader for display/titles (28/34, 24/30, 22/28), Inter for UI (title-card 15/20 600, body 15/22, meta 13/18, label 12/16 600 uppercase +0.04em, caption 11/14 500). Lora only as a reading-font option.
- Shape: 16 px side padding; thumbnails radius 14 (list rows 10); inputs/buttons radius 12, height 48; sheets radius 24 top + 36×4 handle; chips full pill, 32 high; touch targets ≥ 48 px.
- Never: emoji outside "why it matched" chips, gradients (the logo image is the only exception), glassmorphism, coloured left-border callouts.
- Copy is exact where this plan quotes it.
- Every screen must render at 390×844 without horizontal scroll.

## Review Focus

1. Shared text with the link buried in other text and tracking params (`Look https://www.instagram.com/reel/C8xYz12/?igsh=abc 🔥`) — must save `https://www.instagram.com/reel/C8xYz12/` → test in Task 2 `instagram.test.ts`.
2. Double-tap on "Save" / "Save note" — must send one request → test in Task 7.
3. Opening a card that was deleted (or a bad id in the URL) — must show the not-found state, not crash → test in Task 8.
4. Search input with regex metacharacters or only spaces (`c++(`, `   `) — no crash; blank shows Recent → test in Task 2 `search.test.ts` and Task 9.
5. Very long title / note / caption (200+ chars, Hinglish, emoji) — title clamps to 2 lines, note to 1 line, layout intact → test in Task 4 `ReelCard.test.tsx`.

---

## File structure

```
frontend/
  app.json  package.json  tsconfig.json  babel.config.js  metro.config.js
  tailwind.config.js  global.css  nativewind-env.d.ts  .env.example  README.md
  app/
    _layout.tsx                    providers + Stack.Protected gate
    (auth)/_layout.tsx  sign-in.tsx  check-email.tsx
    (tabs)/_layout.tsx  curated.tsx  index.tsx  save.tsx  stacks.tsx
    reel/[id].tsx  stack/[id].tsx  search.tsx  account.tsx  save-sheet.tsx
  src/
    config.ts                      reads EXPO_PUBLIC_* once
    theme/tokens.ts  theme/categories.ts
    api/contract.ts  api/demo-data.ts  api/demo.ts  api/http.ts  api/index.ts
    auth/supabase.ts  auth/AuthProvider.tsx
    lib/instagram.ts  lib/search.ts  lib/dates.ts  lib/saveOutcome.ts
    lib/recent.ts  lib/share.ts  lib/storage.ts
    hooks/useSaves.ts  hooks/usePreferences.ts
    components/  Button Chip CategoryDot Icon Thumb Skeleton Sheet Toast
                 Header TabBar ReelCard ConfirmDialog
                 detail/NoteBlock detail/ProgressTracker detail/PlaceCard detail/StackPicker
                 settings/SettingsSection settings/OptionCard
    screens/  SignInScreen CheckEmailScreen LibraryScreen SaveSheetScreen
              CardDetailScreen SearchScreen AccountScreen StacksScreen
              StackDetailScreen CuratedScreen NewStackSheet
    test/render.tsx  test/setup.ts
  assets/stitch/*.jpg|png          images pulled from the Stitch HTML
.github/workflows/frontend-ci.yml
```
Tests sit next to code in `__tests__/` folders.

---

### Task 1: Scaffold `frontend/`, design tokens, assets, repo cleanup

**Files:**
- Create: everything under `frontend/` listed above except `src/api`, `src/auth`, `src/screens`, `src/components`, `src/hooks`, `src/lib`; `frontend/src/__tests__/smoke.test.tsx`
- Delete (git): `website/` (tracked files), old `app/`
- Local only (not committed): `docs/design/stitch/` (Stitch HTML + full screenshots copied from the session scratchpad)

**Interfaces:**
- Produces: Tailwind classes `bg-canvas bg-card bg-raised border-hairline text-ink text-ink-2 text-ink-3 bg-accent text-accent text-on-accent text-success text-danger bg-danger-soft`; font classes `font-display` (Newsreader_600SemiBold), `font-display-medium` (Newsreader_500Medium), `font-display-regular` (Newsreader_400Regular), `font-display-italic` (Newsreader_400Regular_Italic), `font-sans` (Inter_400Regular), `font-sans-medium` (Inter_500Medium), `font-sans-semibold` (Inter_600SemiBold), `font-sans-italic` (Inter_400Regular_Italic), `font-lora` (Lora_400Regular); size classes `text-display-lg` 28/34, `text-display-md` 24/30, `text-display-sm` 22/28, `text-title` 15/20, `text-body` 15/22, `text-meta` 13/18, `text-label` 12/16 (+0.48 letterSpacing), `text-caption` 11/14; radius `rounded-thumb` 14, `rounded-ctl` 12, `rounded-sheet` 24.
- Produces: `src/theme/tokens.ts` exporting `colors` (the Global Constraints values, camelCase keys) for non-className use (icons, ActivityIndicator).
- Produces: npm scripts `web` = `expo start --web --port 8081`, `test` = `jest`, `typecheck` = `tsc --noEmit`, `lint` = `expo lint`.
- Produces: `assets/stitch/` files named exactly: `logo.png` (Stitch "Lately App Icon Logo" 512 png), `avatar-aanya.jpg`, `signin-trail.jpg`, `signin-desk.jpg`, `signin-cafe.jpg`, `signup-kyoto.jpg`, `signup-toast.jpg`, `signup-living.jpg`, `lib-dev-desk.jpg`, `lib-momos.jpg`, `lib-manali.jpg`, `lib-visa-desk.jpg`, `detail-momos.jpg`, `save-bg.jpg`, `stacks-kyoto-cafe.jpg`, `stacks-drip-coffee.jpg`, `stacks-espresso-bar.jpg`, `stacks-cafe-corner.jpg`, `stacks-ide-monitor.jpg`, `stacks-trekking-boots.jpg`, `stacks-mist-forest.jpg`, `stacks-yoga.jpg`, `stacks-yoga-mat.jpg`, `stacks-terminal.jpg`, `stacks-keyboard.jpg`, `stacks-linen-outfit.jpg`, `stacks-tote.jpg`.

- [ ] **Step 1: Create the app.** From repo root: `npx create-expo-app@latest frontend --template blank-typescript --no-install`, then in `frontend/`: `npm install`, then `npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar expo-image expo-font expo-clipboard expo-web-browser @expo-google-fonts/newsreader @expo-google-fonts/inter @expo-google-fonts/lora @expo/vector-icons @react-native-async-storage/async-storage react-native-reanimated react-native-worklets react-native-web react-dom @expo/metro-runtime nativewind react-native-url-polyfill @supabase/supabase-js @tanstack/react-query` and `npm i -D tailwindcss@^3.4 jest-expo jest @testing-library/react-native @types/jest`. Set `"main": "expo-router/entry"`.
- [ ] **Step 2: Configure.** `app.json`: name `Lately`, slug `lately`, scheme `lately`, `userInterfaceStyle: "light"`, `web.output: "single"`, `web.bundler: "metro"`, icon/favicon/splash from `assets/stitch/logo.png`, splash background `#FAF8F5`, plugins `expo-router`, `expo-font`. NativeWind v4 setup per its Expo guide: `babel.config.js` (`babel-preset-expo` with `jsxImportSource: "nativewind"` + `nativewind/babel`), `metro.config.js` (`withNativeWind(config, { input: "./global.css" })`), `global.css` (tailwind directives), `nativewind-env.d.ts`, `tailwind.config.js` (`presets: [require("nativewind/preset")]`, content `./app/**/*.{ts,tsx}` + `./src/**/*.{ts,tsx}`, theme.extend with the Interfaces tokens). Jest in `package.json`: preset `jest-expo`, `setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"]` (mock AsyncStorage with its jest mock), `transformIgnorePatterns` per jest-expo docs including `nativewind|react-native-css-interop|@supabase`. `.env.example` with `EXPO_PUBLIC_API_MODE=demo`, `EXPO_PUBLIC_API_URL=http://localhost:8000`, `EXPO_PUBLIC_SUPABASE_URL=https://jsvgezmgvwnldcnrjdzg.supabase.co`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=`. Ensure `frontend/.gitignore` covers `node_modules/`, `.expo/`, `dist/`, `.env`.
- [ ] **Step 3: Write the smoke test** `src/__tests__/smoke.test.tsx`: render `<Text className="font-display text-display-lg text-ink">Lately</Text>` and `expect(screen.getByText("Lately")).toBeTruthy()`.
- [ ] **Step 4: Minimal app.** `app/_layout.tsx` loads all fonts named above with `useFonts` (render nothing until loaded) and imports `../global.css`; temporary `app/index.tsx` renders the smoke text on `bg-canvas` (Task 5 replaces both).
- [ ] **Step 5: Pull assets.** A one-off script in the session scratchpad parses the `<img alt=… src=https://lh3…>` tags in the saved Stitch HTML (`00-signup`, `01-signin`, `02-library`, `03-save-sheet` incl. its CSS `url()` background, `04-card-detail`, `05-profile`, `07-stacks`), downloads each with `=s0` appended, and writes them under the Interfaces names (match on alt text: "Profile"/"Aanya" → avatar, "Sunlit mountain" → signin-trail, "Minimalist wooden desk" → signin-desk, "Cozy coffee shop" → signin-cafe, "Kyoto coffee shop" → signup-kyoto, "sourdough" → signup-toast, "living space" → signup-living, "developer workstation" → lib-dev-desk, "dumplings momos" → lib-momos, "Manali" → lib-manali, "creative desk" → lib-visa-desk, "Steaming hot momos" → detail-momos, Stacks alts "Kyoto cafe"…"Canvas tote" → stacks-*; skip "Dev desk setup" (duplicate of lib-dev-desk)). Copy `logo-icon.png` → `logo.png`. Copy all Stitch HTML + full screenshots to `docs/design/stitch/`.
- [ ] **Step 6: Verify.** `npm test` → 1 passed. `npm run typecheck` → no errors. `npx expo export --platform web` → exits 0 and writes `dist/`. `npm run lint` once (it creates `eslint.config.js` via `eslint-config-expo`; commit it) → no errors. If NativeWind fails on SDK 57 (className ignored or bundling error), stop and report before Task 2.
- [ ] **Step 7: Remove old projects.** Note what the uncommitted change in `website/src/app/layout.tsx` is (for the report), then `git rm -r -q -f app website` (removes tracked files from index and disk); leave untracked/ignored leftovers (e.g. `website/.env.local`, `website/node_modules`, `website/.next`) in place and list them in the task report for the user to decide.
- [ ] **Step 8: Commit.** `git add frontend .gitignore` (root `.gitignore` comment: replace "app/.gitignore and website/.gitignore" with "frontend/.gitignore") plus the staged removals; message `feat(frontend): scaffold Expo app with Stitch tokens; remove website/ and old app/`.

---

### Task 2: API contract, demo data and demo API

**Files:**
- Create: `src/api/contract.ts`, `src/api/demo-data.ts`, `src/api/demo.ts`, `src/lib/instagram.ts`, `src/lib/search.ts`, `src/lib/storage.ts`
- Test: `src/api/__tests__/demo.test.ts`, `src/lib/__tests__/instagram.test.ts`, `src/lib/__tests__/search.test.ts`

**Interfaces:**
- Produces (`contract.ts`, the backend's to-do list — keep field names snake_case to match FastAPI):
  ```ts
  export type ReelStatus = "pending" | "enriched" | "partial";
  export type Category = "Dev & Tools" | "Food & Places" | "Career & Jobs" | "Fitness" | "Style & Vibes" | "Watch Later";
  export type Channel = "app_share" | "web" | "meta_dm";
  export interface Save { id: string; source_url: string; shortcode: string | null; status: ReelStatus;
    note: string | null; created_at: string; title: string | null; caption: string | null;
    category: Category | null; thumbnail_url: string | null; creator: string | null; channel: Channel }
  export interface Place { name: string; address: string; maps_url: string | null }
  export interface SaveDetail extends Save { summary: string | null; steps: string[] | null;
    tags: string[] | null; places: Place[]; media_status: "pending" | "partial" | "ready" | "failed" }
  export interface SaveResult { reel_id: string; deduped: boolean; status: ReelStatus }
  export interface ConnectedAccount { provider: "instagram" | "google"; label: string; status: "active" | "secured" }
  export interface Me { id: string; email: string; name: string; handle: string; avatar_url: string | null;
    plan: "free" | "pro" | "lifetime"; saves_this_month: number; saves_limit: number; resets_on: string;
    total_saves: number; stacks_count: number; member_since: string; connected_accounts: ConnectedAccount[] }
  export interface Preferences { reading_font: "newsreader" | "inter" | "lora"; text_size: 14 | 16 | 18 | 20;
    theme: "light" | "dark" | "system"; push_digests: boolean; offline_reading: boolean }
  export interface Stack { id: string; name: string; category: Category | null; save_count: number;
    updated_at: string; cover_urls: string[] }
  export interface StackDetail extends Stack { saves: Save[] }
  export interface SearchHit { save: Save; why: string[] }
  export interface CuratedSection { kind: "row" | "list"; title: string; subtitle: string | null; saves: Save[] }
  export interface CuratedFeed { date_label: string; hero: { label: string; title: string; subtitle: string;
    image_url: string | null; save_ids: string[] }; sections: CuratedSection[] }
  export type ApiErrorCode = "BAD_URL" | "QUOTA_EXCEEDED" | "RATE_LIMITED" | "NOT_FOUND" | "UNAUTHORIZED" | "NETWORK" | "SERVER";
  export class ApiError extends Error { constructor(readonly code: ApiErrorCode, readonly status: number, message?: string) }
  export interface LatelyApi {
    createSave(text: string): Promise<SaveResult>;                       // POST   /saves {text, channel:"app_share"}
    listSaves(p?: { before?: string; limit?: number }): Promise<Save[]>;  // GET    /saves?before&limit
    getSave(id: string): Promise<SaveDetail>;                           // GET    /saves/{id}
    setNote(id: string, note: string): Promise<Save>;                    // PATCH  /saves/{id} {note}
    deleteSave(id: string): Promise<void>;                               // DELETE /saves/{id}
    getMe(): Promise<Me>;                                                // GET    /me
    getPreferences(): Promise<Preferences>;                              // GET    /me/preferences
    updatePreferences(p: Partial<Preferences>): Promise<Preferences>;    // PATCH  /me/preferences
    search(q: string): Promise<SearchHit[]>;                             // GET    /search?q
    listStacks(): Promise<Stack[]>;                                      // GET    /stacks
    createStack(name: string): Promise<Stack>;                           // POST   /stacks {name}
    getStack(id: string): Promise<StackDetail>;                          // GET    /stacks/{id}
    addToStack(stackId: string, saveId: string): Promise<void>;          // POST   /stacks/{id}/saves {save_id}
    getCurated(): Promise<CuratedFeed>;                                  // GET    /curated
    requestExport(): Promise<{ status: "queued" }>;                      // POST   /me/export
  }
  export type Endpoint = keyof LatelyApi;
  export const DEFAULT_PREFERENCES: Preferences = { reading_font: "newsreader", text_size: 16, theme: "light", push_digests: true, offline_reading: true };
  ```
- Produces: `extractReelUrl(text: string): { url: string; shortcode: string } | null` — accepts `instagram.com/(reel|reels|p|tv)/<code>` and `/share/reel/<code>`, with/without `www.`, `http(s)`; returns canonical `https://www.instagram.com/reel/<code>/` (or `/p/<code>/`), query and fragment dropped.
- Produces: `matchSaves(saves: SaveDetail[], query: string): SearchHit[]` — plain lowercase `includes` per term (no RegExp built from input); a save matches if every term hits some field; score note 3, title 2, place 2, tag 1, caption 1, creator 1, link 1; ties newest first. `why` entries, in this order, exact formats: `your note: “<note>”`, `title: <term>`, `📍 <place name>`, `#<tag>`, `caption: <term>`, `@<creator>`. Blank query → `[]`.
- Produces: `createDemoApi(opts?: { now?: () => number; storage?: KeyValueStore }): LatelyApi` and `PENDING_MS = 6000`, `DEMO_USER` (`{ name: "Aanya Sharma", email: "aanya.sharma@example.com", handle: "aanya" }`). `KeyValueStore = { getItem(k): Promise<string|null>; setItem(k, v): Promise<void> }` in `lib/storage.ts` (default AsyncStorage).
- Demo data (`demo-data.ts`): ≥ 12 saves covering all six categories, built relative to `now`. Required, with exact copy: (1) "5 GitHub search tricks to find great repos", note "job search tips", Dev & Tools, 2 d, `lib-dev-desk`; (2) "Hole-in-the-wall momo spot in Koramangala", note "cafe to try", Food & Places, 5 d, creator `bangalorefoodie`, `lib-momos` (detail hero `detail-momos`), summary "A cozy hidden gem serving authentic Darjeeling and Tibetan momos with fire roasted tomato chutney. Known for quick service, street-side ambiance, and budget-friendly platters.", steps ["Cash only", "Try the jhol momo", "≈ ₹150 for two"], places [{ name: "Momo Point", address: "Koramangala 5th Block" }], tags [momos, streetfood, budget, bangaloreeats]; (3) "Manali in 4 days on ₹12k", note "trek in june", Food & Places, 1 w, `lib-manali`; (4) "Companies that sponsor visas — GitHub list", note "repo for job search", Career & Jobs, 2 w, `lib-visa-desk`; (5) a `pending` save `https://www.instagram.com/reel/C8xYz12/`, note "trek in june", 1 min old; (6) a `partial` save, caption "Day 3 of the 30-day mobility challenge…", Fitness, 1 w; plus ≥ 2 cafes (for the Curated hero), ≥ 3 saves older than 35 days, Fitness/Style saves using the `stacks-*` images. Six stacks with exact names: "Cafes to try" (Food), "Job hunt" (Career), "Manali trip" (Food), "Mobility routine" (Fitness), "Dev tools" (Dev), "Outfit ideas" (Style), each listing member save ids (counts derive from members). Images via `Image.resolveAssetSource(require(...)).uri`.

- [ ] **Step 1: Write failing tests.**
  - `instagram.test.ts`: `extractReelUrl("Look https://www.instagram.com/reel/C8xYz12/?igsh=abc 🔥")` → `{ url: "https://www.instagram.com/reel/C8xYz12/", shortcode: "C8xYz12" }`; `instagram.com/reels/AbC_1-2` (no scheme) → shortcode `AbC_1-2`; `https://instagram.com/share/reel/XyZ` → shortcode `XyZ`; `https://www.instagram.com/someprofile/` → `null`; `"hello"` → `null`.
  - `search.test.ts`: on the demo saves, `matchSaves(s, "momo")[0].save.title` = the momo title and its `why` contains `"#momos"`; `matchSaves(s, "cafe to try")[0].why[0]` = `your note: “cafe to try”`; `matchSaves(s, "koramangala")[0].why` contains `"📍 Momo Point"`; `matchSaves(s, "c++(")` → `[]` without throwing; `matchSaves(s, "   ")` → `[]`.
  - `demo.test.ts` (fixed `now`, in-memory storage): `listSaves()` newest first and `listSaves({ limit: 2 })` has 2 items; `listSaves({ before: items[1].created_at })` starts after item 1; `createSave("https://www.instagram.com/reel/NEW123/")` → `{ deduped: false, status: "pending" }` and it is first in `listSaves()`; advancing `now` by `PENDING_MS` makes it `enriched` with non-null `title` and `thumbnail_url`; saving the same link again → `deduped: true`, same `reel_id`; `createSave("hello")` rejects `ApiError` code `BAD_URL` status 422; links with shortcode `QUOTA` → `QUOTA_EXCEEDED` 429, `RATE` → `RATE_LIMITED` 429, `NETWORK` → `NETWORK` 0, `PARTIAL` → saved, becomes `partial` after `PENDING_MS`; `setNote` changes the note; `deleteSave` then `getSave` rejects `NOT_FOUND` 404; `getMe()` → `saves_limit` 20, `resets_on` = first day of next month (ISO date), `total_saves` = number of saves; `listStacks()` has the 6 names; `createStack("Trip")` appears with `save_count` 0; `addToStack(trip.id, momo.id)` → `getStack(trip.id).saves` contains momo; `search("momo")[0].save.id` = momo id; `updatePreferences({ reading_font: "lora" })` then `getPreferences()` → `"lora"` (persisted in storage); `getCurated()` → hero `save_ids.length` ≥ 2 and ≥ 2 sections.
- [ ] **Step 2: Run** `npm test -- src/api src/lib` → FAIL (modules missing).
- [ ] **Step 3: Implement** `contract.ts`, `instagram.ts`, `search.ts`, `storage.ts`, `demo-data.ts`, `demo.ts`. Demo state is in memory (mutations persist until reload; preferences persist in storage). New saves enrich from a pool of extra demo contents. Every demo call awaits ~150 ms (skip when `now` is injected) so loading states show in the browser.
- [ ] **Step 4: Run** `npm test -- src/api src/lib` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat(frontend): API contract and demo API with Stitch content`.

---

### Task 3: HTTP client and mode routing

**Files:**
- Create: `src/config.ts`, `src/api/http.ts`, `src/api/index.ts`
- Test: `src/api/__tests__/http.test.ts`, `src/api/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `LatelyApi`, `ApiError`, `Save` (Task 2).
- Produces: `config: { apiMode: "demo" | "live"; apiUrl: string; supabaseUrl: string; supabaseKey: string }` (`apiMode` = `"live"` only when env says exactly `live`).
- Produces: `createHttpApi(o: { baseUrl: string; getToken: () => Promise<string | null>; refreshToken: () => Promise<string | null>; fetchImpl?: typeof fetch }): LatelyApi` — implements all 15 calls at the paths in the contract comments; `toSave(raw: Record<string, unknown>): Save` fills absent fields (`title`, `caption`, `category`, `thumbnail_url`, `creator` → `null`; `channel` → `"app_share"`).
- Produces: `LIVE_ENDPOINTS: ReadonlySet<Endpoint>` = `createSave`, `listSaves`, `setNote`; `createApi(o: { mode: "demo" | "live"; demo: LatelyApi; http: LatelyApi; live?: ReadonlySet<Endpoint> }): LatelyApi`; `ApiProvider({ api, children })`, `useApi(): LatelyApi`.

- [ ] **Step 1: Write failing tests** (`fetchImpl` is a jest mock):
  - sends `Authorization: Bearer tok-1` and `Content-Type: application/json` on `createSave`; body `{ text, channel: "app_share" }`.
  - 422 `{ error: { code: "BAD_URL", message: "x" } }` → rejects `ApiError` code `BAD_URL` status 422.
  - 500 with non-JSON body → `ApiError` code `SERVER` status 500.
  - `fetchImpl` throws `TypeError` → `ApiError` code `NETWORK` status 0.
  - first call 401, `refreshToken` → `"tok-2"`, retry 200 → resolves, second request carries `Bearer tok-2`, `refreshToken` called once; 401 twice → `ApiError` `UNAUTHORIZED`.
  - `createSave` 200 `{ reel_id, deduped: true, status: "pending" }` → `deduped: true`.
  - `listSaves({ before: "2026-10-01T00:00:00Z", limit: 25 })` requests `/saves?before=2026-10-01T00%3A00%3A00Z&limit=25`.
  - `toSave({ id, source_url, status: "pending", note: null, created_at })` → `title === null && channel === "app_share"`.
  - `createApi({ mode: "live", … })`: `listSaves` hits http mock, `getMe` hits demo mock; `mode: "demo"` sends `listSaves` to demo.
- [ ] **Step 2: Run** `npm test -- src/api/__tests__/http src/api/__tests__/index` → FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(frontend): HTTP API client and per-endpoint demo/live routing`.

---

### Task 4: UI kit, toast and ReelCard

**Files:**
- Create: `src/theme/categories.ts`, `src/lib/dates.ts`, `src/components/{Button,Chip,CategoryDot,Icon,Thumb,Skeleton,Sheet,Toast,Header,TabBar,ReelCard,ConfirmDialog}.tsx`
- Test: `src/lib/__tests__/dates.test.ts`, `src/components/__tests__/ReelCard.test.tsx`

**Interfaces:**
- Produces: `CATEGORY: Record<Category, { color: string; icon: string }>` (Global Constraints).
- Produces: `relativeShort(iso: string, now: number): string` ( < 1 h "Just now", < 24 h "{h}h", < 7 d "{d}d", < 30 d "{w}w", else "{m}mo"); `savedAgo(iso, now): string` ("Saved today", "Saved yesterday", "Saved {n} days ago", ≥ 14 d "Saved {w} weeks ago"); `shortDate(iso): string` ("1 Nov"); `curatedDate(now): string` ("Sunday, 4 Oct").
- Produces: `ToastProvider` + `useToast(): { show(message: string): void }` (bottom toast, 2.5 s, ink background, white text).
- Produces components: `Button({ title, onPress, variant?: "primary" | "secondary" | "ghost" | "danger", icon?, disabled?, loading? })`; `Chip({ label, active?, dotColor?, onPress? })`; `CategoryDot({ category, size? })`; `Icon({ name, size?, color? })` (MaterialIcons); `Thumb({ uri, aspect?: number, radius?: number, children? })` (expo-image, `contentFit="cover"`, 300 ms fade); `Skeleton({ style })` (opacity 0.5↔1, 1.2 s loop, respects reduced motion); `Sheet({ visible, onClose, children })` (backdrop `rgba(28,26,23,0.35)`, card `#FFFEFB`, radius 24 top, handle, slides up 250 ms ease-out); `Header({ onAvatar, onBookmark })` (logo 32 + "Lately" Newsreader 28 + bookmark + avatar 40); `TabBar` (expo-router `tabBar` prop: icons `menu-book` Curated, `grid-view` Library, `add-circle-outline` Save, `folder-special` Stacks; active label/icon accent, inactive ink-2; hairline top); `ReelCard({ save, now?, onPress })`; `ConfirmDialog({ visible, title, message, confirmLabel, onConfirm, onCancel })`.

- [ ] **Step 1: Write failing tests.**
  - `dates.test.ts` with `now = Date.parse("2026-10-04T12:00:00Z")`: 10 min ago → "Just now"; 2 d → "2d"; 8 d → "1w"; 15 d → "2w"; 40 d → "1mo"; `savedAgo` 5 d → "Saved 5 days ago", 1 d → "Saved yesterday"; `shortDate("2026-11-01")` → "1 Nov"; `curatedDate(now)` → "Sunday, 4 Oct".
  - `ReelCard.test.tsx` (plain RNTL `render`; build saves from `createDemoApi` data with fixed `now`): enriched momo → shows title, "“cafe to try”", "Food & Places · 5d"; pending → "Getting details…" and "instagram.com/reel/C8xYz12"; partial → "Preview unavailable" and "Day 3 of the 30-day mobility challenge…"; enriched with `title: null` and caption "Line one\nLine two" → shows "Line one"; title and caption both null → shows the link; title `Text` has `numberOfLines` 2 and note `Text` `numberOfLines` 1 for a 250-char title/note; press calls `onPress`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** ReelCard matches `02 Library — light`: 4:5 thumb radius 14 with 1 px inner border `rgba(28,26,23,0.06)`; white 36 px circular category-icon badge top-right when category set; title 8 px below; note italic ink-2 in “ ”; meta row 6 px dot + "{category} · {relativeShort}" (no category → just date). Pending thumb = Skeleton + centered `movie` icon + "Getting details…"; partial thumb = raised panel + `image-not-supported` icon + "Preview unavailable".
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(frontend): UI kit and ReelCard (pending, ready, partial)`.

---

### Task 5: Auth, providers, gate and the Sign in / Sign up screens

**Files:**
- Create: `src/auth/supabase.ts`, `src/auth/AuthProvider.tsx`, `src/test/render.tsx`, `src/screens/SignInScreen.tsx`, `src/screens/CheckEmailScreen.tsx`, `app/(auth)/_layout.tsx`, `app/(auth)/sign-in.tsx`, `app/(auth)/check-email.tsx`
- Modify: `app/_layout.tsx` (replace temporary), delete temporary `app/index.tsx`
- Test: `src/screens/__tests__/SignInScreen.test.tsx`, `src/auth/__tests__/AuthProvider.test.tsx`

**Interfaces:**
- Consumes: `Sheet`, `Thumb`, `Button`, `Chip`, `Icon`, `ToastProvider`/`useToast` (Task 4), `config`, `createApi`, `createDemoApi`, `createHttpApi`, `ApiProvider`, `DEMO_USER`.
- Produces: `useAuth(): AuthValue` where `AuthValue = { status: "loading" | "signed-out" | "signed-in"; user: { id: string; email: string; name: string; avatarUrl: string | null } | null; mode: "demo" | "live"; signInDemo(): Promise<void>; signInWithEmail(email: string): Promise<void>; verifyCode(email: string, code: string): Promise<void>; signInWithGoogle(): Promise<void>; signOut(): Promise<void>; getAccessToken(): Promise<string | null>; refreshAccessToken(): Promise<string | null> }`. Demo session persists in storage key `lately.demo-session`; live uses Supabase (`createClient` with AsyncStorage, `autoRefreshToken`, `persistSession`, `detectSessionInUrl` true on web; `import "react-native-url-polyfill/auto"`).
- Produces: `renderWithProviders(ui, o?: { api?: LatelyApi; auth?: Partial<AuthValue> }): RenderResult` — wraps QueryClient (retry off), ApiProvider, a static auth context, ToastProvider, SafeAreaProvider.
- Root layout: fonts → `AuthProvider` → `QueryClientProvider` (reads retry 2, mutations 0) → `ApiProvider` (api built once from `config` + auth token functions) → `ToastProvider` → `Stack` with `Stack.Protected guard={signed-in}` around `(tabs)`, `reel/[id]`, `stack/[id]`, `search`, `account`, `save-sheet` (presentation `transparentModal`, no animation for the backdrop; sheet animates itself) and `Stack.Protected guard={signed-out}` around `(auth)`. Headers hidden everywhere.

Copy (exact). Sign in tab: pill "YOUR MINDFUL VAULT"; "Lately"; "Save it with a reason." / "Find it when you need it."; toggle "Sign in" | "Sign up"; tilted 3-card stack (left `signin-trail` with "Reels" chip and "@alpine…", center `signin-cafe` with "REELS" chip, "@cafestory", "Sunday morning jazz •…", note card "Your Note" · "2m ago" · "“Quiet spot for Sunday…”", right `signin-desk` with "0:34"); pills "Organized reading" "Instant recall"; buttons "Continue with Google" (accent), "Continue with Instagram", "Continue with Facebook", "Continue with email"; footer "Don't have an account? Sign up". Sign up tab: subtitle "Create your personal vault. Save what inspires you across Instagram."; image strip `signup-kyoto` "Kyoto", `signup-toast` "Brunch notes", `signup-living` "Studio"; "Sign up with Google" (accent), "Sign up with Instagram", half-width "Facebook" | "With Email"; pills "Organized reading" "Instant recall" "Private & encrypted"; footer "Already have an account? Sign in". Email sheet: title "Continue with email", field placeholder "you@example.com", button "Send sign-in link". Check email: "Check your inbox", "We sent a sign-in link to {email}. Open it on this phone, or enter the 6-digit code below.", 6-digit field, "Verify", "Resend link", "Use a different email".

- [ ] **Step 1: Write failing tests.**
  - `SignInScreen`: shows "Continue with Google"; pressing "Sign up" shows "Sign up with Google" and "Private & encrypted"; demo mode: pressing "Continue with Instagram" calls `signInDemo`; live mode: pressing "Continue with Instagram" shows toast "Instagram sign-in is coming soon"; live mode email flow: "Continue with email" → type `me@x.com` → "Send sign-in link" calls `signInWithEmail("me@x.com")` and `router.push("/check-email?email=me%40x.com")` (mock `expo-router`); "Send sign-in link" disabled for `"me@"`.
  - `CheckEmailScreen`: "Verify" disabled until 6 digits; entering `123456` + Verify calls `verifyCode(email, "123456")`.
  - `AuthProvider` (demo mode): starts `signed-out`; after `signInDemo()` status `signed-in` and `user.name` = "Aanya Sharma"; `signOut()` → `signed-out`; a new provider over the same storage starts `signed-in`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the files above. Build the tilted stack with absolutely-positioned `Thumb`s rotated −8° / 0° / 8°, side cards scaled 0.88. The email step uses `Sheet` (Task 4).
- [ ] **Step 4: Run** → PASS; typecheck clean; `npm run web` and confirm the sign-in screen renders at `localhost:8081` (stop the server after).
- [ ] **Step 5: Commit** `feat(frontend): auth (demo + Supabase), route gate, sign-in and sign-up screens`.

---

### Task 6: Tabs and the Library screen

**Files:**
- Create: `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/save.tsx`, `app/(tabs)/curated.tsx`, `app/(tabs)/stacks.tsx`, `src/hooks/useSaves.ts`, `src/screens/LibraryScreen.tsx`
- Test: `src/screens/__tests__/LibraryScreen.test.tsx`

**Interfaces:**
- Consumes: `useApi`, `ReelCard`, `Header`, `Chip`, `TabBar`, `CATEGORY`.
- Produces: `useSaves(): { saves: Save[]; isLoading: boolean; fetchNextPage(): void; hasNextPage: boolean; refetch(): Promise<unknown>; isRefetching: boolean }` — `useInfiniteQuery(["saves"])`, page size 25, `before` = last item's `created_at`, `refetchInterval` 4000 while any loaded save is `pending`, else off. Query keys used app-wide: `["saves"]`, `["save", id]`, `["me"]`, `["stacks"]`, `["stack", id]`, `["curated"]`, `["prefs"]`, `["search", q]`.
- Tabs layout: order Curated, Library (initial), Save, Stacks; the Save tab's `tabPress` is prevented and does `router.push("/save-sheet")`; `save.tsx` renders `null`. `curated.tsx` / `stacks.tsx` render a centered Newsreader title until Task 11.

Copy: search placeholder "Search what you remember...", "RECENTLY SAVED", "{n} reels", FAB "Paste link". Empty state: "Your Lately is empty — for now", "Save a reel from Instagram and it shows up here.", steps "Open a reel in Instagram" / "Tap Share → Lately" / "Add a reason — optional", button "Paste a link instead".

- [ ] **Step 1: Write failing tests** (demo API with fixed `now`; mock `expo-router`):
  - renders the momo and GitHub titles; shows "{total_saves} reels" from `getMe`.
  - chips: "All" active by default; pressing "Food & Places" hides "5 GitHub search tricks to find great repos" and keeps the momo card; pressing "All" restores it. Only categories present in loaded saves get chips.
  - pressing the search field → `router.push("/search")`; avatar → `router.push("/account")`; bookmark → `router.push("/stacks")`; "Paste link" → `router.push("/save-sheet")`; card → `router.push("/reel/<id>")`.
  - API whose `listSaves` returns `[]` → "Your Lately is empty — for now"; "Paste a link instead" → `router.push("/save-sheet")`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** 2-column `FlatList` (`numColumns` 2, gap 12, side padding 16), sticky-free header block (Header, search field 48 h with search + mic icons, chips row horizontal scroll, section row), `onEndReached` → `fetchNextPage`, pull-to-refresh, FAB bottom-right above the tab bar (accent, radius full, `add` icon + "Paste link"). Header matches Stitch spacing (64 h, hairline bottom).
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(frontend): tab bar and Library screen`.

---

### Task 7: Save sheet

**Files:**
- Create: `src/lib/saveOutcome.ts`, `src/screens/SaveSheetScreen.tsx`, `app/save-sheet.tsx`
- Test: `src/lib/__tests__/saveOutcome.test.ts`, `src/screens/__tests__/SaveSheetScreen.test.tsx`

**Interfaces:**
- Consumes: `useApi`, `Sheet`, `Button`, `Chip`, `extractReelUrl`, `savedAgo`, `shortDate`.
- Produces: `type SaveOutcome = { kind: "saved"; reelId: string } | { kind: "deduped"; reelId: string } | { kind: "bad_url" } | { kind: "quota" } | { kind: "rate_limited" } | { kind: "network" }`; `outcomeFromResult(r: SaveResult): SaveOutcome`; `outcomeFromError(e: unknown): SaveOutcome` (`BAD_URL`→bad_url, `QUOTA_EXCEEDED`→quota, `RATE_LIMITED`→rate_limited, anything else→network).
- Screen input: route param `text` (optional). No text → paste step; with text → saves immediately. On success invalidates `["saves"]` and `["me"]`.

Copy (exact): paste step "Paste a reel link", placeholder "instagram.com/reel/…", button "Save". Saving: "Saving…". Saved: logo with green check badge, "Saved to Lately", "Your card will be ready in a few seconds.", link pill (`instagram.com/reel/<code>`, truncated), "Why are you saving this? (optional)", placeholder "e.g. cafe to try in June", chips "To try" "To buy" "To visit" "To learn" "Watch later" (tap sets the field to the chip text), "Save note", "Skip", footer "Closes in {n} s" (hidden once the note field is focused). Deduped: "Already in your Lately", "{savedAgo}." , existing note read-only in quotes, "Open card", "Close". Bad URL: "No reel link found", "Share the reel itself, not a profile or story.", "Close". Quota: "You've used all {saves_limit} free saves this month", full accent bar "{n}/{n}", "Saves reset on {shortDate(resets_on)}.", "Close". Rate: "That's a lot of saves at once", "Try again in a minute.", "Close". Network: "Couldn't reach Lately", "Check your connection and try again.", "Try again", "Close". The saved state in Stitch shows over a dimmed reel: on web, the backdrop is the previous screen dimmed.

- [ ] **Step 1: Write failing tests.**
  - `saveOutcome.test.ts`: each mapping above, incl. `new Error("x")` → network.
  - Screen (demo API, fixed `now`, fake timers): with text `https://www.instagram.com/reel/NEW123/` → "Saved to Lately"; type "for june" → "Save note" calls `setNote(id, "for june")` then `router.back()`; with an existing momo link → "Already in your Lately" and "Saved 5 days ago."; with `"hello"` → "No reel link found"; with shortcode `QUOTA` → "You've used all 20 free saves this month" and "Saves reset on 1 Nov."; `RATE` → "That's a lot of saves at once"; `NETWORK` → "Couldn't reach Lately", and "Try again" with a valid link then shows "Saved to Lately"; paste step: pressing "Save" twice quickly → `createSave` called once; after saved, advancing 5000 ms calls `router.back()`; focusing the note field then advancing 5000 ms does not.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(frontend): save sheet with every API outcome`.

---

### Task 8: Card detail

**Files:**
- Create: `src/lib/share.ts`, `src/components/detail/{NoteBlock,ProgressTracker,PlaceCard}.tsx`, `src/screens/CardDetailScreen.tsx`, `app/reel/[id].tsx`
- Test: `src/screens/__tests__/CardDetailScreen.test.tsx`

**Interfaces:**
- Consumes: `useApi`, `Thumb`, `Chip`, `ConfirmDialog`, `useToast`, `savedAgo`, `CATEGORY`.
- Produces: `shareOrCopy(o: { title: string; url: string }): Promise<"shared" | "copied">` (RN `Share.share`; on failure/unsupported, `expo-clipboard` copy → `"copied"`; caller toasts "Link copied").
- Produces: `NoteBlock({ note, onSave(note: string): Promise<void>, textStyle? })` — `textStyle` is how Task 10 applies reading prefs; CardDetail passes a `readingStyle` prop through to NoteBlock and the summary `Text` (default undefined).
- Query `["save", id]` with `refetchInterval` 4000 while `status === "pending"`.

Copy (exact): top bar back, "Reel Detail", "•", "Lately" (Newsreader italic accent), share icon, logo; status "READY • SYNCED" (success dot) / "GETTING DETAILS" / "PREVIEW UNAVAILABLE"; bookmark + `more-vert` icons; hero badge "Reel"; "Open in Instagram ↗"; "@{creator}" left, "Instagram" right; category chip; "• {savedAgo}"; note block "YOUR NOTE" + pencil, note in italic quotes, empty → "Add a note" + "A note makes this easy to find later."; "SUMMARY"; "GOOD TO KNOW"; place card name/address + "Open in Maps" (opens `maps_url` or a Google Maps search URL); tags as "#tag" chips; "Original caption" collapsible; footer logo + "Saved to Lately via {Share|Web|DM}" + "Export"; tracker "Saved" / "Getting the preview" / "Writing the summary"; menu item "Delete"; dialog "Delete this reel?", "It will be removed from your Lately.", "Delete", "Cancel"; not found "This card isn't here anymore", "Back to Library".

- [ ] **Step 1: Write failing tests** (demo API, fixed `now`, mock `expo-router` with `useLocalSearchParams` → `{ id }`):
  - momo → title, "READY • SYNCED", "Cash only", "Momo Point", "#momos", "Saved 5 days ago", "@bangalorefoodie".
  - pending save → "GETTING DETAILS", "Getting the preview", no "SUMMARY".
  - partial save → "PREVIEW UNAVAILABLE" and its caption text.
  - pencil → type "for a date" → save → `setNote(id, "for a date")` and the new note shows.
  - ⋮ → "Delete" → "Delete this reel?" → "Delete" → `deleteSave(id)` and `router.back()`; "Cancel" does not delete.
  - unknown id → "This card isn't here anymore"; "Back to Library" → `router.replace("/")`.
  - "Export" calls `shareOrCopy` with `{ title, url: source_url }` (mock `src/lib/share`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to match `04 Card detail — light` (hero 4:5 radius 14, hairline dividers, note/place cards `bg-card` + hairline + radius 16). The bookmark is wired in Task 11.
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(frontend): card detail with note edit, delete, export and processing state`.

---

### Task 9: Search

**Files:**
- Create: `src/lib/recent.ts`, `src/screens/SearchScreen.tsx`, `app/search.tsx`
- Test: `src/lib/__tests__/recent.test.ts`, `src/screens/__tests__/SearchScreen.test.tsx`

**Interfaces:**
- Consumes: `useApi().search`, `Thumb`, `relativeShort`, `KeyValueStore`.
- Produces: Search reads an optional route param `q` and runs it on mount (used by Curated "See all").
- Produces: `loadRecent(store): Promise<string[]>`, `pushRecent(store, q): Promise<string[]>` — trimmed, case-insensitive dedupe, newest first, max 5, key `lately.recent-searches`.

Copy: placeholder "Search what you remember…", "Recent", "Try", try chips "that cafe reel", "workout for back pain", "repo for job search"; results header "{n} reels" ("1 reel"); empty: "Nothing for “{q}” yet", "Try a word from your note, a place, or the creator's name."

- [ ] **Step 1: Write failing tests.** `recent.test.ts`: push "momo", "Momo ", "manali" → `["manali", "momo"]`; 7 pushes keep 5. Screen (fake timers, 250 ms debounce): type "momo" → after 250 ms first row is the momo title with a "#momos" chip and header "1 reel" or "{n} reels"; submit adds "momo" to Recent; clear field → "Recent" shows "momo"; tapping it re-runs; type "zzzz" → "Nothing for “zzzz” yet"; type "c++(" → no throw, empty state; back icon → `router.back()`; result row → `router.push("/reel/<id>")`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (list rows: 64×80 thumb radius 10, 2-line title, why chips on raised bg, date right).
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(frontend): search with recent queries and why-it-matched chips`.

---

### Task 10: Profile & Settings

**Files:**
- Create: `src/hooks/usePreferences.ts`, `src/components/settings/{SettingsSection,OptionCard}.tsx`, `src/screens/AccountScreen.tsx`, `app/account.tsx`
- Modify: `src/screens/CardDetailScreen.tsx` (pass `readingStyle` from `useReadingStyle()`)
- Test: `src/hooks/__tests__/usePreferences.test.tsx`, `src/screens/__tests__/AccountScreen.test.tsx`

**Interfaces:**
- Consumes: `useApi` (`getMe`, `getPreferences`, `updatePreferences`, `requestExport`), `useAuth().signOut`, `useToast`.
- Produces: `usePreferences(): { prefs: Preferences; update(p: Partial<Preferences>): void }` (optimistic, query `["prefs"]`); `useReadingStyle(): { fontFamily: string; fontSize: number; lineHeight: number }` (newsreader → `Newsreader_400Regular`, inter → `Inter_400Regular`, lora → `Lora_400Regular`; lineHeight = round(size × 1.5)).

Copy (exact, from `05 Profile & Settings`): header "LATELY" over "Account and Settings"; name, "@{handle} · {email}"; chips "{total_saves} Saved Reels", "{stacks_count} Collections", "Vault Member ({member_since as Mon YYYY})"; pill "Connected to @{instagram label}"; section "Reading Experience & Appearance": "Reading Font" / "Serif or Sans for summaries & notes" — cards "Newsreader"/"Default", "Inter"/"Modern", "Lora"/"Classic"; "Text Size" / "Adjust editorial text scale" + badge "Default (16px)" or "{n}px"; stops 14px/16px/18px/20px (tappable track, no slider lib); "Theme & Appearance" / "Choose your color experience" — "Light"/"Warm Cream", "Dark"/"Espresso", "System"/"Auto matches"; when Dark/System selected: "Dark theme is coming soon — Lately stays light for now."; section "Account & Security": "Password & Security" / "Last changed 3 months ago" / "Reset"; "Connected Accounts" / "Sync services & authenticators" with rows "{label}" + "Active"/"Secured"; "Download Vault Archive" / "Export all reels & notes as JSON or Markdown"; section "Reading Preferences": "Push Digests" / "Weekly summaries of your curated reels", "Offline Reading Storage" / "Keep recent transcripts ready offline" (checkboxes); danger card "Log Out of Lately" / "Session will safely end on this device"; footer logo, "Lately for iOS & Web v{app version}", "Made for mindful reading & quiet curation". Toasts: Reset → "Password reset is coming soon"; Download → "We'll email your archive when it's ready".

- [ ] **Step 1: Write failing tests.** Hook: `update({ reading_font: "lora" })` → `useReadingStyle().fontFamily === "Lora_400Regular"`; `text_size: 18` → `fontSize 18, lineHeight 27`. Screen: shows "Aanya Sharma" and "@aanya · aanya.sharma@example.com"; tapping "Lora" → `updatePreferences({ reading_font: "lora" })`; tapping "20px" → badge "20px"; tapping "Dark" shows the coming-soon line; "Download Vault Archive" → `requestExport` + toast; unchecking "Push Digests" → `updatePreferences({ push_digests: false })`; "Log Out of Lately" → `signOut`; back → `router.back()`. CardDetail: with prefs `text_size: 20`, the summary `Text` style has `fontSize: 20`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** matching the Stitch layout (avatar 112 with accent camera badge, section headers Newsreader 22 with icon, white cards with hairline radius 16).
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(frontend): profile and settings with device reading preferences`.

---

### Task 11: Stacks, stack detail, Curated, add-to-stack

**Files:**
- Create: `src/screens/StacksScreen.tsx`, `src/screens/NewStackSheet.tsx`, `src/screens/StackDetailScreen.tsx`, `src/screens/CuratedScreen.tsx`, `src/components/detail/StackPicker.tsx`, `app/stack/[id].tsx`
- Modify: `app/(tabs)/stacks.tsx`, `app/(tabs)/curated.tsx` (render the screens), `src/screens/CardDetailScreen.tsx` (bookmark opens `StackPicker`)
- Test: `src/screens/__tests__/StacksScreen.test.tsx`, `src/screens/__tests__/CuratedScreen.test.tsx`, `src/components/__tests__/StackPicker.test.tsx`

**Interfaces:**
- Consumes: `listStacks`, `createStack`, `getStack`, `addToStack`, `getCurated`, `ReelCard`, `Thumb`, `Sheet`, `Header`, `curatedDate`, `relativeShort`.

- [ ] **Step 0: Curated design.** List screens in Stitch project `5728339997427647518`; if a "06 Curated" screen exists, save its HTML + full screenshot to `docs/design/stitch/` and build to it. Otherwise build to the layout below (from the generation prompt).

Copy. Stacks (`07 Stacks — light`): "Stacks", "Your saves, grouped your way.", outlined pill "+ New stack"; tile = 2×2 collage of `cover_urls` in one radius-14 frame (2 px gaps; missing covers → raised panel with the save title in ink-2 12 px), name (Inter 15 600), meta dot + "{n} reels · updated {relativeShort}"; dashed tile "New stack" / "Create collection". New stack sheet: "New stack", placeholder "e.g. Cafes to try", "Create" (disabled when blank). Stack detail: back, name (Newsreader 28), "{n} reels", ReelCard grid, empty "No reels here yet — add one from a card's bookmark." Stack picker sheet: "Add to stack", one row per stack (collage thumb 40, name, count), "+ New stack" row; toast "Added to {name}". Curated: Header, "Curated for you" (Newsreader 28), "{curatedDate} · picked from your saves", label "THIS WEEKEND", hero image radius 14, title (Newsreader 22), subtitle, "See all {n}" (accent); then each section: title (Newsreader 20) + optional subtitle; `row` = horizontal small ReelCards (width 140); `list` = rows with 64×80 thumb, title, italic note, date right.

- [ ] **Step 1: Write failing tests.** Stacks: shows all 6 names and "{n} reels · updated …"; "+ New stack" → type "Trip" → "Create" → "Trip" tile appears; tile press → `router.push("/stack/<id>")`; stack detail shows its saves' titles; empty stack shows the empty line. Curated: "Curated for you", "Sunday, 4 Oct · picked from your saves" (fixed `now`), "THIS WEEKEND", every section title from `getCurated()`; "See all {n}" → `router.push("/search?q=<hero category name>")` (Search reads the `q` param and runs it); a section card → `router.push("/reel/<id>")`. StackPicker: choosing "Cafes to try" calls `addToStack(stackId, saveId)` and toasts "Added to Cafes to try".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(frontend): stacks, stack detail, curated feed, add to stack`.

---

### Task 12: CI, docs, and the browser walkthrough against Stitch

**Files:**
- Create: `.github/workflows/frontend-ci.yml`, `frontend/README.md`, `.claude/launch.json` (local; git-ignored)

- [ ] **Step 1: CI.** `frontend-ci.yml`: on push to `qa`/`main` and PRs to `main` with `paths: ["frontend/**", ".github/workflows/frontend-ci.yml"]`; `ubuntu-latest`, `actions/setup-node@v4` node 24 with npm cache on `frontend/package-lock.json`; `npm ci`, `npm run lint`, `npm run typecheck`, `npm test -- --ci` in `frontend/`.
- [ ] **Step 2: README.** How to run (`npm install`, `npm run web` → http://localhost:8081), demo vs live (`EXPO_PUBLIC_API_MODE`), the demo test links (`/reel/QUOTA/`, `/reel/RATE/`, `/reel/NETWORK/`, `/reel/PARTIAL/`, non-Instagram text), where the API contract lives and which endpoints are live, Supabase dashboard setup for live mode (spec §9).
- [ ] **Step 3: Full checks.** `npm run lint`, `npm run typecheck`, `npm test` → all pass (paste the summary lines in the report).
- [ ] **Step 4: Launch.** `.claude/launch.json` config `frontend-web`: `runtimeExecutable: "npm"`, `runtimeArgs: ["--prefix", "frontend", "run", "web"]`, `port: 8081`. Start it with the preview tool; set the viewport to 390×844.
- [ ] **Step 5: Walkthrough** (the empty Library is covered by its test, not walked). For each screen — Sign in, Sign up, Check email, Library, Save sheet (saved, deduped, bad link, quota, rate, network), Card detail (ready, processing, partial, delete), Search (recent, results, none), Account, Stacks, stack detail, new stack, Curated — screenshot it and compare with `docs/design/stitch/<screen>.full.*`. Fix spacing/typography/colour deltas in place (re-run tests after each fix). Check the browser console has no errors.
- [ ] **Step 6: Commit** `ci(frontend): lint, typecheck and tests; README` plus any walkthrough fixes as `fix(frontend): match Stitch spacing on <screen>`.
- [ ] **Step 7: Hand over.** Leave the dev server running at http://localhost:8081 for the user.
