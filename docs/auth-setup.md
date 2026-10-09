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

Apply `supabase/migrations/0005_auth_profiles.sql` (SQL Editor → paste → Run). It is
idempotent and backfills a profile for every existing user. Then restart the API
(port 8001) so `GET /me` is served.

## Instagram

Not offered yet: Instagram's login API only accepts Business/Creator accounts and needs
a Meta app plus app review. The button stays "coming soon".
