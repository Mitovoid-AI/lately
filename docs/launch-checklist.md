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

## 2. Deploy the backend (≈ 20 min)

`docs/deploy.md` has the exact commands: `fly launch`, `fly secrets set ...`, `fly deploy`, then `python scripts/debug.py --live --api https://<app>.fly.dev` must print all PASS.

**Instagram fetching from cloud IPs:** Instagram often blocks data-centre IPs. The app also sends what the phone can see at share time (device-side fetch), so cards still get built; if fetch quality drops, set `SCRAPER_API_URL`/`SCRAPER_API_KEY` (a paid scraper) as a fallback.

## 3. Build the Android release

1. In `frontend/`: set `EXPO_PUBLIC_API_URL` to the deployed API and the Supabase prod URL + publishable key in `frontend/.env`.
2. Signing key: `eas credentials` (Expo keeps it) **or** a local upload keystore. **Back it up** — losing it means you can't update the app (Play App Signing lets Google hold the app key; you keep the upload key).
3. Build an `.aab` (Play requires App Bundles for new apps): `eas build -p android --profile production` (needs a free Expo account) or the local Gradle build in `docs/deploy.md`.

## 4. Play Console listing

- **Testing first:** personal developer accounts created after Nov 2023 must run a **closed test with at least 12 testers for 14 days** before they can publish to production. Start this as early as possible.
- **Store listing:** name, short + full description, 512×512 icon, 1024×500 feature graphic, ≥ 2 phone screenshots.
- **Privacy policy URL:** host `frontend/legal/privacy.md` publicly (GitHub Pages / Supabase Storage public file / any site).
- **Account deletion:** in-app deletion is built (Account → Delete account). Play **also requires a web link** where users can request deletion without the app: publish a page (or a form/email address) and put the URL in the Data safety section.
- **Data safety form:** collected: email, user IDs, app content (saved links, notes); processed by Supabase, LLM provider, Groq, OpenAI; encrypted in transit; users can request deletion.
- **Content rating** questionnaire, **target audience** (18+ is simplest), **ads** declaration (none).
- **Branding:** don't use Instagram's logo or name in the app icon/title/screenshots in a way that implies affiliation (Meta trademark policy) — e.g. "Save reels you share" is fine, an Instagram glyph is not.

## 5. Selling (paid plan)

- Selling a digital subscription that unlocks in-app features **must go through Google Play Billing** (India allows user-choice billing as an alternative, with extra setup).
- The app has the free/pro plan model and quotas (`profiles.plan`, `saves_free_limit`). Wiring the purchase flow needs: products created in Play Console, then the in-app purchase SDK (RevenueCat is the quickest path) + a backend webhook that sets `profiles.plan`. This is the next build step once the Play Console account exists, because products and test purchases can't be created without it.

## 6. Before the first upload (found in the final review)

- **App icon:** the icon is rendered from `docs/design/stitch/logo-insta.svg` (the gradient egg used inside the app). If it reads as Instagram's logo, swap it: edit `frontend/scripts/render-icons.js` to use `logo-icon.svg` (or a new mark) and re-run it.
- **Legal text:** `frontend/legal/privacy.md` and `terms.md` have no company name, contact email or governing law. Fill them in, then run `node scripts/build-legal.js` in `frontend/`.
- **Release builds refuse to build without live settings** (`frontend/app.config.js`): `EXPO_PUBLIC_API_MODE=live`, an `https://` API URL and both Supabase values. To test a release APK against your PC before Fly is up, expose the backend with `ngrok http 8001` and use that https URL.
- **Supabase redirect allow-list** must include `lately://auth-callback` (sign-in now uses the PKCE code flow).
- **LLM model:** `backend/.env` now uses `dots-studio/dots-3-note-preview:free` with `google/gemma-4-31b-it:free` as fallback (the old `qwen/qwen3.8-27b:free` doesn't exist on OpenRouter).
- **Signing:** the generated `android/` signs release builds with the debug key. Use EAS credentials or your own upload keystore for the Play AAB (`docs/deploy.md`).

## 7. Legal / business risks to know

- Reading Instagram pages automatically may conflict with Meta's terms. The product saves links users share and builds notes about them; keep thumbnails small, never store video, and link back to the original reel (all already true). Get advice before scaling.
- You are the data controller: keep the privacy policy accurate when you add providers.
