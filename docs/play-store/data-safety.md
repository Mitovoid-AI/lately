# Data safety form answers

Play Console → **Policy and programs** → **App content** → **Data safety**. Answers below are
derived from the code on branch `qa` (2026-10-22) and from `frontend/legal/privacy.md`, not
from memory. Anything that needs the founder's decision or a fact the code cannot show is
marked **[CONFIRM]** with the file that made it uncertain.

Definitions used (Google, [Provide information for Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469)):

- **Collected** = sent off the phone, by the app or an SDK in it.
- **Shared** = sent to a third party. Sending data to a **service provider** that processes it
  on the developer's behalf and instructions is not sharing; neither is a transfer the user
  starts and expects.
- **Ephemeral** = used only in memory, not stored. Ephemeral data is still declared, but is
  not shown publicly.
- **Optional** only if every user can choose not to provide it.

If you change providers, add an SDK (crash reporting, analytics, ads) or start sending email
newsletters, these answers change. Update the form and `privacy.md` together.

## 1. Data collection and security

| Question | Answer | Why |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Email, account ID, saves, notes, searches and purchase records leave the phone (table in section 2). |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Release builds refuse to build unless the API URL is `https://` (`frontend/release-env.js`), and only the debug manifests allow cleartext HTTP (`frontend/android/app/src/debug*/AndroidManifest.xml`), so a release build cannot send plain HTTP. Supabase (`https://<ref>.supabase.co`), RevenueCat and Google Play are called over HTTPS; `release-env.js` checks only that the Supabase URL is set, so **[CONFIRM]** the production `EXPO_PUBLIC_SUPABASE_URL` starts with `https://`. The phone reads Instagram's embed page over `https://` (`frontend/src/lib/deviceFetch.ts`). The backend calls OpenRouter, Groq and OpenAI on `https://` URLs (`backend/app/config.py`). |
| Which of the following methods of account creation does your app support? | Email sign-in with a one-time code (or magic link), and Sign in with Google. **[CONFIRM]** the exact option labels in the form; the help page does not list them. | `frontend/src/auth/AuthProvider.tsx` (`signInWithOtp`, `signInWithOAuth`). There is no password sign-in. |
| Do you provide a way for users to request that their data is deleted? | **Yes** | In-app: Account and settings → Delete account (`DELETE /me`, `backend/app/routers/me.py`). Web: `delete-account.html` (section 4). |

## 2. Data types

Purposes use Google's list: App functionality, Analytics, Developer communications,
Advertising or marketing, Fraud prevention/security/compliance, Personalization, Account
management. No data is used for advertising or marketing, and no data is shared (section 3).

