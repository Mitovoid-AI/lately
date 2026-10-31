# Lately: launch checklist (the steps only the founder can do)

The app, backend, payments, release build and store kit are built and tested in the repo.
What is left needs your accounts, money, legal identity or signing key, so nobody can do it
for you. Work top to bottom: later steps use what earlier steps give you.

Rough total: about 2 working days of your time spread over 3 weeks, because Google makes new
personal developer accounts run a 14-day closed test before production.

## 1. Accounts (day 1, about 2 hours, $25)

| # | Step | Cost | Guide |
|---|---|---|---|
| 1.1 | Google Play Console developer account, identity verification | $25 once | [play.google.com/console](https://play.google.com/console) |
| 1.2 | Play payments profile (merchant account). The business country can't change later. | free | `docs/billing-setup.md` Part 1 |
| 1.3 | Supabase **prod** project. The current project `jsvgezmgvwnldcnrjdzg` is the disposable test database; tests wipe it. | free tier to start | `docs/deploy.md` §1 |
| 1.4 | Fly.io account with a card on file | pay as you go | `docs/deploy.md` §2 |
| 1.5 | RevenueCat account | free until revenue | `docs/billing-setup.md` Part 2 |
| 1.6 | AI keys: OpenRouter (add about $10 credit, the free tier allows about 50 requests a day), OpenAI for search embeddings (set a monthly limit), Groq for speech to text (optional) | a few dollars a month at launch | `backend/.env.example` |
| 1.7 | A support email address you will answer (it goes on the listing, the privacy policy and the deletion page) | free | |

## 2. Backend live (day 1, about 1 hour)

1. Apply every migration, `0001` through `0013`, to the prod database (`supabase db push`). The API needs all of them. `docs/deploy.md` §1.
2. Supabase Auth settings: redirect URL `lately://auth-callback`, the email template with `{{ .Token }}` so emails carry a 6-digit code, custom SMTP (the built-in mailer sends about 2 emails an hour), Google sign-in client IDs. `docs/auth-setup.md`.
3. Deploy to Fly.io with the secrets, then check it: `python scripts/debug.py --live --api https://<app>.fly.dev` must print all PASS. `docs/deploy.md` §2.
4. Your local dev database also needs migration `0013_billing.sql`, or the local backend's account page fails. From `backend/`: run `scripts/db_reset.py` only against a test database; for the dev database apply the one file in the Supabase SQL editor.

Instagram often blocks data-centre IPs. The app also sends what the phone reads at share time, so cards still get built; if card quality drops, set `SCRAPER_API_URL` and `SCRAPER_API_KEY` (a paid scraper).

## 3. Legal text and public pages (day 1, about 1 hour)

1. Fill in the placeholders in `frontend/legal/privacy.md` and `terms.md`: who runs Lately (your name or company and country) and the support email. Proposed wording for a few more lines is in `docs/play-store/data-safety.md` §6 (email provider, sign-in records). Then run `node scripts/build-legal.js` in `frontend/`.
2. Build the public pages with your real values: `LATELY_SUPPORT_EMAIL=... LATELY_DELETION_DAYS=30 node scripts/build-public-site.js --strict` (it stops if a placeholder is left).
3. The public pages are on GitHub Pages at `https://mitovoid-ai.github.io/lately/` (`docs/site/`, deployed by `.github/workflows/pages.yml`; set the repository variables `LATELY_SUPPORT_EMAIL` and `LATELY_DELETION_DAYS` so the live pages have them). GitHub Pages needs the repository to stay public on the free plan; if it goes private, publish `docs/site/` on Netlify or Cloudflare Pages instead. `docs/play-store/hosting.md` has every route and which two URLs go into Play Console (privacy policy, account deletion).

## 4. Payments (day 2, about 2 hours)

Lately Pro is built: $3.99 a month, or $29.99 a year with a 7-day free trial, sold through Google Play Billing and RevenueCat, with a backend webhook that turns Pro on and off. Follow **`docs/billing-setup.md`** in order. Google won't let you create the subscription until a build with billing is uploaded, so Part 3 (first upload) comes before Part 4 (the subscription).

| Setting | Where | What it does |
|---|---|---|
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | GitHub variable (release build) | RevenueCat's public Google Play key (`goog_...`). Release builds refuse to build without it. |
| `REVENUECAT_WEBHOOK_AUTH` | Fly secret | The Authorization value you set on the RevenueCat webhook. Empty turns the webhook off. |
| `REVENUECAT_SECRET_API_KEY` | Fly secret | RevenueCat secret key. Strongly recommended: instant unlock after purchase, transfers and refunds. |
| `REVENUECAT_WEBHOOK_SIGNING_SECRET` | Fly secret, optional | Also checks RevenueCat's signature on each webhook. |
| `REVENUECAT_ALLOW_SANDBOX` | Fly secret | `true` while testing with license testers; set `false` after launch. |

## 5. Release build (day 2, about 1 hour)

Follow **`docs/release-android.md`**:

1. Create the upload keystore and **back it up twice** (a password manager and an offline copy). Losing it means a support request to Google before you can ship an update.
2. Add the GitHub secrets (the keystore and its passwords) and variables (the four `EXPO_PUBLIC_*` values).
3. Run the **android-release** workflow by hand (Actions tab). It checks every secret, builds the signed `app-release.aab`, and checks the signature. Download the bundle from the run.
4. Enrol in Play App Signing when you upload the first bundle.

The repo is private, so each build uses GitHub's private-repo minutes (2,000 a month on the free plan; a release build for every phone type can take 30 to 60 of them). The workflow never runs on its own.

## 6. Play Console listing and policy forms (day 2, about 2 hours)

Everything to paste is in **`docs/play-store/`**:

| Form | File |
|---|---|
| Store listing: name, short and full description (lengths counted), category, release notes | `listing.md` |
| Data safety | `data-safety.md` (check every `[CONFIRM]`) |
| Sign-in details for reviewers: create a dedicated Google account for Google's reviewers | `app-access.md` |
| Content rating questionnaire | `content-rating.md` |
| Target audience: 18 and over | `target-audience.md` |
| Ads: none | `ads-declaration.md` |
| Subscriptions | `subscriptions.md` (points to `billing-setup.md`) |
| Screenshots and the 1024 x 500 feature graphic | `screenshots/` |

**Decide on the icon before the first upload.** The current icon uses Instagram's purple, pink and orange gradient, which risks an impersonation review. `docs/play-store/brand-risk.md` sets out the risk and the two options.

## 7. Testing and launch (weeks 1 to 3)

1. **Internal testing** track: install from Play on your own phone, sign in, save a reel, search, and buy Pro as a license tester (`docs/billing-setup.md` Part 7).
2. **Closed testing** with at least 12 testers who stay opted in for 14 days in a row. Google requires this for personal developer accounts created after November 2023. Start it as soon as the internal build works.
3. Apply for **production** access from the dashboard when the 14 days are up, then roll out (start at 20% and watch for crashes and payment issues).
4. After launch, set `REVENUECAT_ALLOW_SANDBOX=false`.

## Legal and business risks to know

- Reading Instagram pages automatically may conflict with Meta's terms. Lately saves links users share and builds notes about them; it keeps thumbnails small, never stores video, and links back to the original reel. Get advice before scaling.
- You are the data controller: keep the privacy policy accurate when you add a provider (Google Play, RevenueCat and the AI providers are already in it).
- Each free save costs you AI processing. The 20-a-month cap is enforced on the server; if people start creating many free accounts, add a captcha on sign-up or Google Play Integrity.
