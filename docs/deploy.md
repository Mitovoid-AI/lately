# Deploying Lately

Two pieces: the **backend** (one Docker image, `api` + `worker` processes on
Fly.io) and the **Android app** (an `.aab` uploaded to Play Console).
Founder-only prerequisites are in `docs/launch-checklist.md`.

## 1. Database (Supabase prod project)

```bash
# from the repo root, once per project
supabase link --project-ref <prod-ref>
supabase db push            # applies supabase/migrations/*.sql in order
```

**Deploy gate:** the backend needs **every** migration (0001 → latest) applied
before the API or worker starts: `/me` 500s without 0005, stacks/preferences
need 0006, exports need 0008, quotas/retries need 0010. Deploy the worker
together with (or before) the API so new job kinds always have a worker.
0005 deletes `profiles` rows with no matching `auth.users` row (e.g. the old
dev user `0000…0001`); that is intended. Keep `SUPABASE_JWT_AUDIENCE=authenticated`
in the secrets: without it the audience check is skipped.

Never run `backend/scripts/db_reset.py` or the test suite against prod: both
wipe tables. Tests use the disposable project's `lately_test_*` databases
(`backend/scripts/make_test_db.py`).

## 2a. Backend on Render (free, for testing)

`render.yaml` at the repo root describes one free Render web service (`lately-api`,
Singapore). Free Render has web services only, so `backend/scripts/render-start.sh` runs the
worker next to the API in the same container.

1. Sign in at render.com with GitHub (no card needed for the free plan) and give Render access
   to this repository.
2. **New** → **Blueprint** → pick the repository (branch `main`). Render reads `render.yaml`
   and asks for each secret: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `EMBEDDINGS_API_KEY`, `LLM_API_KEY`, `GROQ_API_KEY`. Copy the values from `backend/.env`.
3. **Apply**. The first build takes a few minutes. Then
   `curl https://<service>.onrender.com/healthz` answers `{"status":"ok"}`.
4. Put `https://<service>.onrender.com` in the GitHub repository variable
   `EXPO_PUBLIC_API_URL` (with `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), and the next test APK is built live.

Limits of the free plan: 0.1 CPU and 512 MB; it sleeps after 15 minutes without requests and
takes about a minute to wake (the app's offline queue retries a save made meanwhile); 750 free
hours a month per workspace. Pushes to `main` that change `backend/` redeploy it. For real
users, move to a paid instance or Fly.io below.

## 2. Backend on Fly.io

```bash
cd backend
fly launch --no-deploy --copy-config --name lately-api      # once; edit app name in fly.toml
fly secrets set \
  DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres' \
  SUPABASE_URL='https://<ref>.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='...' \
  SUPABASE_JWT_AUDIENCE='authenticated' \
  EMBEDDINGS_API_KEY='...' \
  LLM_API_KEY='...' LLM_MODEL='...' \
  GROQ_API_KEY='...' \
  ADMIN_KEY="$(openssl rand -hex 24)"
fly deploy
fly scale count api=1 worker=1
```

Every setting and its default is documented in `backend/.env.example`.

**Check it:**

```bash
curl https://lately-api.fly.dev/healthz
python scripts/debug.py --live --api https://lately-api.fly.dev     # all PASS
curl -H "X-Admin-Key: $ADMIN_KEY" https://lately-api.fly.dev/admin/health
```

Logs: `fly logs -p worker` (enrichment), `fly logs -p api`.

**Instagram from cloud IPs:** the worker's FETCH stage may be blocked from
Fly's IPs. Cards still finalize as `partial` (caption from the phone), and
users can retry. For full cards at scale set `SCRAPER_API_URL` +
`SCRAPER_API_KEY`, or run one worker on a residential connection:
`python -m app.worker` with the same secrets in `backend/.env`.

## 3. Android release build

```bash
cd frontend
# .env (git-ignored): live mode against the deployed API
#   EXPO_PUBLIC_API_MODE=live
#   EXPO_PUBLIC_API_URL=https://lately-api.fly.dev
#   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...

# Option A — EAS (free Expo account; Expo stores the signing key)
npx eas-cli login
npx eas-cli build -p android --profile production        # → .aab

# Option B — local Gradle (keystore stays on your machine; back it up)
npx expo prebuild -p android --clean
cd android && ./gradlew bundleRelease                     # → app/build/outputs/bundle/release/app-release.aab
```

Upload the `.aab` in Play Console → Testing → Closed testing first (see the
12-testers / 14-days rule in the launch checklist). Bump `versionCode` in
`frontend/app.json` for every upload.
