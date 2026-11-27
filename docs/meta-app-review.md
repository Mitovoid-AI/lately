# Opening "Save from Instagram DMs" to everyone: the Meta App Review pack

Today only Instagram accounts with a role on the Meta app (Instagram Testers) can save by DM.
Everyone else needs **Advanced Access** to `instagram_manage_messages`, which only App Review
grants. In this dashboard, App Review is reachable only after the business becomes a **Tech
Provider**, which Meta says can't be reversed. This file holds everything the review asks
for, so the submission is copy and paste.

State on 2026-11-27: App settings → Basic has the privacy policy, terms, data deletion URL,
category (Utility and productivity) and the app icon. Not done yet: backend off the laptop,
business verification, Tech Provider, review, Live.

## Order (nothing irreversible before step 5)

1. **App icon.** App settings → Basic → App icon → choose file → `frontend/assets/brand/icon.png`
   (1024×1024) → Save changes.
2. **Backend always on.** Reviewers DM `@latelyinsta02` at any hour, and the reply must come
   back. Move the backend off the laptop first (`docs/deploy.md`), then repoint Meta's webhook
   callback URL to it (Use cases → Customize → API setup with Unified login → 3. Configure
   webhooks) and re-run `verify`. The test APK has the API address built in (the GitHub
   variable behind `EXPO_PUBLIC_API_URL`), so update it and release a new test build that
   talks to the new backend before reviewers download it.
3. **Business verification** of the "Lately app" portfolio: business.facebook.com → Settings
   → Security Centre → Business verification, use case "App requires access to permissions on
   Meta for Developers" → **Start verification**. Documents below. Wait for approval.
4. **Prepare the screencast** (script below) while verification runs.
5. **Become a Tech Provider** (irreversible): Use cases → Customize → Permissions and
   features → `instagram_manage_messages` → Actions → **Add to App Review** → the "become a
   Tech Provider" dialog → Continue. Then Add to App Review on `instagram_basic` too. If the
   form says `business_management` is a dependency, add it as well. Leave `ads_management`,
   `ads_read`, `instagram_content_publish` and `instagram_manage_comments` out: Lately doesn't
   use them.
6. **Fill the submission** from the answers below and upload the screencast.
7. **Submit.** Meta now reviews the whole app (icon, name, privacy and deletion URLs,
   existing access) and the submission can't be edited or cancelled once it's in review.
8. **After approval:** Publish (left menu) → switch the app from Unpublished to Live.
9. **Check with a stranger's account:** DM a code from an Instagram account with no role on
   the app. Expect the "Connected" reply.

## Business verification documents (India)

Meta's own list for India: **GST registration certificate**, **certificate of incorporation**,
or **PAN card** (business PAN is safer than personal). PDF, PNG, JPG or JPEG, at most 10 MB
each, legible, not expired. The legal name and address you type must match the document
exactly. Sole proprietors without GST often get through with Udyam (MSME) or a Shop and
Establishment certificate plus a business-name bank statement, but those aren't on Meta's own
list, so prefer GST if you have it. Meta also checks a phone number, email or domain that
matches the business. A business email on your own domain helps.

## Permission answers

### instagram_manage_messages

- **Experience type:** Automated.
- **Instagram handle:** `latelyinsta02`
- **How Lately uses it:**
  > Lately is a mobile app that saves Instagram reels into a personal, searchable library.
  > This permission lets Lately's own Instagram professional account (@latelyinsta02) receive
  > the direct messages people send it and reply automatically. A user connects once: the
  > Lately app shows a one-time code, the user sends it to @latelyinsta02 in Instagram, and
  > Lately links that Instagram conversation to their Lately account and replies "Connected".
  > After that, whenever the user shares a reel to @latelyinsta02, Lately saves the reel's
  > link to their library and replies "Saved to Lately". A short text sent within five
  > minutes of a save becomes that save's note. Lately reads only messages sent to its own
  > account, replies only to the person who wrote, and never sends promotional or unprompted
  > messages. Users can disconnect at any time in the app.
