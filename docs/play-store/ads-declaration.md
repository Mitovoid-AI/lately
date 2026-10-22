# Ads declaration

Play Console → **Policy and programs** → **App content** → **Ads** → **Start**.

**Does your app contain ads?** → **No, my app does not contain ads.**

The declaration covers ads from third-party SDKs too
([App content: Ads](https://support.google.com/googleplay/android-developer/answer/9859455)).
Checked on 2026-10-22:

- `frontend/package.json` has no ad SDK (no Google Mobile Ads, AppLovin, Meta Audience
  Network, Unity Ads or similar) and no analytics or attribution SDK.
- The only third-party SDKs that talk to the network are Supabase (`@supabase/supabase-js`)
  and RevenueCat (`react-native-purchases`). Neither shows ads.
- The paywall for Lately Pro is the app's own subscription offer, not an ad.
- `frontend/legal/privacy.md` says Lately does not show ads and has no advertising or
  analytics trackers.

Re-check before each release: if an ad, analytics or attribution SDK is ever added, this
answer and the Data safety form both change.

Related: if App content also asks about the **advertising ID**, answer that Lately does not
use it. No SDK in `package.json` reads it and `frontend/app.json` does not request
`com.google.android.gms.permission.AD_ID`. Google notes that some libraries add `AD_ID` to
the merged manifest on their own
([Advertising ID](https://support.google.com/googleplay/android-developer/answer/6048248)),
so **[CONFIRM]** after the first release build that the bundle has no `AD_ID` permission
(Play Console → App bundle explorer → the bundle → Permissions).
