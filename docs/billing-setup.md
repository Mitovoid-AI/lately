# Lately Pro billing setup (Google Play + RevenueCat)

Lately Pro is a Google Play subscription: **$3.99 a month** or **$29.99 a year**, with a
**7-day free trial on the yearly plan**. Pro removes the free plan's monthly save cap
(`profiles.saves_free_limit`, 20 by default). Nothing else is gated.

How the pieces fit:

1. The app shows the plans and buys through **RevenueCat**'s SDK, which talks to
   **Google Play Billing** on the phone.
2. RevenueCat checks the purchase with Google and sends an event to the backend
   (`POST /webhooks/revenuecat`).
3. The backend sets `profiles.plan` to `pro` (or back to `free`) and the save cap stops
   (or starts) applying. Right after a purchase or restore, the app also asks the backend
   to check with RevenueCat (`POST /billing/sync`). With the backend's secret key set
   (Part 5, step 8) that turns Pro on without waiting for the event.

The RevenueCat customer ID is the Supabase user ID (the same UUID you see under Supabase →
Authentication → Users), so a purchase always maps to one Lately account.

Everything in the repo is built and tested. Until you finish this guide, nothing breaks:
demo mode shows sample prices, a build without the RevenueCat key shows the prices but says
"Purchases aren't available in this build.", and a backend without the RevenueCat settings
answers the webhook with 404.

## The names to copy exactly

| What | Value | Where you type it |
|---|---|---|
| Android package name | `app.lately.android` | Play Console, RevenueCat |
| Subscription (product ID) | `lately_pro` | Play Console |
| Base plans | `monthly` (1 month, $3.99) and `yearly` (1 year, $29.99) | Play Console |
| Free-trial offer | `trial-7d` on `yearly`: 7 days, new customers only | Play Console |
| RevenueCat products | `lately_pro:monthly`, `lately_pro:yearly` | RevenueCat (imported) |
| Entitlement | `pro` | RevenueCat |
| Offering | `default` (the current offering), packages `$rc_monthly` and `$rc_annual` | RevenueCat |
| App key | `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (starts with `goog_`) | EAS environment variables |
| Backend secrets | `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SIGNING_SECRET` (optional), `REVENUECAT_ALLOW_SANDBOX` | Fly.io secrets |

The app and the backend both look for the entitlement `pro` and the offering's monthly and
annual packages. A different spelling there means the paywall can't find the plans or a
purchase doesn't unlock Pro.

## The order

Google Play won't let you create a subscription until a build with Google Play Billing in
it has been uploaded, and a store build needs the RevenueCat key. So the parts below go:
Play Console basics → RevenueCat key → first upload → the subscription → connect RevenueCat
to Google Play → webhook → test purchase. Allow a couple of days in total: the payments
profile can need verification, and RevenueCat's access to Google Play can take up to 36
hours to start working.

Before you start you need the Google Play developer account (`docs/launch-checklist.md`,
section 1) and the backend deployed (`docs/deploy.md`), because store builds only talk to
an `https://` API.

---

## Part 1. Google Play Console: the app, payments and testers

1. **Create the app.** Play Console → Home → **Create app**.
   - App name: `Lately`. Default language: English (United States).
   - App or game: App. Free or paid: **Free** (the download is free; Pro is sold inside
     the app).
   - Contact email: your support email.
   - Tick the declarations (Developer Program Policies, US export laws, Play App Signing
     terms), then **Create app**.

   The package name is not typed here. It comes from the first build you upload
   (`app.lately.android`, set in `frontend/app.json`) and can never change.

2. **Set up the payments profile** (Google's merchant account; without it you can't sell).
   Play Console → **Settings** → **Payments profile** → **Create payments profile**. You
   need:
   - your legal name or business name (customers see it on receipts) and a physical
     address (not a PO box);
   - a contact person and email;
   - public business details: website, product category, customer support email, and the
     name shown on card statements (for example `LATELY`).

   Then **Submit**. The business country can't be changed later, and the bank account
   for payouts must be in the same country.

3. **Add license testers.** Play Console → **Settings** → **License testing** → Email
   lists → **Create list**. Add the Gmail addresses that will test purchases (yours first),
   select the list, then **Save changes**.

   License testers pay with Google's test cards and are never charged. **Everyone else is
   charged real money, even inside a closed test.** Your 12 closed-test testers only get
   free test purchases if they are on this list too.

## Part 2. RevenueCat: project and the app key