- **How to test (commands):**
  1. Install the Lately Android app (link in reviewer instructions) and sign in with Google.
  2. Open Account and settings → Save from Instagram DMs and copy the code (`LATELY-` plus
     6 characters, valid 15 minutes).
  3. In Instagram, send that code as a direct message to @latelyinsta02. Reply: "Connected.
     Send me any reel and I'll save it to your Lately library."
  4. Open any public reel → Share → send it to @latelyinsta02. Reply: "Saved to Lately. Your
     card will be ready in about 30 seconds." The card appears in the app's library.
  5. Optional: within 5 minutes, send a short text. Reply: "Added your note."
  6. Any other message gets: "I couldn't find a reel in that message. In Instagram, tap Share
     on a reel and send it here."

### instagram_basic

> Needed alongside instagram_manage_messages to identify Lately's own Instagram professional
> account (its account ID and username) so the app can receive webhooks for it and send
> replies from it. Lately reads no profile or media of the people who message it.

### business_management (only if the form requires it)

> Required by Meta as a dependency of instagram_manage_messages under the business login.
> Lately uses it only to access its own business portfolio's Instagram account; it doesn't
> read or manage any other business's assets.

## Reviewer instructions

> Lately is an Android app. Download the latest build from
> https://github.com/Mitovoid-AI/lately/releases/latest (or the Google Play test link, if
> provided) and sign in with any Google account; no test credentials are needed. Then follow
> the "How to test" steps under instagram_manage_messages. Replies come within a few seconds.

Platform for verification details: Website, `https://mitovoid-ai.github.io/lately/`.
Leave credentials blank.

## Screencast script (about 90 seconds, phone screen recording, English captions)

Record on a phone with the **submitted** app build, signed in, and an Instagram account that
isn't @latelyinsta02. Captions in quotes.

1. Lately app → Account and settings. "Lately saves Instagram reels into a searchable library."
2. Tap Save from Instagram DMs. "Connect Instagram once, then save reels by sharing them to
   @latelyinsta02."
3. Tap to get a code, show it. "A one-time code links your Instagram conversation to your
   Lately account."
4. Switch to Instagram → open a chat with @latelyinsta02 → paste and send the code → the
   Connected reply appears. "instagram_manage_messages: Lately receives the code and replies."
5. Open any reel → Share → send to @latelyinsta02 → the Saved reply appears. "Sharing a reel
   saves it."
6. Back in Lately → the new card in the library (wait for it). "The reel is now a card in the
   user's library."
7. Account and settings → Save from Instagram DMs → Disconnect. "Users can disconnect any
   time; Lately deletes the link."

## Data handling answers (Tech Provider questionnaire)

- **What Meta data Lately receives:** the Instagram-scoped ID of people who message
  @latelyinsta02, the messages they send it (reel links, short texts) and message IDs.
- **What Lately stores, and for how long:**
  - The Instagram-scoped ID ↔ Lately account link, until the user disconnects or deletes
    their account.
  - Message IDs, for 7 days, only to avoid handling the same message twice.
  - The saved reel's link and any note, as part of the user's library, until the user
    deletes them or their account.
  - No Instagram usernames, passwords, profile data or other message text.
- **Who processes it:** the service providers named in the privacy policy: Supabase
  (database and sign-in), OpenRouter and the model it routes to (writing the card), Groq
  (transcribing reel audio) and OpenAI (search embeddings). Lately doesn't sell data or share
  it for advertising.
- **Security:** TLS everywhere. Every webhook is checked against Meta's signature
  (X-Hub-Signature-256). The access token and app secret live only in the server's
  environment. Logs never contain message text, tokens or secrets. The database is only
  reachable by the backend.
- **Deletion:** Disconnect in the app, or delete the account
  (https://mitovoid-ai.github.io/lately/delete-account.html). Both remove the Instagram link.
- **Government data requests:** none received.

## Sources

- Meta, access levels: https://developers.facebook.com/docs/graph-api/overview/access-levels/
- Meta, App Review for apps that serve your own business:
  https://developers.facebook.com/documentation/business-messaging/instagram-messaging/app-review/apps-for-your-own-business
- Meta, Tech Providers: https://developers.facebook.com/docs/development/release/tech-providers/
- India document lists (third-party, not Meta):
  https://support.wati.io/en/articles/11463208-meta-business-verification-required-documents-by-country
