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
- **live**: real Supabase sign-in, and every call goes to the FastAPI backend at
  `EXPO_PUBLIC_API_URL`. Leave it at `http://localhost:8001`: on a phone the app swaps
  `localhost` for the PC that Metro serves it from (`src/lib/apiUrl.ts`).

### Live on your phone (Expo Go or a dev build)

1. Backend: `cd backend && .venv/Scripts/python.exe scripts/dev.py` (API on :8001 + worker).
2. App: `npx expo start` here, open it on the phone (same Wi-Fi as the PC).
3. Sign in, share a reel from Instagram (dev build) or use **Paste link**: the card shows
   "processing", and the worker fills it in about 20–60 s. Then search for it.

If saves don't load, allow Python through Windows Firewall on private networks (port
8001). Sign-in problems: `docs/auth-setup.md` has a symptom → fix table.

**Instagram's Share → Lately** needs the native build (Expo Go has no share target). The
debug APK at `android/app/build/outputs/apk/debug/app-debug.apk` has it and loads its JS
from Metro, so JS changes need no rebuild. No Android toolchain on this PC? Every push to
`main` that touches the app runs the tests and publishes a standalone test APK as a GitHub
Release (`.github/workflows/android-apk.yml`); on the phone, install the newest from
https://github.com/Mitovoid-AI/lately/releases/latest/download/lately.apk. It needs no PC,
and runs in demo mode until the live `EXPO_PUBLIC_*` repository variables are set.
Sign in from the APK, not Expo Go: Supabase's `exp://**` redirect pattern doesn't match
Expo Go's `exp://<ip>:8081` address, so Google and email links fall back to `localhost:3000`. Over USB: `adb install -r` that APK, then
`adb reverse tcp:8081 tcp:8081` and `adb reverse tcp:8001 tcp:8001`, then `npx expo start`.
Over Wi-Fi: shake → Settings → Debug server host → `<PC IP>:8081`; the app then finds the
API on the same host by itself. Rebuild (`npx expo run:android`) only after adding a
native module.

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
shape; the backend matches it. `src/api/index.tsx` → `LIVE_ENDPOINTS` names the calls
that go to FastAPI in live mode (all of them).

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

See `docs/auth-setup.md`: redirect URLs (`exp://**`, `lately://**`,
`http://localhost:8081/**` … `8083/**`), the email code template, SMTP, and Google. The API
already allows the web dev origins :8081–:8083 (CORS).