1. Sign up at [app.revenuecat.com](https://app.revenuecat.com) and create a project named
   `Lately`.

2. **Add the Android app.** In the project, open **Apps** and add an app config for
   **Google Play Store**:
   - App name: `Lately`
   - Package Name: `app.lately.android`

   Save. The Service Account Credentials JSON field stays empty for now (Part 5).

3. **Copy the public Android key into the build settings.** Project settings → **API
   keys**. Copy the key of the Google Play app; it starts with `goog_` (not the Test Store
   key). This key is public by design: it ships inside the app.

   Put it where the store build reads it, the EAS `production` environment. From
   `frontend/`:

   ```bash
   npx eas-cli env:set --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value goog_xxxxxxxx --environment production --visibility plaintext
   ```

   (Or on expo.dev → your project → Environment variables → add it for Production, plain
   text.)

   **The other four app settings go in the same place.** EAS builds run in Expo's cloud, and
   `frontend/.env` is git-ignored, so it is not uploaded: a production build there sees only
   the EAS environment. All five `EXPO_PUBLIC_*` values must be set before the build in
   Part 3, or it stops. Use the same command for each (the API URL and Supabase values are
   in `docs/launch-checklist.md` step 3):

   ```bash
   npx eas-cli env:set --name EXPO_PUBLIC_API_MODE --value live --environment production --visibility plaintext
   npx eas-cli env:set --name EXPO_PUBLIC_API_URL --value https://<api-host> --environment production --visibility plaintext
   npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --environment production --visibility plaintext
   npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <publishable-key> --environment production --visibility plaintext
   ```

   `frontend/.env` is only for local Gradle builds on your own machine; there, put all five
   values in it instead.

   A production build also refuses to build without the RevenueCat key, with the message
   `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY must be the RevenueCat Google Play SDK key (starts with "goog_")`.

## Part 3. Upload a first build

Play Console only unlocks subscriptions after it has seen a build that contains Google Play
Billing. Every Lately build made from this code does (it includes `react-native-purchases`).

1. Build the release bundle as in `docs/deploy.md` §3, for example
   `npx eas-cli build -p android --profile production` from `frontend/`.
2. Play Console → **Testing** → **Internal testing** → create a release, upload the
   `.aab`, and roll it out. Internal testing is enough to unlock products; the closed test
   for the 12-tester rule comes later.

## Part 4. Google Play Console: the subscription

All of this is under **Monetize with Play** → **Products** → **Subscriptions**.

1. **Create the subscription.** **Create subscription**:
   - Product ID: `lately_pro`
   - Name: `Lately Pro`

   **Create**. The product ID can never be changed or reused. Optionally, **Edit
   subscription details** → add the benefit `Unlimited saves every month` (don't list
   anything Pro doesn't do) → **Save changes**.

2. **Add the monthly base plan.** **Add base plan**:
   - Base plan ID: `monthly`
   - Type: **Auto-renewing**
   - Billing period: **Monthly**
   - Leave grace period, account hold, plan changes and resubscribe on their defaults.

   Prices: under **Price and availability**, **Manage country/region availability** → pick
   the countries where Lately is listed (at least United States) → **Apply**. Then
   **Update prices** → select all → **Set price** → `3.99` USD. Play asks for the price
   without tax: US buyers see $3.99 plus any sales tax. Play converts the price into every
   other country's currency and rounds it to local norms; you can change single countries
   with the pencil icon in the Price column.

   **Save**, then **Activate**.

3. **Add the yearly base plan.** Same as step 2 with Base plan ID `yearly`, Billing period
   **Yearly**, price `29.99` USD. **Save**, then **Activate**.

4. **Add the free trial.** **Add offer** → choose the `yearly` base plan:
   - Offer ID: `trial-7d`
   - Eligibility: **New customer acquisition** → **Never had this subscription**
   - **Add phase** → **Free trial** → 7 days

   **Save**, then **Activate**.

Check: `lately_pro` shows two active base plans, `monthly` and `yearly`, and an active
offer `trial-7d` on `yearly`.

The app shows "7 days free" only when Google Play says the person can still get the trial.
Someone who already had Lately Pro on that Google account sees "Subscribe for
$29.99/year" instead. The "Save 37%" pill on the yearly card is worked out from the real
prices ($29.99 against 12 × $3.99), so it changes if you change prices.

## Part 5. Connect RevenueCat to Google Play

RevenueCat needs its own access to your Play account to check purchases. Follow
RevenueCat's guide
([Creating Play Service Credentials](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials));
the short version:

1. **Create a Google Cloud service account.** In [Google Cloud Console](https://console.cloud.google.com)
   (create a project if you have none):
   - APIs & Services → Library: enable **Google Play Android Developer API**, **Google
     Play Developer Reporting API** and **Cloud Pub/Sub API**.
   - IAM & Admin → **Service Accounts** → **Create service account**, any name (for
     example `revenuecat`), roles **Pub/Sub Editor** and **Monitoring Viewer**. Skip the
     optional step and finish.
   - On the new account: **Manage keys** → **Add key** → **Create new key** → **JSON**.
     A `.json` file downloads. Treat it like a password: never put it in the repo.

2. **Let the service account into Play Console.** Play Console → **Users and
   permissions** → invite a new user with the email in the JSON file's `client_email`
   field.
   - App permissions: add Lately.
   - Account permissions: **View app information and download bulk reports (read-only)**,
     **View financial data, orders, and cancellation survey responses**, **Manage orders
     and subscriptions**, **Manage store presence**.

   Send the invite.

3. **Upload the JSON to RevenueCat.** RevenueCat → Apps → the Google Play app →
   **Service Account Credentials JSON** → upload the file → Save. It can take up to 36
   hours before RevenueCat can use it. RevenueCat's tip to speed this up: change any
   product description in Play Console, save, then change it back.

4. **Turn on Real-time Developer Notifications** (so cancellations and expiries reach
   RevenueCat within minutes instead of about an hour). Guide:
   [Google Real-Time Developer Notifications](https://www.revenuecat.com/docs/platform-resources/server-notifications/google-server-notifications).
   - RevenueCat → the Google Play app's settings, below the credentials → **Connect to
     Google**. Copy the Pub/Sub topic ID it shows (refresh if it doesn't appear).
   - Play Console → **Monetize with Play** → **Monetization setup** → Real-time developer
     notifications: paste the topic ID into **Topic name**, set Notification content to
     **Subscriptions, voided purchases, and all one-time products**, **Save changes**,
     then **Send test notification**.
   - Back in RevenueCat, the app settings show **Last received** with a recent time.

5. **Import the products.** RevenueCat → **Product catalog** → **Products** → **+ New** →
   **Import Products** → select `lately_pro:monthly` and `lately_pro:yearly`. If they don't
   appear yet (credentials still pending), add them by hand: **+ New product** → Google
   Play → subscription ID `lately_pro`, base plan ID `monthly`; repeat for `yearly`.

6. **Create the entitlement.** **Product catalog** → **Entitlements** → **+ New
   entitlement** → identifier `pro` (lowercase, exactly). Open it → **Attach** → attach
   both products.

7. **Create the offering.** **Product catalog** → **Offerings**. If RevenueCat already made
   one called `default`, open it; otherwise **+ New** → Identifier `default`, Description
   `Lately Pro` → Save. Then **+ Add package** twice:
   - Identifier **Monthly** (`$rc_monthly`) → product `lately_pro:monthly`
   - Identifier **Annual** (`$rc_annual`) → product `lately_pro:yearly`

   Make sure `default` is marked as the default (current) offering. The app only reads the
   current offering.

8. **Create the secret API key for the backend.** Project settings → **API keys** →
   **+ New secret API key**. Name it `Lately backend`, choose API version **V1** (the
   backend calls RevenueCat's REST API v1, so the key must be a V1 key), then **Generate**. Copy
   the key (it starts with `sk_`) and set it on the backend, from `backend/`:

   ```bash
   fly secrets set REVENUECAT_SECRET_API_KEY='sk_xxxxxxxx'
   ```

   Never put this key in the app or in `frontend/.env`.

   Why it matters: with this key, the backend asks RevenueCat what each user really has on
   every event and on every in-app sync, instead of trusting the event alone. That is what
   makes Pro turn on the moment a purchase or restore finishes, handles Pro moving between
   accounts, and ends Pro right away after a refund. Without it, the backend goes only by
   the webhook events, and `POST /billing/sync` changes nothing.

## Part 6. The webhook (RevenueCat → backend)

1. **Make a password for the webhook.** Any long random string. On any computer with
   Python:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

2. **Give it to the backend** (from `backend/`):

   ```bash
   fly secrets set REVENUECAT_WEBHOOK_AUTH='<the string>'
   ```

   While this is empty, `POST /webhooks/revenuecat` answers 404.

3. **Add the webhook in RevenueCat.** Project → **Integrations** → **Webhooks** → **Add
   new configuration**:
   - Name: `Lately backend`
   - URL: `https://<api-host>/webhooks/revenuecat`, for example
     `https://lately-api.fly.dev/webhooks/revenuecat`
   - Authorization header value: the same string as step 2, exactly. Don't add `Bearer`
     or anything else; the backend compares the whole value.
   - Environment: production **and** sandbox (sandbox = license-tester purchases)
   - Apps: all apps (or Lately). Events: all.

   Save.

4. **Optional: signed deliveries.** In the same webhook configuration, turn on **HMAC
   webhook signing** and copy the signing secret (RevenueCat shows it only once). Then:

   ```bash
   fly secrets set REVENUECAT_WEBHOOK_SIGNING_SECRET='<signing secret>'
   ```

   Do it in this order: the backend only checks signatures once its secret is set, so
   nothing fails in between. If you ever **Rotate secret** in RevenueCat, set the new one
   on the backend straight away; until then deliveries get 401 and RevenueCat retries them.

5. **Send a test event** from the webhook's page in RevenueCat. Expect **200** in the
   delivery list. Test events are stored (`billing_events`) and change no plan.

   | RevenueCat shows | Meaning |
   |---|---|
   | 200 | Working |
   | 404 | `REVENUECAT_WEBHOOK_AUTH` isn't set on the server (or the URL is wrong) |
   | 401 | The Authorization value doesn't match, or the signing secret doesn't |
   | 503 | The backend couldn't reach RevenueCat's API with the secret key; RevenueCat retries |

RevenueCat retries a failed delivery up to 5 times over about 80 minutes; after that, use
**Retry** in the webhook's event table. Each event is processed once even if it arrives
twice.

**Sandbox purchases.** `REVENUECAT_ALLOW_SANDBOX` is `true` by default, so license-tester
purchases unlock Pro during closed testing. After launch you can switch it off:

```bash
fly secrets set REVENUECAT_ALLOW_SANDBOX=false
```

Then sandbox webhook events are still recorded but change no plan. This setting only
covers webhook events: the in-app sync (`POST /billing/sync`, with the secret key) applies
whatever RevenueCat reports for that user, test purchases included.

Leave `REVENUECAT_ENTITLEMENT_ID` (`pro`) and `REVENUECAT_API_BASE_URL` on their defaults.
Every backend setting is listed in `backend/.env.example`.

## Part 7. Test a purchase (closed-test build, license tester)

You need: Parts 1 to 6 done; a build on a testing track (the closed test you run for the
12-tester rule works); a tester Gmail that is on the License testing list (Part 1, step 3)
**and** on that track's tester list.

1. On the test phone, keep only that one Google account signed in to Google Play
   (several accounts can break test purchases).
2. Open the track's opt-in link, accept, and install Lately from Google Play. Products
   don't load in a copy that wasn't opted in.
3. Sign in to Lately. Go to Account → **Upgrade to Pro** (the same screen opens from
   "Upgrade to Pro" when free saves run out, and from the free-saves banner on Home).
4. Yearly is preselected. Tap **Try 7 days free**. Google Play's sheet should offer a test
   card such as "Test card, always approves". **If it only offers your real card, stop:**
   the account isn't a license tester and you would be charged.
5. Confirm. The app shows "You're on Pro" and "Unlimited saves are on." Account now shows
   "Lately Pro". If it shows "Turning Pro on" instead, Google Play has confirmed the purchase
   but the backend hasn't heard yet (no secret key, or the webhook is late). Tap **Check
   again** after a minute.
6. Check RevenueCat: turn on **View sandbox data**, find the customer by the Supabase user
   ID, and see the `INITIAL_PURCHASE` event delivered to the webhook with 200.

Test subscriptions run on a fast clock:

| Real length | In a test purchase |
|---|---|
| 7-day free trial | about 3 minutes |
| 1 month | renews about every 5 minutes |
| 1 year | renews about every 30 minutes |

A test subscription renews at most 6 times, then ends on its own, which also tests expiry:
a few minutes later the account is back on the free plan.

Also worth trying:
- **Cancel:** Google Play → Subscriptions → Lately Pro → Cancel subscription. Lately stays
  Pro until the (short) period ends, then goes back to free.
- **Restore:** uninstall, reinstall, sign in, Account → **Restore purchases**.
- **Pending payment:** pay with "Slow test card, approves after a few minutes". The app says
  "Your payment is pending. Pro turns on when Google Play confirms it."

To look at the database directly (Supabase → SQL editor):

```sql
select plan, plan_expires_at, plan_changed_at from public.profiles where email = 'tester@gmail.com';
select type, environment, received_at, processed_at from public.billing_events order by received_at desc limit 10;
```

## Part 8. What happens when...

**Someone subscribes.** Google Play charges (or starts the trial), RevenueCat sends
`INITIAL_PURCHASE`, and the backend sets `plan = 'pro'` with `plan_expires_at` = the end
of the current period (the end of the trial, during a trial). The app's sync right after the
purchase does the same at once when the secret key is set. Until the backend agrees, the app
says "Turning Pro on" (with a **Check again** button) rather than "You're on Pro", because
the backend is what enforces the 20-saves cap.

**It renews.** `RENEWAL` moves `plan_expires_at` forward.

**They cancel.** Canceling only turns off auto-renewal. Lately stays Pro until the end of
the period they paid for (`CANCELLATION` changes nothing), then `EXPIRATION` puts them back
on the free plan. If they turn renewal back on before then (`UNCANCELLATION`), nothing
changes. Uninstalling the app doesn't cancel a subscription.

**A payment fails.** Google keeps retrying (the base plan's grace period and account hold).
`BILLING_ISSUE` changes nothing. With the secret key, Pro stays on through Google's grace
period; without it, Pro counts as ended one day after the paid period, until a payment goes
through. If the payment never recovers, `EXPIRATION` ends Pro.

**It expires.** `EXPIRATION` sets the plan back to free and the 20-saves cap applies again
from the next save. As a safety net, if no event arrives, a Pro plan counts as free one day
after `plan_expires_at` (`has_paid_plan()` in migration 0013).

**You refund someone.** Play Console → **Order management** → the order → **Refund and
revoke** ends access at once and cancels future renewals; **Refund only** refunds an older
payment and leaves the subscription running. (RevenueCat's customer page can also refund a
Google Play subscription.) RevenueCat then sends `CANCELLATION`. With the secret key, the
backend asks RevenueCat and the account goes back to free straight away. Without it, the
account goes back to free when the event shows the paid period has already ended,
otherwise at `EXPIRATION`. Users can also ask Google for a refund themselves
([Google Play refunds](https://support.google.com/googleplay/answer/2479637)).

**They delete their Lately account.** The app deletes the account, everything in it, and
its stored billing events. It does **not** cancel the Google Play subscription; for Pro
users (and anyone the store already reports as Pro) the delete confirmation says "Deleting
your account doesn't cancel your Google Play subscription. Cancel it in Google Play first."
Everyone else on a build with the store, except lifetime accounts, sees "If you subscribed to
Lately Pro, deleting your account doesn't cancel it. Cancel it in Google Play first.", since a
subscription in account hold reads as free here. If they didn't cancel, you can cancel it for them
in Play Console → Order management → **Cancel subscription**. Events that arrive later for
a deleted account change nothing, but they are still stored in `billing_events`.
RevenueCat keeps its own customer record under the old user ID; when someone asks for all
their data to be erased, also delete the customer in RevenueCat (customer page → Manage →
delete customer). That doesn't cancel the Google subscription either.

**They switch phones.** Sign in to the same Lately account; Pro is on the account, not
the phone. If it doesn't show, Account → **Restore purchases** (on the free plan it sits under
**Upgrade to Pro**; builds without the store don't have it), or **Restore** at the top right
of the Pro screen.

**They restore on a different Lately account.** With RevenueCat's default restore setting
("Transfer to new App User ID", in Project settings → General), Pro moves to the account
that restored and RevenueCat sends `TRANSFER`. The old account goes back to free. The new
account gets Pro at once with the secret key; without it, only at its next renewal.

**Lifetime plans.** A profile with `plan = 'lifetime'` is never changed by billing events.
To give someone free Pro by hand, set it in the SQL editor:
`update public.profiles set plan = 'lifetime' where email = '...';`

## Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| Build stops: `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY must be the RevenueCat Google Play SDK key (starts with "goog_")` | The key isn't in the build's environment | Part 2, step 3 (EAS `production` environment, or `frontend/.env` for local builds) |
| Paywall: "Purchases aren't available in this build." | A build without the key, Expo Go, or the web app | Install a build made with the key from Google Play |
| Paywall: "Couldn't load the plans" / "Plans aren't available right now." or "This plan isn't available right now." | No current offering, missing `$rc_monthly`/`$rc_annual` packages, base plans not active, or the app wasn't installed from a testing track you opted in to | Part 4, Part 5 steps 5 to 7, Part 7 step 2 |
| App: "Your purchase went through, but Pro isn't on yet. Tap Restore in a minute." | The products aren't attached to the `pro` entitlement (or it's spelled differently) | Part 5, step 6, then **Restore** |
| Google Play: "Item attempting to purchase could not be found" | The installed build doesn't match the Play app (package name or signing), or the products aren't active yet | Install from the testing track; check Part 4 |
| Google Play sheet only offers a real card | The Google account isn't a license tester | Part 1, step 3. Don't buy |
| Purchase finished but the app says "Turning Pro on", still shows the free plan, or saves are still capped | The webhook isn't arriving and there's no secret key | Check the webhook delivery list (table in Part 6); set `REVENUECAT_SECRET_API_KEY` so the in-app sync turns Pro on at once |
| Webhook deliveries fail with 503 | The secret key is wrong, revoked, or a V2 key | Create a **V1** secret key (Part 5, step 8); RevenueCat retries, or use **Retry** |
| Webhook deliveries fail with 401 | Authorization value differs (extra `Bearer `, a space, an old value), or the signing secret was rotated | Paste the same value in both places (Part 6) |
| A license-tester purchase doesn't turn on Pro | `REVENUECAT_ALLOW_SANDBOX=false` and no secret key | Set it back to `true` while testing |
| RevenueCat says the credentials are invalid, or products won't import | The service account invite or permissions are missing, or the 36 hours aren't up | Part 5, steps 2 and 3; add products by hand meanwhile |
| **Last received** never appears after the test notification | Google can't publish to the Pub/Sub topic | In Google Cloud → Pub/Sub → the topic → Permissions, add `google-play-developer-notifications@system.gserviceaccount.com` with role **Pub/Sub Publisher** |
| App: "That Google Play purchase belongs to another Lately account." | RevenueCat's restore setting is "Keep with original App User ID" | Sign in to the account that bought it, or switch the setting back to "Transfer to new App User ID" |
| App: "You already have this subscription. Tap Restore to turn Pro on." | The Google account already subscribed | Tap **Restore** on the Pro screen |
| No "7 days free" on the yearly plan | The Google account already had Lately Pro before, or `trial-7d` isn't active | Expected for returning subscribers; otherwise activate the offer (Part 4, step 4) |

## Sources (checked 2026-10-21)

- Google Play: [Create and manage subscriptions](https://support.google.com/googleplay/android-developer/answer/140504),
  [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152),
  [Set up a payments profile](https://support.google.com/googleplay/android-developer/answer/7161426),
  [License testing](https://support.google.com/googleplay/android-developer/answer/6062777),
  [Getting ready (upload before creating products)](https://developer.android.com/google/play/billing/getting-ready),
  [Test your integration (test renewal times, test cards)](https://developer.android.com/google/play/billing/test),
  [Refunds and cancellations from Play Console](https://support.google.com/googleplay/android-developer/answer/2741495),
  [Cancel a subscription (users)](https://support.google.com/googleplay/answer/7018481).
- RevenueCat: [Play service credentials](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials),
  [Google Real-Time Developer Notifications](https://www.revenuecat.com/docs/platform-resources/server-notifications/google-server-notifications),
  [Connect a store](https://www.revenuecat.com/docs/projects/connect-a-store),
  [Products](https://www.revenuecat.com/docs/offerings/products-overview),
  [Google Play products](https://www.revenuecat.com/docs/getting-started/entitlements/android-products),
  [Entitlements](https://www.revenuecat.com/docs/getting-started/entitlements),
  [Offerings](https://www.revenuecat.com/docs/offerings/overview),
  [API keys](https://www.revenuecat.com/docs/projects/authentication),
  [Webhooks](https://www.revenuecat.com/docs/integrations/webhooks),
  [Webhook event types](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields),
  [Google Play sandbox testing](https://www.revenuecat.com/docs/test-and-launch/sandbox/google-play-store),
  [Restore behavior](https://www.revenuecat.com/docs/projects/restore-behavior),
  [Refunds](https://www.revenuecat.com/docs/subscription-guidance/refunds),
  [Customer profile (delete customer)](https://www.revenuecat.com/docs/dashboard-and-metrics/customer-profile).
- Expo: [EAS environment variables](https://docs.expo.dev/eas/environment-variables/),
  [`eas env:set`](https://docs.expo.dev/eas/cli/).