| Category → data type | Collected | Shared | Ephemeral | Required or optional | Purposes | What exactly, and where in the code |
|---|---|---|---|---|---|---|
| Personal info → **Email address** | Yes | No | No | Required | App functionality, Account management | Sign-in identity in Supabase Auth; copied to `profiles.email` (`supabase/migrations/0005_auth_profiles.sql`). Every sign-in method yields an email. Shown in Account and settings. Sign-in codes are emailed through Supabase's mailer or the custom SMTP sender set up per `docs/auth-setup.md` §3. |
| Personal info → **Name** | Yes | No | No | Optional | App functionality, Account management | Only with Google sign-in: the name Google shares (`profiles.full_name`, `sync_profile()` in 0005). Email sign-in stores no name, so every user can avoid it. |
| Personal info → **User IDs** | Yes | No | No | Required | App functionality, Account management | Supabase user ID (UUID) on every row; a handle derived from the email (`make_handle()` in 0005). The same UUID is the RevenueCat app user ID (`frontend/src/billing/store.ts` `configure({ appUserID })`). |
| Financial info → **Purchase history** | Yes | No | No | Required (RevenueCat's guidance; see note) | App functionality, Analytics | Lately Pro purchases: RevenueCat events stored in `billing_events.payload` (plan, price, currency, country of purchase, dates, Google Play transaction ID; `0013_billing.sql`), plan and expiry on `profiles`. RevenueCat's SDK collects purchase history and says to declare it with these two purposes; Analytics covers RevenueCat's revenue charts the developer sees. |
| Photos and videos → **Photos** | **[CONFIRM]** recommended Yes | No | No | Optional | App functionality, Account management | Only with Google sign-in: the URL of the Google profile photo (`profiles.avatar_url`, 0005), shown as the avatar. Lately never reads photos from the phone. Uncertain because Lately stores a link to the photo Google hosts, not the image (`0005_auth_profiles.sql`); declaring it is the cautious choice. |
| App activity → **In-app search history** | Yes | No | **[CONFIRM]** recommended No | Required | App functionality | Search text is sent to `GET /search` and to OpenAI to compute a query embedding. The backend does not store it in the database (only a hit count in `metrics`, `backend/app/routers/search.py`), but keeps up to 2,048 recent query texts in an in-memory cache (`QUERY_CACHE`), and OpenAI handles API inputs under its own retention terms. "No" is the safe answer. Recent searches are also kept on the phone only (`frontend/src/lib/recent.ts`), which is not collection. |
| App activity → **Other user-generated content** | Yes | No | No | Required | App functionality | The reel links a user saves (`reels.source_url`), their "why" notes (`reels.note`), stack names and membership (`0006_app_features.sql`), the device-side read of the reel's public embed page sent with a save (`reels.device_hint`, `0009_device_hints.sql`), and the latest data export (`exports`, `0008_exports.sql`). Saving reels is the app's core, so this is required. |
| App activity → **App interactions** | Yes | No | No | Required | App functionality, Fraud prevention/security/compliance | A row per save with its time (`save_events`, `0010_hardening.sql`) to apply the free plan's monthly limit and the 30-per-hour rate limit, and a per-save retry counter (`reels.retry_count`). No screen views, taps or analytics events are recorded. |
| App activity → **Other actions** | **[CONFIRM]** recommended Yes | No | No | Optional | App functionality, Personalization | Reading preferences synced to the server: font, text size, theme, and the digest and offline-reading switches (`preferences`, `0006_app_features.sql`). A row exists only after the user changes a setting. Uncertain only because Google's list has no "settings" type; this is the closest. |

Notes:

- **Purchase history "required".** RevenueCat's page says its SDK collects purchase history
  and users cannot turn that off
  ([RevenueCat: Google Play's data safety](https://www.revenuecat.com/docs/platform-resources/google-platform-resources/google-plays-data-safety)).
  In practice there is nothing to collect until someone buys Pro.
- **Reel content is not user data.** Captions, transcripts, thumbnails and audio come from the
  reel's public Instagram page, fetched by the backend (or read by the phone from the public
  embed page). They are stored once per reel in `reel_content`, shared by everyone who saved
  it, and hold no user data (`backend/app/routers/me.py`, `delete_me` docstring). Their
  link to a user is the save, declared above as user-generated content.
- **The phone talks to Instagram directly.** Right after a save, the app loads that reel's
  public embed page from `instagram.com` (`frontend/src/lib/deviceFetch.ts`). Instagram
  receives an ordinary web request (the phone's IP address and the reel's address), as when
  the user opens the link. No Lately data is sent, IP address is not a Data safety type, and
  the request follows the user's own save, so it is not "sharing". `privacy.md` does not
  mention it yet; proposed text in section 6.

### Not collected (answer No)

| Category | Why not |
|---|---|
| Location (approximate and precise) | No location permission (`frontend/app.json` requests only `INTERNET`; the generated manifest also has `VIBRATE` for haptics, and the Play Billing library brings its billing permission), and nothing infers location from IP addresses. RevenueCat events carry the Google Play country of purchase, which comes from the store account, not the device (RevenueCat lists location as not collected). |
| Personal info: address, phone, race, beliefs, orientation, other | Never asked for. |
| Financial info: payment info, credit score, other | Google Play takes the payment; Lately never receives card or bank details (`privacy.md`). |
| Health and fitness | None. |
| Messages (emails, SMS, other) | None. The app receives only the text the user shares to it. |
| Photos and videos from the phone, videos | Media permissions are blocked (`blockedPermissions` in `frontend/app.json`). Reel thumbnails are public Instagram content. |
| Audio files | Microphone and audio permissions are blocked. Reel audio is downloaded by the backend from Instagram, not from the user. |
| Files and docs | The export is written by the app for the user; nothing is uploaded from the phone's files. |
| Calendar, Contacts | None. |
| Installed apps | None. |
| Web browsing history | The app does not see browsing. Saved reel links are content the user chooses to share, declared as user-generated content. |
| Crash logs, Diagnostics, Other performance data | No crash-reporting or analytics SDK in `frontend/package.json`. Server-side job metrics (`metrics` table) record stage timings with no user ID. **[CONFIRM]** this stays true if Sentry, Firebase Crashlytics or similar is added later. |
| Device or other IDs | No advertising ID, Firebase or device ID is read. RevenueCat needs device identifiers only for ad-network integrations, which Lately does not use (`store.ts` never calls `collectDeviceIdentifiers`). |

## 3. Sharing: none (everyone below is a service provider)

All transfers go to companies that process data for Lately under Lately's instructions, so
under Google's definition none of them is "sharing". The privacy policy names each of them
(`privacy.md`, "Who helps process your data").

| Provider | Receives | User identifier sent? | Source |
|---|---|---|---|
| Supabase | Everything in section 2 (database, sign-in, thumbnail storage) | Yes | `backend/app/config.py`, migrations |
| Fly.io (backend hosting) | All API traffic | Yes | `backend/fly.toml` |
| OpenRouter and the model provider it routes to | A reel's public caption, transcript and thumbnail, to write the card | No | `backend/app/enrich/structure.py` (no user field in the request) |
| Groq | A reel's audio, to transcribe it | No | `backend/app/enrich/transcribe.py`, `config.py` |
| OpenAI | Card text plus the user's note (to embed a save), and search text | No | `backend/app/search/embed.py`, `backend/app/worker/stages.py` |
| RevenueCat | Account ID, Google Play purchase details, technical request data (IP address, app version) | Yes (the UUID) | `frontend/src/billing/store.ts`, `backend/app/routers/billing.py` |
| Google Play | Payment and subscription management | Google's own account | Google Play Billing via RevenueCat |
| Email sender for sign-in codes | Email address | Yes | **[CONFIRM]** which SMTP sender is used in production; `docs/auth-setup.md` §3 leaves it open (Resend, Postmark, SES). It is not named in `privacy.md`. |
| Paid scraper (only if `SCRAPER_API_URL` is set) | Reel links, to read public reel pages | No | **[CONFIRM]** whether it is enabled; `backend/app/config.py` and `docs/launch-checklist.md` §2 make it optional. If enabled, name it in `privacy.md`. |

**[CONFIRM]** OpenRouter free models: some providers behind free models log or train on
prompts. Only public reel content goes to them, with no account ID, so this is not user data,
but if you want "each receives only what it needs" to hold strictly, pick a model whose
provider does not retain prompts (`LLM_MODEL` in the backend environment).

## 4. Data deletion

| Question | Answer |
|---|---|
| Account deletion URL | `[PUBLIC SITE URL]/delete-account.html` (built from `public-site/delete-account.html`, see `hosting.md`) |
| Can users delete their account in the app? | Yes. Tap the profile picture on the Home screen → Account and settings → Delete account → Continue → Delete forever. `DELETE /me` removes the auth user, which cascades to the profile, saves, notes, stacks, preferences, save counts and exports, and also deletes queued jobs and the user's `billing_events` rows (`backend/app/routers/me.py`). It happens at once. |
| Can users ask to delete some data without deleting the account? | Yes. Delete a single save (card → ⋮ → Delete), clear a note, delete a stack. |
| What is kept after deletion | Shared reel cards (no user data); Google's own purchase record; RevenueCat's customer record under the UUID until the developer deletes it (RevenueCat dashboard or REST API); provider backups for a limited period. Also **[CONFIRM]** Supabase Auth's audit log: it records user ID, IP address and user agent per sign-in event and may keep entries after the user is deleted ([Supabase: Auth audit logs](https://supabase.com/docs/guides/auth/audit-logs)). Either turn off "Write audit logs to the database" (Authentication → Audit Logs) or mention the log in `privacy.md` (proposed text in section 6). |

Google's deletion page rules (support link, [Understanding Google Play's app account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)):
the web page names the app as listed, the request path is easy to find, users do not need the
app, and any step before deletion (cancelling a subscription) is explained. `delete-account.html`
covers each point; the email route needs `[SUPPORT EMAIL]` and a number of days filled in
before publishing (`hosting.md`).

