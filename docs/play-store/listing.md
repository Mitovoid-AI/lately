# Google Play store listing (en-US)

Paste these into Play Console, under **Store presence**: **Main store listing** (app name,
short and full description, graphics) and **Store settings** (category, tags, contact
details). Every claim below was checked against the code on 2026-10-22; if a feature
changes, change the text.

Limits (Play Console Help, [Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)
and [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152)):
app name 30 characters, short description 80, full description 4,000, release notes 500 per
language ([Prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348)).
The [Metadata policy](https://support.google.com/googleplay/android-developer/answer/9898842)
bars price, promotion and ranking words in the app name, icon and developer name, and
unattributed testimonials anywhere.

## Character counts

Counted with a script (Python `len()`, Unicode code points, line breaks included) on the
blocks below, not estimated.

| Field | Characters | Limit |
|---|---|---|
| App name | 24 | 30 |
| Short description | 71 | 80 |
| Full description | 2,096 | 4,000 |
| Release notes 1.0.0 | 323 | 500 |

## App name

<!-- field:name -->
```text
Lately: Find Saved Reels
```

No "Instagram" in the name (see `brand-risk.md`). The same title is set in
`frontend/scripts/build-public-site.js` (`listingTitle`), because the account-deletion page
must name the app as the listing does. Change both together.

## Short description

<!-- field:short -->
```text
Share a reel to Lately, then find it later by typing what you remember.
```

## Full description

<!-- field:full -->
```text
Lately is for the reels you save and can never find again. Share a reel from Instagram to Lately, or paste its link, and Lately turns it into a card you can search. Later, type what you remember about it, and Lately finds it.

How it works
• Share a reel to Lately from Instagram's share menu, or paste a link.
• Add a short note on why you saved it, if you like.
• Lately reads the reel's public caption, audio and thumbnail and writes a card: a title, a summary, tips, places, tags and a category.
• Search by a word, a place, a name or what the reel was about. Search copes with typos and different spellings.

Keep things in order
• Group saves into stacks, like "Cafes to try" or "Weeknight dinners".
• Lately brings back recent saves, saves without a note yet, and older saves you may have forgotten.
• Places in a card open in your maps app.
• Pick your reading font, text size, and a light or dark theme.
• Reels you share while offline are saved when you're back online.

Free and Pro
• The free plan includes 20 saves a month.
• Lately Pro removes the monthly limit. Everything else works the same on both plans.
• In the US, Lately Pro is $3.99 a month or $29.99 a year (plus any sales tax). The yearly plan starts with a 7-day free trial if your Google account hasn't had Lately Pro before. Prices for other countries are shown in the app before you buy.
• Subscriptions renew automatically until you cancel them in Google Play.

Your data
• No ads, and no advertising or analytics trackers.
• Lately does not ask for access to your camera, microphone, photos, contacts or location.
• Download a copy of your saves, notes, cards and stacks as a JSON file.
• Delete your account and its data from the app at any time.

Good to know
• You need an account. Sign in with Google or with your email address.
• Cards are written automatically from a reel's public content and can be wrong or incomplete. Check important details, like addresses, prices and opening hours, at the source.
• Lately works with links to Instagram reels and posts.

Lately is not affiliated with Instagram or Meta.
```

What each line rests on:

| Claim | Where it is true |
|---|---|
| Share from Instagram, or paste a link | `frontend/app.json` (`expo-share-intent`, `text/plain`), save sheet paste field |
| Note on why you saved it, optional | `SaveSheetScreen.tsx` ("Why are you saving this? (optional)") |
| Card: title, summary, steps, places, tags, category | `backend/app/enrich/structure.py`, `frontend/legal/privacy.md` |
| Typos and spellings | `SEARCH.md` §2 (trigram leg), `backend/app/search/` |
| Stacks | `supabase/migrations/0006_app_features.sql`, `backend/app/routers/stacks.py` |
| Recent, no note yet, forgotten saves | `backend/app/routers/curated.py` |
| Places open in maps | `frontend/src/components/detail/PlaceCard.tsx` |
| Font, text size, theme | `preferences` table (0006), Account and settings |
| Offline queue | `frontend/src/lib/saveOutcome.ts` |
| 20 saves a month | `profiles.saves_free_limit` default 20 (0003); `docs/billing-setup.md` |
| Pro prices, trial, renewal | `docs/billing-setup.md` Part 4; `frontend/legal/terms.md` |
| No ads or trackers; no camera/mic/photos/contacts/location | `frontend/package.json` (no ads/analytics SDKs), `frontend/app.json` `blockedPermissions`, `privacy.md` |
| JSON export, in-app deletion | `backend/app/routers/me.py` |
| Instagram reels and posts | `save_reel()` accepts `instagram.com/(reel|reels|p|tv)/` links (0013) |

Notes on the text:

- The Pro price is the US price. Google converts it for other countries, so the description
  says other prices are shown in the app. If you change prices in Play Console, change this
  paragraph the same day. If you would rather keep prices out of the listing, delete the
  third "Free and Pro" bullet; the in-app paywall already shows the terms the
  [Subscriptions policy](https://support.google.com/googleplay/android-developer/answer/9900533) asks for.
- The free plan's limit can change (`frontend/legal/terms.md`, "Plans and limits"). Update
  "20 saves a month" if it does.
- No testimonials, ratings, rankings or "best/#1" words, per the Metadata policy.

## Release notes (version 1.0.0)

<!-- field:notes -->
```text
First release. Share a reel from Instagram, or paste a link, and Lately turns it into a card with a title, summary, tips, places and tags. Find it later by typing what you remember, group saves into stacks, and download or delete your data at any time. The free plan includes 20 saves a month; Lately Pro removes the limit.
```

## Category, tags and contact details

| Field | Value |
|---|---|
| App or game | App |
| Category | Productivity |
| Tags | Pick from Play Console's own tag list (Store settings → Tags → Manage tags). [CONFIRM] which tags exist: the list is only visible in the console. Look for ones about notes, bookmarks, organizing or search; skip social and video tags, since Lately does not play or share video. |
| Email address (required) | `[SUPPORT EMAIL]` |
| Phone number (optional) | leave empty |
| Website (recommended) | `[PUBLIC SITE URL]` (the `public-site/` home page, see `hosting.md`) |
| Privacy policy (App content → Privacy policy) | `[PUBLIC SITE URL]/privacy.html` |
| Account deletion URL (Data safety → Data deletion) | `[PUBLIC SITE URL]/delete-account.html` |

Use the URL your browser shows after opening each page once (Cloudflare Pages redirects
`/privacy.html` to `/privacy`; both work).

## Graphics

Specs from [Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151):

| Asset | Spec | Status |
|---|---|---|
| App icon | 512 × 512, 32-bit PNG with alpha, up to 1024 KB | `frontend/assets/brand/play-store-icon.png` is 512 × 512 and 52 KB but saved as 24-bit RGB (no alpha channel). [CONFIRM] re-export it with an alpha channel if Play Console refuses it. The design itself is a founder decision (`brand-risk.md`). |
| Feature graphic | 1024 × 500, JPEG or 24-bit PNG, no alpha | Not made yet. |
| Phone screenshots | 2 to 8, JPEG or 24-bit PNG, no alpha, 320 to 3840 px per side, long side at most twice the short side | Not made yet; they go in `docs/play-store/screenshots/`. For promotion eligibility Google recommends at least 4 portrait shots of at least 1080 × 1920 (9:16). |

Rules for the images (same page): show the real app, clean status bar (full battery and
signal, no notifications), no device frames, no Play badges, no "free", "best", "#1" or
"new" text, no third-party logos without permission. That last one rules out Instagram's
logo in screenshots and the feature graphic. Each image takes alt text of 140 characters or
less that does not start with "Image of" or "Photo of"; suggested:

1. Home: "Lately home screen with saved reels shown as cards and a search field"
2. Card: "A saved reel turned into a card with a summary, tips, places and tags"
3. Search: "Search results for a half-remembered phrase among saved reels"
4. Save: "Saving a shared reel with an optional note on why it was saved"
5. Stacks: "Saved reels grouped into stacks such as cafes to try"

Use demo data or your own saves for screenshots, not other people's reels you have no rights
to show prominently; a blurred or own-content thumbnail is safer.
