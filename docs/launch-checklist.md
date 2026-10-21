# Lately — Launch checklist (the steps only the founder can do)

Everything in the repo is built and tested by the team. These steps need your
accounts, money, legal identity or signing keys, so they can't be done for you.
Order matters: top to bottom.

## 1. Accounts and keys (one-time)

| # | Step | Where | Notes |
|---|---|---|---|
| 1 | Supabase **prod** project (separate from the test one) | supabase.com | The current project `jsvgezmgvwnldcnrjdzg` is the disposable test DB; tests wipe it. Apply `supabase/migrations/*` to prod with `supabase db push` or the dashboard SQL editor. |
| 2 | Supabase Auth settings | Dashboard → Auth | Follow `docs/auth-setup.md`: redirect URLs (`lately://auth-callback`), email templates with `{{ .Token }}`, custom SMTP (default mailer ≈ 2 emails/hour), Google OAuth client (Android + Web client IDs). |
| 3 | Service-role key → backend only | Dashboard → API | Needed for thumbnail uploads. Never in the app. |
| 4 | Fly.io account + card | fly.io | Backend hosting (`backend/fly.toml`, `docs/deploy.md`). |
| 5 | OpenRouter: add ≈ $10 credit | openrouter.ai | Free models allow ~50 requests/day without credit, ~1000/day with it. Or pick a paid model; it's an env change (`LLM_MODEL`). |
| 6 | Groq key (optional) | console.groq.com | Speech-to-text for reels with little caption. |
| 7 | OpenAI key for embeddings | platform.openai.com | `text-embedding-3-small`: cents per thousands of cards. Set a monthly spend limit in the dashboard. |
| 8 | Google Play Console developer account | play.google.com/console | $25 one-time, identity verification. |
| 9 | Google Play payments profile (merchant account) | Play Console → Settings → Payments profile | Needed to sell Lately Pro. Business country can't change later. Steps in `docs/billing-setup.md` Part 1. |
| 10 | RevenueCat account | app.revenuecat.com | Sits between the app, Google Play and the backend for Lately Pro. `docs/billing-setup.md`. |

## 2. Deploy the backend (≈ 20 min)

`docs/deploy.md` has the exact commands: `fly launch`, `fly secrets set ...`, `fly deploy`, then `python scripts/debug.py --live --api https://<app>.fly.dev` must print all PASS.

**Instagram fetching from cloud IPs:** Instagram often blocks data-centre IPs. The app also sends what the phone can see at share time (device-side fetch), so cards still get built; if fetch quality drops, set `SCRAPER_API_URL`/`SCRAPER_API_KEY` (a paid scraper) as a fallback.

## 3. Build the Android release

1. Set five values: `EXPO_PUBLIC_API_MODE=live`, `EXPO_PUBLIC_API_URL` (the deployed API), `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the Supabase prod project), and the RevenueCat Google Play key `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (`docs/billing-setup.md` Part 2). For EAS builds all five go in the EAS `production` environment (`npx eas-cli env:set ... --environment production`): EAS builds in the cloud and doesn't upload the git-ignored `frontend/.env`. That file is only for local Gradle builds.
2. Signing key: `eas credentials` (Expo keeps it) **or** a local upload keystore. **Back it up** — losing it means you can't update the app (Play App Signing lets Google hold the app key; you keep the upload key).
3. Build an `.aab` (Play requires App Bundles for new apps): `eas build -p android --profile production` (needs a free Expo account) or the local Gradle build in `docs/deploy.md`.

## 4. Play Console listing

