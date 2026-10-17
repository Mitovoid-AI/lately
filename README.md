# Lately

**Save it with a reason. Find it when you actually need it.**

## The problem

You doomscroll, see a reel worth keeping, and share it to a "watch later" account. Tomorrow never comes. A week later you have no idea which saved reel had the GitHub tip, which had the cafe, which had the recipe — it's just a wall of unlabeled thumbnails.

## What it does

Lately turns "save for later" into "find it in seconds."

1. **Save it** — share a reel and add a one-line reason ("job search tips", "cafe to try")
2. **Forget the details** — that's the point
3. **Search it** — type what you remember, in plain language, whenever you need it back

No folders to maintain. No scrolling through hundreds of saves. Just search.

## Repo layout

| Folder | What it is | Stack |
|---|---|---|
| `frontend/` | The app: Android (saves reels from Instagram's share sheet) and web. | Expo, React Native, expo-share-intent |
| `backend/` | API + worker: saves, the enrichment pipeline (fetch → transcribe → card → embed), search. | FastAPI, asyncpg, OpenRouter, Groq, OpenAI embeddings |
| `supabase/` | Database migrations `0001`–`0012`. | Postgres + pgvector + pg_trgm |

Design docs: `PIPELINE.md`, `BACKEND.md`, `SEARCH.md`, `INFRASTRUCTURE.md`.

Getting started (local):

```bash
# backend: copy backend/.env.example to backend/.env and fill it in
cd backend
.venv/Scripts/python.exe scripts/dev.py        # API on :8001 + worker
.venv/Scripts/python.exe scripts/e2e_live.py --urls scripts/e2e/reels.txt \
    --queries scripts/e2e/queries.tsv --external-worker   # real reels → cards → search

# app: copy frontend/.env.example to frontend/.env
cd frontend && npm install
npx expo start                                   # phone (same Wi-Fi) or press w for web
```

Phone setup, the share-sheet build and sign-in: `frontend/README.md`, `docs/auth-setup.md`.
Deploying: `docs/deploy.md`; launch steps: `docs/launch-checklist.md`.

## Status

🚧 **In active development / building in public.** This README is updated daily as features get built — check back often to see what shipped.

Follow along: [X @ashutoshroy02](https://x.com/ashutoshroy02) · [Instagram @atrexplains](https://instagram.com/atrexplains)

## Why

Existing "save" features on every platform are a black hole — content goes in, context doesn't. Lately keeps the *why* attached to the *what*, so future-you can actually retrieve it.

## Contributing

Not accepting PRs yet — still validating the idea. Ideas, feedback, and "this happens to me too" comments are welcome via [Issues](../../issues) or the socials above.

## License

TBD