## 5. Things to re-check before submitting

- [ ] Section 2 still matches the app if new SDKs were added (`frontend/package.json`).
- [ ] The production SMTP sender and any scraper are named in `privacy.md`.
- [ ] `privacy.md` export wording matches the button label in Account and settings (section 6).
- [ ] The deletion URL opens without signing in, on a phone, in a private window.

## 6. Proposed changes to `privacy.md` (not applied)

These keep the policy, the Data safety answers and the public pages in step. They are
suggestions for the founder; edit `frontend/legal/privacy.md`, then run
`node scripts/build-legal.js` in `frontend/` (it updates the app's copy and `public-site/`, and
`src/legal/__tests__/legal.test.tsx` still has to pass).

1. **Export button name.** "Your choices and rights" says "Download Vault Archive"; the
   Account screen being edited on 2026-10-22 says "Download your archive" and "Account and
   settings". Use whatever the final screen says, for example:
   `- **Export.** In Account and settings, "Download your archive" prepares a copy of your saves, notes, cards and stacks as a JSON file in the app. When it is ready, tap Download to save it to your phone or share it.`
   Same for "Delete your account": `In Account and settings, tap "Delete account" and confirm twice.`
2. **Deletion without the app** (Google wants the web route easy to find). Add to "Your
   choices and rights":
   `- **Delete your account without the app.** Email the support address from the address you sign in with, or follow the steps at [PUBLIC SITE URL]/delete-account.html.`
