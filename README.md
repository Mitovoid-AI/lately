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

Two independent projects, each with its own `package.json` and install step:

| Folder | What it is | Stack |
|---|---|---|
| `website/` | Web app + Telegram bot. Save a link, browse and search your cards in a browser. | Next.js 15, React 19, Supabase |
| `app/` | Android app. Saves reels straight from Instagram's share sheet. | React Native, Expo, expo-share-intent |
| `supabase/` | Shared database — migrations and seed data. Both projects point at the same Postgres. | Postgres |

Getting started:

```bash
# website + Telegram bot
cd website && npm install
cp .env.example .env.local   # fill in your keys
npm run verify               # checks DB, tables, bot token, search
npm run dev

# Android app
cd app && npm install
cp .env.example .env
npm start
```

Run the migrations in `supabase/migrations/` in order (`0001`, then `0002`) from
the Supabase SQL editor before either project will work.

## Status

🚧 **In active development / building in public.** This README is updated daily as features get built — check back often to see what shipped.

Follow along: [X @ashutoshroy02](https://x.com/ashutoshroy02) · [Instagram @atrexplains](https://instagram.com/atrexplains)

## Why

Existing "save" features on every platform are a black hole — content goes in, context doesn't. Lately keeps the *why* attached to the *what*, so future-you can actually retrieve it.

## Contributing

Not accepting PRs yet — still validating the idea. Ideas, feedback, and "this happens to me too" comments are welcome via [Issues](../../issues) or the socials above.

## License

TBD
