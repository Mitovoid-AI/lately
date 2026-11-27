# Save from Instagram DMs: switching it on

Users save a reel without leaving Instagram: they tap **Share** on the reel and send it to
Lately's Instagram account. Lately saves it to their library and replies in the chat.

How the pieces fit:

1. In the app the user gets a one-time code, `LATELY-` plus 6 characters, valid 15 minutes
   (`POST /me/instagram/code`). While the feature is on, this is required: a signed-in account
   that hasn't connected yet lands on `/connect-instagram` (no back, no skip, only Sign out) before
   any tab opens, and Home opens once the code arrives. Later it lives under Account → Connected
   accounts → Save from Instagram DMs. Until Meta's App Review passes, only Instagram Testers get
   a reply, so anyone else can't get past that screen; don't open sign-ups widely before then.
2. They DM the code to Lately's Instagram account. Meta sends the message to the backend
   (`POST /webhooks/instagram`), which links that Instagram account to their Lately account.
3. From then on every reel they send there goes through the same `save_reel()` as the app's
   share sheet, and counts against the same monthly quota and hourly limit. A text sent
   within 5 minutes of a save becomes that save's note.

Everything in the repo is built and tested. Until you finish this guide nothing changes:
without the settings the webhook answers 404, `GET /me/instagram` says the feature is off
and the app shows it as unavailable.

## What you need

- An Instagram **professional** account (Business or Creator) for Lately, set to **public**
  (Meta only makes tokens for public accounts). Ours is `latelyinsta02`.
- A Meta developer account (developers.facebook.com), logged in as someone who can manage
  that Instagram account.
- A Meta **business portfolio** to own the app. Unified login (below) refuses to open
  without one. Creating it is free and verification isn't needed to test; ours is "Lately app".
- The backend reachable over `https://` (the laptop backend's ngrok address, or a cloud
  deploy, `docs/deploy.md`). Meta does not call `http://` or `localhost`.

## The names to copy exactly

| Setting (backend env) | Value | Where it comes from |
|---|---|---|
| `INSTAGRAM_APP_SECRET` | the Meta **App secret** (signs the webhooks) | Meta app → App settings → Basic → App secret → Show |
| `INSTAGRAM_VERIFY_TOKEN` | any long random string you make up | you; typed again in Meta's webhook setup |
| `INSTAGRAM_ACCESS_TOKEN` | Lately's system-user token (never expires; starts `EA`) | Meta app → API setup with Unified login → Generate access tokens → Generate token |
| `INSTAGRAM_HANDLE` | `latelyinsta02` (no `@`) | the Instagram username; the app shows it to users |
| `INSTAGRAM_ACCOUNT_ID` | Lately's Instagram account id; **needed for replies** | the `id` from `GET /me/assigned_instagram_accounts` (step 2.5) |
| Webhook callback URL | `https://<API host>/webhooks/instagram` | typed in Meta's webhook setup |
| Webhook field | `messages` | subscribed in Meta's webhook setup |

The feature is on only when the first four are all set. Replies also need
`INSTAGRAM_ACCOUNT_ID`: without it they go to `/me/messages`, which with a system-user token
is the system user, not the Instagram account, so Meta rejects them. Make the verify token with:

```
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Steps

### 1. Lately's Instagram account

1. In Instagram, switch Lately's account to a professional account (Settings → Account type
   and tools → Switch to professional account) if it isn't one.
2. Allow tools to read its messages: Settings → Messages and story replies → Message
   controls → Connected tools → **Allow access to messages** on. (Without this Meta sends no
   message webhooks. The menu wording moves between Instagram versions.)

### 2. The Meta app (Unified login)

Since late October 2026 new Meta apps no longer offer "API setup with Instagram login" (the
page says so in a banner). They get **API setup with Unified login**: a system-user token
that belongs to the business portfolio, on `graph.facebook.com`. The backend is built for it.

1. developers.facebook.com → My Apps → Create app, use case **Manage messaging & content on
   Instagram**. Then Use cases → Customize → **API setup with Unified login**, and connect the
   business portfolio when it asks.
2. **1. Configure your app** → Create new configuration → **Create from template**. The
   template can't be edited here: next to `instagram_basic` and `instagram_manage_messages`
   it adds `ads_management`, `ads_read`, `instagram_content_publish`,
   `instagram_manage_comments` and ad-account access. Lately uses only the first two. The
   token type is system-user and never expires.
3. App roles → Roles → **Add People** → **Instagram Tester** (under "Additional roles"), and
   add Lately's account and your own test account. Accept each invite **on the website**,
   logged in as that account: instagram.com/accounts/manage_access/ → **Tester invites**. The
   Instagram phone app doesn't show tester invites.
4. **2. Generate access tokens**: the tester accounts now appear in the list. Click
   **Generate token** next to Lately's account; in the Meta login window choose **Continue with
   Instagram** and log in as Lately's account. The token is shown once: that is
   `INSTAGRAM_ACCESS_TOKEN`. It doesn't expire, so there is nothing to refresh. If it is
   revoked, saving keeps working (the webhook doesn't use it) but replies stop; the backend log
   shows `instagram reply not sent: HTTP 400 (code 190 ...)`.
5. Get the account id the token works on (the dashboard shows it next to the account too):
   ```
   curl -H "Authorization: Bearer <token>" "https://graph.facebook.com/v27.0/me/assigned_instagram_accounts"
   ```
   The `id` is `INSTAGRAM_ACCOUNT_ID`. A 200 here also proves the token works with the
   `Authorization: Bearer` header the backend sends.
6. App settings → Basic → **App secret** → Show (Meta asks for your Facebook password): that
   is `INSTAGRAM_APP_SECRET`. Under Unified login the Meta App secret signs the webhooks; there
   is no separate Instagram app secret.

### 3. Set the env and restart the backend

- Laptop backend: add the five values to `backend/.env` and restart `scripts/dev.py` (the
  `Lately Backend` launcher). Make sure the old one really stopped: an earlier window left
  open keeps holding port 1234 with the old settings, and the check below then still says 404.
- Fly.io: `fly secrets set INSTAGRAM_APP_SECRET=... INSTAGRAM_VERIFY_TOKEN=... INSTAGRAM_ACCESS_TOKEN=... INSTAGRAM_HANDLE=latelyinsta02 INSTAGRAM_ACCOUNT_ID=...`
- Render: dashboard → the service → Environment, add them, save (it redeploys).

Check it is on (prints `123`; a 404 means a setting is missing, a 403 a different token):

```
curl "https://<API host>/webhooks/instagram?hub.mode=subscribe&hub.verify_token=<verify token>&hub.challenge=123"
```

### 4. The webhook

1. Back in API setup with Unified login → **3. Configure webhooks**: callback URL
   `https://<API host>/webhooks/instagram`, verify token = `INSTAGRAM_VERIFY_TOKEN`,
   **Verify and save**. Meta calls the URL once; the backend must already be running with
   the settings from step 3.