3. **The server keeps your latest archive** (`exports` table, `backend/app/worker/stages.py`).
   Add to "How long data is kept", after the first sentence:
   `Lately keeps your most recent archive on its server so you can download it again, until you make a new one or delete your account.`
4. **The phone reads Instagram's public page** (`frontend/src/lib/deviceFetch.ts`). Add to
   "What Lately stores", after "Cards Lately makes from your saves":
   `- **Reading the reel from your phone.** Right after you save a reel, the app also loads that reel's public page from Instagram, the way your browser would, and sends what it reads (caption, creator handle, thumbnail and video links) to Lately to build the card. Instagram sees an ordinary web request from your phone. Lately sends Instagram none of your Lately data.`
5. **Sign-in records** (only if Supabase's "Write audit logs to the database" stays on). Add
   to "What Lately stores":
   `- **Sign-in records.** For security, Supabase Auth logs sign-ins and sign-outs: the time, your account ID, IP address and device or browser type.`
   and to "How long data is kept": `Sign-in records are kept for [PERIOD] for security, and may outlast a deleted account.`
6. **Email sender for sign-in codes** (once chosen, `docs/auth-setup.md` §3). Add to "Who
   helps process your data":
   `- **[EMAIL PROVIDER]:** sends the sign-in codes and links from Supabase Auth, so it receives your email address.`
7. **Paid scraper** (only if `SCRAPER_API_URL` is set). Add:
   `- **[SCRAPER NAME]:** receives the links of reels Lately could not read directly, to read their public page. It receives no account details.`
8. **Contact and operator.** "Contact" says to use the email on the Play listing. Name it
   directly, and say who runs Lately (Google's deletion page rules ask for the app or
   developer name as on the listing):
   `Questions or requests about your data: write to [SUPPORT EMAIL]. Lately is run by [DEVELOPER NAME], [COUNTRY].`
9. **Style.** The provider list puts a long dash between each name and its role. If you want
   the house style, use a colon: `- **Supabase:** sign-in, the database ...` (same for each
   provider).
