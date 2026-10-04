# Lately — app (Expo)

The Lately app, built from the Stitch screens. One codebase for Android (share target
coming next) and the web, where it runs today.

## Run it

```bash
npm install
npm run web          # http://localhost:8081
```

Checks: `npm test`, `npm run typecheck`, `npm run lint` (CI runs all three on `qa`/`main`).

## Demo and live mode

Set `EXPO_PUBLIC_API_MODE` in `frontend/.env` (copy `.env.example`).

- **demo** (default): no backend or login needed. Any sign-in button signs you in as the
  demo user, and every screen runs on the Stitch sample content (in memory — changes reset
  on reload; reading preferences are kept on the device).
- **live**: real Supabase sign-in, and the endpoints the FastAPI backend serves today go to
  `EXPO_PUBLIC_API_URL`. Everything else still uses demo data.

Demo links that trigger each save-sheet state (paste them via **Paste link**):

| Link | Result |
|---|---|
| any `instagram.com/reel/<code>/` | saved → processing for 6 s → ready card |
| a link you already saved (e.g. `instagram.com/reel/MomoPt1/`) | Already in your Lately |
| `instagram.com/reel/PARTIAL/` | saved → partial card |
| `instagram.com/reel/QUOTA/` | monthly limit |
| `instagram.com/reel/RATE/` | rate limited |
| `instagram.com/reel/NETWORK/` | network error |
| text without a reel link | No reel link found |

## The API contract

`src/api/contract.ts` lists every call the app makes, with its HTTP path and response
shape. It is the backend's to-do list. `src/api/index.tsx` → `LIVE_ENDPOINTS` names the
calls that go to FastAPI in live mode (today: `createSave`, `listSaves`, `setNote`); add a
call there when the backend ships it.

## Layout

```
src/app/         routes (expo-router): (auth), (tabs), reel/[id], stack/[id], search, account, save-sheet
src/screens/     one file per screen
src/components/  ReelCard, Sheet, Chip, Button, TabBar, … (+ detail/, settings/)
src/api/         contract, demo implementation + data, HTTP client, demo/live routing
src/auth/        AuthProvider (demo session or Supabase)
src/lib/         link parsing, search, dates, recent searches, share
src/theme/       Stitch design tokens (tailwind.config.js reads them)
assets/stitch/   images exported from the Stitch project
```

## Live-mode setup (Supabase dashboard)

1. Authentication → URL Configuration: Site URL `http://localhost:8081`; redirect URLs
   `http://localhost:8081/**` and `lately://**`.
2. Authentication → Email templates → Magic Link: include `{{ .Token }}` so the email has a
   6-digit code as well as the link.
3. Google: create a Google Cloud OAuth client (web) with redirect
   `https://jsvgezmgvwnldcnrjdzg.supabase.co/auth/v1/callback`, then paste its id/secret into
   Authentication → Providers → Google.
4. The FastAPI backend must allow the app's origin (CORS) — the first item of the backend
   round.
