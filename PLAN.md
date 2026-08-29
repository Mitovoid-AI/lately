# Reel2List — Build Plan

**One-line pitch:** Share a reel to Reel2List and it comes back as a searchable, categorised card with the actual steps extracted — so "I'll watch it later" finally means something.

**Owner:** ashu2 · **Started:** 2026-08-29 · **Target:** first paying user within 12 weeks

---

## 0. The decision that shapes everything

I checked the two obvious ingestion paths before planning around them, and both have problems you need to know about now rather than in week 6.

**Instagram DM to a shared bot account does not work the way you're imagining.** Meta's Messaging API does fire a webhook when someone DMs a Professional account, but when the message is a shared reel, the payload gives you an opaque `asset_id` on a `lookaside.fbsbx.com` URL or an `instagram.com/share/XXXX` shortlink — developers report `media_id` and `attachments` coming back empty. You do not get a clean permalink. On top of that you need Advanced Access via Meta App Review before it works for anyone outside your own app roles. It is not a day-one path. It might work in phase 6 by resolving the shortlink redirect, but treat it as research, not roadmap.

**Server-side reel fetching is actively blocked.** `yt-dlp` against Instagram now routinely returns "rate-limit reached or login required" and needs `--cookies`. Datacenter and VPS IPs get blocked, which means any free Cloud Run / Fly / Render worker you build will fail within days. Paid residential proxies fix it and cost more than your entire budget.

**So the architecture is: fetch on the phone, think in the cloud.** Your Android device has a residential IP and your own Instagram session. The app does the fetching locally; the backend only ever receives text and a small audio file. This is cheaper, it does not get IP-blocked, and legally it is you archiving content you chose to save rather than a server farm scraping Meta — a meaningfully better posture, though still against Meta's ToS, which you should read section 4 about before you charge anyone.

---

## 1. Stack

Chosen for near-zero cost and the fewest moving parts, given you're vibe-coding this.

| Layer | Choice | Why | Cost |
|---|---|---|---|
| App | React Native + **Expo** (dev client, not Expo Go) | One language end-to-end; `expo-share-intent` handles the Android share sheet | Free |
| Share sheet | `expo-share-intent` config plugin | Registers `ACTION_SEND` for text/URLs. Needs a dev client build, hence not Expo Go | Free |
| Backend + DB + auth | **Supabase** | Postgres, auth, storage, Edge Functions in one free project | Free |
| Transcription | **Groq** `whisper-large-v3-turbo` | ~30 req/min free, 25 MB file cap free tier. Reels are 1–5 MB of audio | Free |
| Structuring | **Gemini Flash** (`gemini-3.7-flash`) | Free AI Studio tier. Note: Gemini 2.5 sunsets Oct 2026 — do not build on it | Free |
| Search | Postgres full-text (`tsvector`) in v1, `pgvector` in v2 | FTS is one column and one index. Semantic search is a phase-2 upgrade | Free |
| Distribution | Google **limited-distribution** dev account | New 2026 tier: free, no $25, no government ID, up to 20 authorised devices | Free |
| Domain | `.app` or `.in` on Cloudflare | For the landing page and waitlist | ~$10/yr |

Total: roughly $1/month for the first three months.

Two things to keep off the critical path: do not build a custom auth system (Supabase magic links), and do not build a job queue (a `status` column plus a polling Edge Function is enough until you have hundreds of users).

---

## 2. The one UX rule that makes or breaks this

**Capture must never fail.** The instant you tap share, the link is written to the database with `status: 'pending'` and the app confirms it visually. Enrichment — transcript, summary, category — happens afterwards and is allowed to fail, retry, or degrade to caption-only. If enrichment failure ever loses a save, you have rebuilt the exact problem you're trying to solve, just with more steps.

Every card therefore has three possible states: `pending` (saved, not yet processed), `enriched` (full summary and steps), and `partial` (link and caption only, fetch failed — with a "retry" button and a free-text note field).

---

## 3. Data model

Four tables. Resist adding more until something actually hurts.

```sql
-- reels: the core object
id, user_id, source_url, shortcode, status,
caption, transcript, title, summary, steps (jsonb),
category, tags (text[]), entities (jsonb),
thumbnail_path, search_vector (tsvector generated),
created_at, enriched_at, failure_reason

-- categories: user-editable, seeded with defaults
id, user_id, name, emoji, sort_order

-- notes: your own thoughts, kept separate from AI output
id, reel_id, body, created_at

-- profiles: plan, save quota, counters
id, plan, saves_this_month, quota_reset_at
```

