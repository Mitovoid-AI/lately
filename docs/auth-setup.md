# Sign-in setup (Supabase Auth)

Lately signs people in with **Supabase Auth**: Google, and email (a 6-digit code or a
magic link). Signing in for the first time *is* signing up — Supabase creates the
account, and migration `0005_auth_profiles.sql` writes the user's profile row
(`public.profiles`: name, handle, avatar, email, provider) the moment it exists. The
FastAPI backend verifies the Supabase access token on every request and serves the
profile at `GET /me`.

Project: `jsvgezmgvwnldcnrjdzg` → https://supabase.com/dashboard/project/jsvgezmgvwnldcnrjdzg

## 1. Redirect URLs (required for email links and Google)

Auth → URL Configuration → **Redirect URLs** → add:

```
exp://**
lately://**
http://localhost:8081/**
http://localhost:8082/**
http://localhost:8083/**
```

`exp://**` covers Expo Go on your phone (`exp://<pc-ip>:8081/--/auth-callback`, the IP
changes with your network). `lately://**` covers development and store builds. Without
these, Supabase falls back to the Site URL (`http://localhost:3000`), which a phone
can't open — that was the original "can't log in".

## 2. Email templates: put the 6-digit code in the email

Auth → Emails → Templates. Edit **Magic link** *and* **Confirm signup** (new users get
the second one) so the body contains `{{ .Token }}`, e.g.

```html
<h2>Your Lately code</h2>
<p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
<p>Or open this link on your phone: <a href="{{ .ConfirmationURL }}">Sign in to Lately</a></p>
```

## 3. Email sending limits

Supabase's built-in mailer sends **about 2 emails an hour** and only to members of your
Supabase organisation (this is why a second attempt failed with
`429 email rate limit exceeded`). For anyone else, add a custom SMTP sender
(Resend, Postmark, SES…) under Auth → Emails → SMTP Settings, then raise the email
limit under Auth → Rate Limits.

## 4. Google

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External; add
   yourself as a test user while the app is in testing.
2. Credentials → **Create OAuth client ID** → *Web application*.
   Authorized redirect URI:
   `https://jsvgezmgvwnldcnrjdzg.supabase.co/auth/v1/callback`
3. Supabase → Auth → Sign In / Providers → **Google** → enable, paste the client ID and
   secret, save.

The app checks whether Google is enabled before opening the browser; until step 3 is
done it says "Google sign-in isn't switched on yet."

## 5. Database

The dev project already carries every migration (0001–0012, checked 2026-10-17). For a new
project, apply `supabase/migrations/*.sql` in order (SQL Editor, or `supabase db push`);
0005 creates `public.profiles` rows for sign-ups and backfills existing users.

## Google sign-in: what was checked, and what to do when it fails

Checked from this repo on 2026-10-17: Google is enabled in Supabase Auth, the Google OAuth
client is valid, and the web app's "Continue with Google" lands on Google's sign-in page
with `redirect_uri = https://jsvgezmgvwnldcnrjdzg.supabase.co/auth/v1/callback`. What can't
be checked from outside is the Supabase **Redirect URLs** allow-list (§1): Supabase only
applies it after Google, at the callback.

| What you see | Cause | Fix |
|---|---|---|
| You pick a Google account, then a `localhost:3000` / "site can't be reached" page, or the window just closes | The app's redirect URL isn't on the allow-list, so Supabase sends you to the Site URL | Add `exp://**`, `lately://**` and `http://localhost:8083/**` under Auth → URL Configuration → Redirect URLs (§1) |
| Development build toast: "Didn't come back from Google? Add `exp://…` to …" | Same as above; the toast names the exact URL | Add that URL (or the `exp://**` pattern) |
| Google: "Error 400: redirect_uri_mismatch" | The Google OAuth client lacks Supabase's callback | Google Cloud → Credentials → the Web client → Authorized redirect URIs: `https://jsvgezmgvwnldcnrjdzg.supabase.co/auth/v1/callback` |
| Google: "Access blocked: … has not completed the Google verification process" | OAuth consent screen is in Testing and your account isn't a test user | OAuth consent screen → Test users → add your Google account (or publish the app) |
| "Google sign-in isn't switched on yet." | Google provider is off in Supabase | §4 step 3 |
| Signed in, but saves don't load on the phone | The phone can't reach the API | Run `python scripts/dev.py` in `backend/`; phone and PC on the same Wi-Fi; allow Python through Windows Firewall for private networks (port 8001) |

## Instagram

Not offered yet: Instagram's login API only accepts Business/Creator accounts and needs
a Meta app plus app review. The button stays "coming soon".