- **Testing first:** personal developer accounts created after Nov 2023 must run a **closed test with at least 12 testers for 14 days** before they can publish to production. Start this as early as possible.
- **Store listing:** name, short + full description, 512×512 icon, 1024×500 feature graphic, ≥ 2 phone screenshots.
- **Privacy policy URL:** host `frontend/legal/privacy.md` publicly (GitHub Pages / Supabase Storage public file / any site).
- **Account deletion:** in-app deletion is built (Account → Delete account). Play **also requires a web link** where users can request deletion without the app: publish a page (or a form/email address) and put the URL in the Data safety section.
- **Data safety form:** collected: email, user IDs, app content (saved links, notes), purchase history (Financial info, required by the RevenueCat SDK); processed by Supabase, LLM provider, Groq, OpenAI, RevenueCat; encrypted in transit; users can request deletion.
- **Content rating** questionnaire, **target audience** (18+ is simplest), **ads** declaration (none).
- **Branding:** don't use Instagram's logo or name in the app icon/title/screenshots in a way that implies affiliation (Meta trademark policy) — e.g. "Save reels you share" is fine, an Instagram glyph is not.

## 5. Selling (Lately Pro)

Lately Pro ($3.99/month, $29.99/year with a 7-day trial on yearly) is built: Google Play
Billing through RevenueCat, a paywall in the app, and a backend webhook that sets
`profiles.plan`. What's left is your accounts and dashboard settings, step by step in
**`docs/billing-setup.md`**: Play Console subscription `lately_pro`, RevenueCat entitlement
`pro` and offering `default`, the webhook, and a test purchase with a license tester.

New settings:

| Variable | Where | Needed? | What it does |
|---|---|---|---|
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | App: EAS `production` environment, with the other four `EXPO_PUBLIC_*` values (or `frontend/.env` for local builds) | Yes for store builds: a production build refuses to build without a key starting with `goog_` | RevenueCat's public Google Play key. Without it the paywall shows prices but can't sell. |
| `REVENUECAT_WEBHOOK_AUTH` | Backend (`fly secrets set`) | Yes, to receive purchases | The Authorization header value set on the RevenueCat webhook. Empty = webhook off (404). |
| `REVENUECAT_SECRET_API_KEY` | Backend | Strongly recommended | RevenueCat V1 secret key (`sk_...`). The backend checks each user with RevenueCat instead of trusting events alone; needed for instant unlock after purchase/restore, transfers and refunds. |
| `REVENUECAT_WEBHOOK_SIGNING_SECRET` | Backend | Optional | Also checks RevenueCat's HMAC signature on each webhook. |
| `REVENUECAT_ALLOW_SANDBOX` | Backend | Default `true` | License-tester purchases unlock Pro through the webhook. Set `false` after launch. |

## 6. Before the first upload (found in the final review)

- **App icon:** the icon is rendered from `docs/design/stitch/logo-insta.svg` (the gradient egg used inside the app). If it reads as Instagram's logo, swap it: edit `frontend/scripts/render-icons.js` to use `logo-icon.svg` (or a new mark) and re-run it.
- **Legal text:** `frontend/legal/privacy.md` and `terms.md` have no company name, contact email or governing law. Fill them in, then run `node scripts/build-legal.js` in `frontend/`.
- **Release builds refuse to build without live settings** (`frontend/app.config.js`): `EXPO_PUBLIC_API_MODE=live`, an `https://` API URL, both Supabase values and a RevenueCat key starting with `goog_`. To test a release APK against your PC before Fly is up, expose the backend with `ngrok http 8001` and use that https URL.
- **Supabase redirect allow-list** must include `lately://auth-callback` (sign-in now uses the PKCE code flow).
- **LLM model:** `backend/.env` now uses `dots-studio/dots-3-note-preview:free` with `google/gemma-4-31b-it:free` as fallback (the old `qwen/qwen3.8-27b:free` doesn't exist on OpenRouter).
- **Signing:** the generated `android/` signs release builds with the debug key. Use EAS credentials or your own upload keystore for the Play AAB (`docs/deploy.md`).

## 7. Legal / business risks to know

- Reading Instagram pages automatically may conflict with Meta's terms. The product saves links users share and builds notes about them; keep thumbnails small, never store video, and link back to the original reel (all already true). Get advice before scaling.
- You are the data controller: keep the privacy policy accurate when you add providers (Google Play Billing and RevenueCat are already in it).