`entities` is where the real value hides and it should be typed per category. A GitHub reel yields `{repo_urls: [], tools: []}`. A cafe reel yields `{place_names: [], city, maps_query}`. A recipe yields `{ingredients: [], cook_time}`. Generic summaries are a commodity; category-specific extraction is the product.

Seed categories from your own actual behaviour, which you described: Dev & Tools, Career & Jobs, Food & Places, Fitness, Style & Vibes, Watch Later.

Enable Row Level Security on every table from the first migration. Retrofitting RLS after you have users is miserable, and without it any authenticated user can read everyone's saves.

---

## 4. Risks, stated plainly

**Meta's ToS.** Automated collection without permission violates Meta's terms, and oEmbed data is licensed for front-end display only. Two 2026 rulings — *Meta v. Bright Data* and the Ninth Circuit's *Amazon v. Perplexity* (Aug 4, 2026) — establish that scraping public pages while logged **off** isn't a CFAA violation, but both expressly leave contract, copyright, and privacy claims intact. Using your own session cookies makes it logged-in access, which is precisely what those rulings do *not* shield.

What this means concretely: as a personal tool, your risk is account action, not a lawsuit. As a paid product, you have real exposure the moment you store and redistribute Meta's media. Mitigations that cost you nothing and matter a lot: never re-host video (store only a thumbnail plus the permalink, always link back to Instagram), keep transcripts and summaries as derived text rather than copies, do the fetch client-side so it's the user's own session and their own device, and write a ToS that says the user is responsible for content they submit. If this reaches real revenue, spend an hour with a lawyer before scaling. I'm not one.

**Instagram's HTML changes without notice.** Your on-device parser will break, probably more than once. Version the parser, ship it as remote config from Supabase rather than hardcoded in the app binary, and always fall back to caption-only rather than erroring out.

**Free tiers move.** Gemini's Pro models went paid-only around April 2026 and 2.5 sunsets in October 2026. Put every model name in one config file so a migration is a one-line change.

**You are the biggest risk.** The failure mode for a build-in-public solo project is not technical, it's a three-week gap in shipping that kills the audience momentum. Phase gates below are deliberately small for this reason.