2. Under Webhook fields, switch **`messages`** to Subscribed.
3. In **2. Generate access tokens**, switch **Webhook Subscription** on for Lately's account.
4. Subscribe the account itself through the API (Meta's Unified login docs require it; the
   switch above subscribes it to every field, this narrows it to `messages`). Expect
   `{"success":true}`:
   ```
   curl -X POST -H "Authorization: Bearer <token>" "https://graph.facebook.com/v27.0/<account id>/subscribed_apps?subscribed_fields=messages"
   ```

### 5. Test with an account that has a role on the app

Until Meta approves the app (step 6), only Instagram accounts with a role on the Meta app
can use it: your test account from step 2.3. Webhooks for their DMs do arrive while the app
is still in Development mode (seen on 2026-11-25). Then:

1. In the Lately app: Save from Instagram DMs → get a code.
2. From your personal Instagram account, DM the code to Lately's account. Reply:
   "Connected. Send me any reel and I'll save it to your Lately library."
3. Share a reel to Lately's account. Reply: "Saved to Lately. Your card will be ready in
   about 30 seconds." The save appears in the app.

If nothing happens, the uvicorn access log tells you why: no `POST /webhooks/instagram` line
means Meta isn't sending (step 1.2, 2.3, 4 or 5); `401` means the signature didn't match
(`INSTAGRAM_APP_SECRET` must be the Meta App secret from step 2.6). On the laptop, ngrok's
own request log at http://127.0.0.1:4040 lists every call Meta made, with the payloads.

### 6. Before the public can use it

The full pack (order, verification documents, permission answers, screencast script,
data-handling answers) is in `docs/meta-app-review.md`. In this dashboard, adding a
permission to App Review first requires becoming a Tech Provider, which can't be reversed.

1. App review: request **Advanced Access** for `instagram_basic` and
   `instagram_manage_messages` (a screencast of linking and saving a reel). These are the
   Unified login names; the `instagram_business_*` ones belong to Instagram login and don't apply.
2. Business verification of the Meta business portfolio that owns the app.
3. Switch the app to Live.
4. The DM door stores each linked user's Instagram-scoped id and the ids of handled
   messages for 7 days (never message text). Check the privacy policy and Play Data safety
   answers mention it.

## What a shared reel looks like

Seen on 2026-11-25 (Unified login): a reel shared into the chat arrives as one attachment of
type `ig_reel` whose payload has `reel_video_id`, `title` and `url`, and the `url` is the
public link (`https://www.instagram.com/reel/<code>/...`). So shared reels save as they are.
The backend takes a reel link from any field of any attachment, or from the message text. If
Meta ever changes this and it finds none, it replies "I couldn't get the reel's link from
that. In Instagram, tap Share on the reel, then Copy link, and send me the link." and logs
the attachment types and field names (never values):

```
instagram DM without a reel link; attachments: ig_reel[title,url]
```

That line is logged as a WARNING, so it shows in the API window (the `Lately Backend` launcher's
console) without any extra logging setup.

If you get the "Copy link" reply and that log line, shares stopped carrying the public link:
users can still paste links, and the payload's field names tell us what to build next.

## What users see

| When | Reply |
|---|---|
| Code accepted | Connected. Send me any reel and I'll save it to your Lately library. |
| Code unknown, used or expired | That code didn't work. Get a new one in the Lately app: Account and settings, then Save from Instagram DMs. |
| Not linked yet (at most once an hour) | To save reels here, connect your Lately account first: in the Lately app open Account and settings, then Save from Instagram DMs, and send me the code it shows. |
| Saved | Saved to Lately. Your card will be ready in about 30 seconds. |
| Already saved | That one is already in your Lately library. |
| Monthly free saves used | You've used this month's free saves. Lately Pro in the app gives you unlimited saves. |
| Hourly limit | That's a lot of saves at once. Try again in a little while. |
| A profile or story link | That link isn't a reel or post. |
| A text within 5 minutes of a save | Added your note. |
| An attachment without a reel link | I couldn't get the reel's link from that. In Instagram, tap Share on the reel, then Copy link, and send me the link. |
| Anything else | I couldn't find a reel in that message. In Instagram, tap Share on a reel and send it here. |

Users unlink in the app (`DELETE /me/instagram`); deleting the account removes the link too.
