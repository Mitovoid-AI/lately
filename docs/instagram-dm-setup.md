# Save from Instagram DMs: switching it on

Users save a reel without leaving Instagram: they tap **Share** on the reel and send it to
Lately's Instagram account. Lately saves it to their library and replies in the chat.

How the pieces fit:

1. In the app (Account → Connected accounts → Save from Instagram DMs) the user gets a
   one-time code, `LATELY-` plus 6 characters, valid 15 minutes (`POST /me/instagram/code`).
2. They DM the code to Lately's Instagram account. Meta sends the message to the backend
   (`POST /webhooks/instagram`), which links that Instagram account to their Lately account.
3. From then on every reel they send there goes through the same `save_reel()` as the app's
   share sheet, and counts against the same monthly quota and hourly limit. A text sent
   within 5 minutes of a save becomes that save's note.

Everything in the repo is built and tested. Until you finish this guide nothing changes:
without the settings the webhook answers 404, `GET /me/instagram` says the feature is off
and the app shows it as unavailable.

## What you need

- An Instagram **professional** account (Business or Creator) for Lately, e.g. `lately.app`.
- A Meta developer account (developers.facebook.com), logged in as someone who can manage
  that Instagram account.
- The backend reachable over `https://` (the laptop backend's ngrok address, or a cloud
  deploy, `docs/deploy.md`). Meta does not call `http://` or `localhost`.

## The names to copy exactly

| Setting (backend env) | Value | Where it comes from |
|---|---|---|
| `INSTAGRAM_APP_SECRET` | the Instagram app secret | Meta app → Instagram → API setup with Instagram login → Business login settings / app details |
| `INSTAGRAM_VERIFY_TOKEN` | any long random string you make up | you; typed again in Meta's webhook setup |
| `INSTAGRAM_ACCESS_TOKEN` | Lately's account token (long-lived) | Meta app → API setup with Instagram login → Generate token |
| `INSTAGRAM_HANDLE` | `lately.app` (no `@`) | the Instagram username; the app shows it to users |
| `INSTAGRAM_ACCOUNT_ID` | optional; Lately's Instagram account id | shown next to the account in the same page |
| Webhook callback URL | `https://<API host>/webhooks/instagram` | typed in Meta's webhook setup |
| Webhook field | `messages` | subscribed in Meta's webhook setup |

The feature is on only when the first four are all set. Make the verify token with:

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

### 2. The Meta app

1. developers.facebook.com → My Apps → Create app. Pick the use case for managing messaging
   and content on Instagram, so the app gets the **Instagram** product, then open
   Instagram → **API setup with Instagram login**.
2. Under "Generate access tokens", **Add account** and log in as Lately's Instagram account.
   The account appears with its id (that is `INSTAGRAM_ACCOUNT_ID`) and a **Generate token**
   button. Generate it: that is `INSTAGRAM_ACCESS_TOKEN`.
3. The token is long-lived: about **60 days**. Refresh it before then (any time after it is
   a day old) and put the new one in the env:
   ```
   curl "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<current token>"
   ```
   If it expires, saving keeps working (the webhook does not use it) but replies stop; the
   backend log shows `instagram reply not sent: HTTP 400 (code 190 ...)`.
4. Copy the **Instagram app secret** from the same page: that is `INSTAGRAM_APP_SECRET`.

### 3. Set the env and restart the backend

- Laptop backend: add the five values to `backend/.env` and restart `scripts/dev.py`.
- Fly.io: `fly secrets set INSTAGRAM_APP_SECRET=... INSTAGRAM_VERIFY_TOKEN=... INSTAGRAM_ACCESS_TOKEN=... INSTAGRAM_HANDLE=lately.app`
- Render: dashboard → the service → Environment, add them, save (it redeploys).

Check it is on (prints `123`; a 404 means a setting is missing, a 403 a different token):

```
curl "https://<API host>/webhooks/instagram?hub.mode=subscribe&hub.verify_token=<verify token>&hub.challenge=123"
```

### 4. The webhook

1. Back in API setup with Instagram login → **Configure webhooks**: callback URL
   `https://<API host>/webhooks/instagram`, verify token = `INSTAGRAM_VERIFY_TOKEN`,
   **Verify and save**. Meta calls the URL once; the backend must already be running with
   the settings from step 3.
2. Subscribe to the **`messages`** field.
3. Make sure the webhook subscription is switched on for Lately's account in the account
   list on the same page.

### 5. Test with an account that has a role on the app

Until Meta approves the app (step 6), only Instagram accounts with a role on the Meta app
can use it. Add your personal Instagram account as an Instagram tester (App roles → Roles)
and accept the invite in Instagram (Settings → Apps and websites → Tester invites; the
wording varies). Then:

1. In the Lately app: Save from Instagram DMs → get a code.
2. From your personal Instagram account, DM the code to Lately's account. Reply:
   "Connected. Send me any reel and I'll save it to your Lately library."
3. Share a reel to Lately's account. Reply: "Saved to Lately. Your card will be ready in
   about 30 seconds." The save appears in the app.

If nothing happens, the uvicorn access log tells you why: no `POST /webhooks/instagram` line
means Meta isn't sending (step 1.2, 4 or 5); `401` means the signature didn't match. If every
POST is 401 with the Instagram app secret, try the Meta app's App secret (App settings →
Basic) in `INSTAGRAM_APP_SECRET` instead: Meta's docs aren't explicit about which one signs
Instagram Login webhooks.

### 6. Before the public can use it

1. App review: request **Advanced Access** for `instagram_business_basic` and
   `instagram_business_manage_messages` (a screencast of linking and saving a reel).
2. Business verification of the Meta business portfolio that owns the app.
3. Switch the app to Live.
4. The DM door stores each linked user's Instagram-scoped id and the ids of handled
   messages for 7 days (never message text). Check the privacy policy and Play Data safety
   answers mention it.

## The one thing nobody knows yet: what a shared reel looks like

Meta's docs show every attachment with only a `url` and don't say whether a shared reel's
`url` is the public link (`instagram.com/reel/<code>/`) or a CDN media URL. The backend
takes a reel link from any field of any attachment, or from the message text. If it finds
none, it replies "I couldn't get the reel's link from that. In Instagram, tap Share on the
reel, then Copy link, and send me the link." and logs the attachment types and field names
(never values):

```
instagram DM without a reel link; attachments: ig_reel[title,url]
```

That line is logged as a WARNING, so it shows in the API window (the `Lately Backend` launcher's
console) without any extra logging setup.

Share a reel to Lately's account. If the reply is "Saved to Lately", shared reels work as
they are. If you get the "Copy link" reply and that log line, shares carry no public link:
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
