# Lately — App

React Native + Expo app for the Lately reel-saving product. See `../PLAN.md` for
the full build plan and `../MARKETING.md` for go-to-market.

## Architecture (Phase 1)

**Fetch on the phone, think in the cloud.** The Android device shares reels in
via the share sheet; the backend (Supabase) only ever stores text + derived data.

- `app/` — expo-router screens
  - `_layout.tsx` — root stack + safe-area provider
  - `index.tsx` — home: search box, save list, share-intent capture
- `src/`
  - `config.ts` — env-driven Supabase config + Phase-1 dev user id
  - `supabase.ts` — RN-configured Supabase client (AsyncStorage session)
  - `types.ts` — domain types + typed `Database` generic
  - `reels.ts` — `saveReel` (capture-never-fails) and `listReels` (FTS search)
  - `lib/instagram.ts` — shortcode + URL extraction from shared text
- `supabase/`
  - `migrations/0001_init.sql` — 4 tables, generated `search_vector`, RLS
  - `seed.sql` — Phase-1 dev user + default categories

## Setup

1. `npm install`
2. Create a Supabase project, run `supabase/migrations/0001_init.sql` then
   `supabase/seed.sql` in the SQL editor.
3. `cp .env.example .env` and fill `EXPO_PUBLIC_SUPABASE_URL` /
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
4. Build a dev client (share intent needs native code, not Expo Go):
   `eas build --profile development --platform android` — or `npx expo run:android`.
5. `npm start`, then share an Instagram reel to **Lately** from the share sheet.

## Verified

- `npm run typecheck` passes.
- `npx expo config` resolves the plugin chain (expo-router + expo-share-intent).

## Not yet done (next phases)

- On-device fetch of caption/thumbnail/audio (Phase 1 step 4)
- Groq Whisper transcription + Gemini Flash structuring (Phase 1 step 5)
- Magic-link auth + tightening RLS to `auth.uid() = user_id` (Phase 3)

> Security note: the Phase-1 RLS policies are permissive (`using (true)`) for
> single-user local dev. They MUST be scoped to `auth.uid()` before onboarding
> any real user, or every authenticated user can read everyone's saves.