**Numbers to re-verify before you rely on them.** These were checked on 2026-08-29 from search results and secondary sources, not from the canonical policy pages, which were unreachable from my environment. Confirm the 12-tester/14-day threshold at [Google's testing requirements page](https://support.google.com/googleplay/android-developer/answer/6112435), the current free-tier request limits at [ai.google.dev rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) and [Groq's rate limits](https://console.groq.com/docs/rate-limits), and the limited-distribution device cap at [developer.android.com](https://developer.android.com/developer-verification/guides/limited-distribution). The architectural conclusions in section 0 don't depend on the exact numbers; the phase-4 timeline does.

---

## Phase 0 — Prove the output is worth building (this weekend, 4 hours)

Do not write app code yet. Open a spreadsheet, go to the account you've been forwarding reels to, and take the last 25 reels you sent yourself. For each one, write by hand what you *wish* the app had given you: the category, a two-line summary, and the steps or the one piece of information you actually wanted back.

This is the highest-value four hours in the whole plan, for two reasons. It tells you the real category list rather than a guessed one, and it becomes your prompt-engineering ground truth — the 25-row file you test every prompt change against. Save it as `data/golden-set.csv`.

**Gate:** you can look at your 25 hand-written cards and say "yes, if the app gave me this, I'd use it every day." If some categories feel useless, cut them.

---

## Phase 1 — The ugly loop that works (week 1–2)

One user: you. No auth screen, no design, no folders. The entire goal is that sharing a reel produces a row you can read back.

1. `npx create-expo-app`, add `expo-share-intent`, build a dev client with `eas build --profile development --platform android`. Confirm Reel2List appears in Instagram's share sheet and logs the URL. Do not proceed until this works — everything downstream depends on it.
2. Supabase project, `reels` table, hardcode a single user id.
3. On share: insert the row as `pending` and show a toast. Ship this much and use it for two days before adding AI. You will already feel relief.
4. On-device fetch: pull the reel's public page, extract caption, thumbnail, and video URL from the embedded JSON. Wrap it in try/catch that degrades to `partial`.
5. Send audio to Groq Whisper, then caption plus transcript to Gemini Flash with a strict JSON schema. Validate the response with Zod; retry once on malformed JSON.
6. A flat list screen and a search box over `search_vector`.

**Gate:** you personally save 20 real reels through the app across a week and can find one from memory in under ten seconds. Delete the old Instagram forwarding habit.

---

## Phase 2 — Make it actually good (week 3–4)

This is where it stops being a demo. Category-specific entity extraction per section 3, so a GitHub reel surfaces a tappable repo link and a cafe reel surfaces a Maps button. Folder view with counts. A retry action on failed cards. Your own notes on a card. Share a card back out as an image — this one is a growth feature disguised as a UX feature, because every shared card is an ad.

Run every prompt change against `golden-set.csv` and eyeball the diff. Prompt quality *is* the product here, and it's worth more of your time in these two weeks than any UI work.

Register the free limited-distribution developer account now and get the app onto your own device as a signed build. Also register a full-distribution account and start its verification, because that has a lead time and you'll need it in phase 4.

**Gate:** 50 reels saved, and correct auto-categorisation on at least 4 out of 5 without editing.

---

## Phase 3 — Ten strangers (week 5–6)

Add Supabase magic-link auth and RLS-scoped queries. Then add a **Telegram bot as a second inbox**, which is the cheapest way to onboard people who can't install your APK: they forward an Instagram link to `@Reel2ListBot`, it replies with the structured card and links their Telegram id to their account. No app store, no review, works on iPhone. Fetching still can't happen server-side, so for Telegram-only users start with caption-plus-shortlink enrichment and be upfront that transcripts need the Android app.

Recruit ten people from your own DMs — not strangers on the internet yet. Watch someone use it without helping them. Build a landing page with a waitlist.

**Gate:** ten people have saved at least one reel, three have come back a second week, and you've watched at least three of them use it.

---

## Phase 4 — The Play Store clock (week 7–9)

Start this the day phase 3 ends, because it is a waiting game and you cannot compress it. A new personal developer account must run a **closed test with at least 12 opted-in testers for 14 continuous days** before it can apply for production access. Twelve is the current floor, down from twenty in Dec 2024. Recruit fourteen for headroom, because people uninstall.

While that clock runs, build the paywall. Free tier: 20 saves per month, all features. Pro: unlimited plus semantic search. Price at $4/month or ₹299/month, with a **$29 lifetime deal for the first 50 users** — a lifetime deal is the single easiest way to convert an early build-in-public audience, it funds a year of infrastructure, and 50 is small enough that it won't haunt you. Use RevenueCat's free tier rather than wiring Play Billing yourself.

Separately, if you have testers in Brazil, Indonesia, Singapore, or Thailand, note that Android developer verification starts enforcing on Sept 30, 2026 in those four countries and applies to sideloaded APKs too. Your free limited-distribution account covers up to 20 authorised devices, which is enough for beta.

**Gate:** production access granted, payments working end to end with a real card, and you've successfully refunded a test purchase.

---

## Phase 5 — Launch and first revenue (week 10–12)

Product Hunt, with the launch mechanics in `MARKETING.md`. Do not launch before payments work and 50 people are using it, because a Product Hunt launch is a one-time asset and spending it on a broken funnel is the most common self-inflicted wound in indie software.

**Gate:** one stranger has paid you money. That's the milestone. Everything after it is a different kind of problem.

---

## Phase 6 — Only after revenue

The Instagram DM ingestion you originally imagined, attempted by resolving `instagram.com/share/XXXX` redirects to permalinks — genuinely uncertain whether this holds up, so treat it as a spike with a two-day timebox, not a commitment. iOS via a Share Extension, which needs a Mac and $99/year and is only worth it once people are asking. Semantic search with pgvector. A weekly "here's what you saved and never acted on" digest, which is the retention feature that turns this from a filing cabinet into a habit. And the thing your idea is quietly pointing at: shared collections, where a curated folder of 30 dev reels becomes something other people want.

---

## What to do in the next hour

Make `data/golden-set.csv` and fill in five rows from reels you actually forwarded to yourself. Then post the problem statement thread from `MARKETING.md` — you described the doomscroll-and-lose-it pain vividly in your own words, and that description is your best marketing asset. Ship the words before the code.

