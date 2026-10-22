# App access: sign-in details for Play reviewers

Everything in Lately is behind sign-in, so Google's reviewers need a way in. Play Console →
**Policy and programs** → **App content** → **Sign-in details** (older consoles call it
"App access") → **Manage** → choose that some functionality is restricted → **+ Add new
instructions**. Up to five sets of instructions; there is a free-text field, "Any other
instructions", for anything unusual such as a one-time code
([Play Console Help: App content, sign-in details](https://support.google.com/googleplay/android-developer/answer/9859455)).

## What Google requires

From [Requirements for providing sign in details for review](https://support.google.com/googleplay/android-developer/answer/15748846):

- Credentials must work at all times, be reusable, work from any country, and be in English.
- Expired or broken credentials can get the app rejected.
- For sign-in with Google or another provider, give all the account details and clear
  instructions.
- If the app normally needs a one-time code or 2-step verification, give reusable
  credentials that bypass it.

## Why this needs a decision

Lately has two sign-in methods (`frontend/src/auth/AuthProvider.tsx`): **Continue with
Google**, and **email with a 6-digit code** (Supabase `signInWithOtp`). There is no password
sign-in, and we found no Supabase setting that gives an email address a fixed test code. A
reviewer cannot receive a code sent to your inbox, so
the email route does not meet the "bypass the one-time code" rule as the app is today.
**[CONFIRM]** which option below you choose.

### Option A, no code change: a dedicated Google account (available now)

1. Create a new Google account only for review, for example `lately.review.<something>@gmail.com`,
   with a long random password stored in your password manager.
2. Do **not** turn on 2-Step Verification for it. Add a recovery email you control.
3. On a test phone, install the Play build, tap **Continue with Google**, pick that account.
   This creates the Lately account. Save one or two reels so the library is not empty.
4. Sign in to the account once more from a different device or browser, so Google has seen
   more than one sign-in.
5. In Play Console, add the instructions below.

Risk: Google sometimes asks "Verify it's you" when an account signs in from a new device or
country, and the reviewer cannot answer that. If a review fails at sign-in, Play usually
says so in the rejection email; switch to option B.

### Option B, small app change (more reliable, not built)

Ask the team for a review-only sign-in that needs no code from email, for example: turn on
Supabase email + password for one allow-listed review address and show a password field only
for that address, or let the backend accept one fixed code for that address. Either keeps
the normal sign-in unchanged for everyone else. This touches `AuthProvider.tsx` and the
sign-in screen, so it is outside this stage.

Not recommended: a public disposable inbox (anyone could read the codes, and Google asks for
credentials that skip the code, not a way to fetch it).

## Text to paste (option A)

Name: `Lately review account`

Username: `[REVIEW GOOGLE ACCOUNT EMAIL]`

Password: `[REVIEW GOOGLE ACCOUNT PASSWORD]`

Any other instructions:

```text
Lately uses Google sign-in. On the first screen tap "Continue with Google" and sign in with the Google account above (no 2-step verification is turned on).

To save a reel: open any public Instagram reel, tap Share, choose Lately. Without Instagram, tap the save button in Lately and paste one of these public links:
[PUBLIC REEL LINK 1]
[PUBLIC REEL LINK 2]
The save appears at once and its card fills in after the reel is read. Search for it by typing a word from the reel.

The free plan allows 20 saves a month. Lately Pro (Google Play subscription) only removes that monthly limit; nothing else is locked. The account and all its data can be deleted in Account and settings > Delete account (please do not delete this review account).
```

Fill the placeholders with real values before saving. Pick reels that are public, safe for
work, and likely to stay up; check them the day you submit.

## Keep it working

- The backend must be live and the review account must stay on the free plan with room
  for saves. If the monthly limit is near, either delete a few saves or give the account Pro
  by hand. The billing migration supports a manual grant that webhooks will not undo
  (`supabase/migrations/0013_billing.sql`): in the Supabase SQL editor,
  `update public.profiles set plan = 'pro', plan_expires_at = null, plan_changed_at = 'infinity' where email = '[REVIEW GOOGLE ACCOUNT EMAIL]';`
- Do not change the review account's password without updating Play Console the same day.
- If the sign-in flow changes (option B), update these instructions before the next release.
