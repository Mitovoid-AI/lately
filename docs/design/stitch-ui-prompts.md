# Lately — UX flow + Google Stitch prompts

Purpose: generate the app UI in Google Stitch, then pull it into this repo through
the Stitch MCP server and wire it to the FastAPI backend.

Source of truth for behaviour: `PIPELINE.md` (catch → enrich), `SEARCH.md` §7
(result card + "why it matched"), `PLAN.md` (card states), `backend/app/routers/saves.py`
(the API that exists today).

---

## 1. The interaction, from the user's side

The product promise: **save it with a reason, find it when you need it.** Two moments
matter: the 3-second save inside Instagram, and the search weeks later.

```
Instagram ──Share──▶ Save sheet (over Instagram)        ← must feel instant
                      "Saved to Lately ✓"  + optional "why?" note
                      auto-closes, user is back in Instagram
                           │  (worker enriches in the background)
                           ▼
Lately app ─▶ Library: new card shows "Getting details…" → thumbnail + title fade in
             ├─ tap card ─▶ Card detail (open in Instagram, note, summary, steps, links)
             ├─ search ───▶ Search: "that momo cafe" → top results + why they matched
             └─ avatar ───▶ Account: plan, saves used this month, sign out
```

### Screens and states

| # | Screen | States to design | Backend |
|---|---|---|---|
| 01 | Sign in | default · magic-link sent | Supabase Auth (Google, email link) |
| 02 | Library (home) | first-run empty · populated (mixed card states) · category filter on | `GET /saves` |
| 03 | Save sheet (share target) | saved · already saved · no reel link · monthly limit · offline | `POST /saves`, `PATCH /saves/{id}` |
| 04 | Card detail | ready · processing · partial | `GET /saves/{id}` (new) |
| 05 | Search | focused + recent · results with "why" · no results | `GET /search` (Phase 1) |
| 06 | Paste link sheet | empty · link pasted | `POST /saves` |
| 07 | Account | free plan + usage · sign out | `GET /me` (new) |

### Card states (one card component, three states)

| `status` from API | What the user sees |
|---|---|
| `pending` | **Processing** — shimmer where the thumbnail goes, "Getting details…", the reel link, the note if any |
| `enriched` | **Ready** — thumbnail, title, note, category, date |
| `partial` | **Partial** — "Preview unavailable · Retry", first line of caption, note |

A save is never lost: even a failed fetch leaves a usable card (link + note).

### Error copy (maps 1:1 to API errors)

| API | Save sheet copy |
|---|---|
| `201` | **Saved to Lately** — "Your card will be ready in a few seconds." |
| `200` deduped | **Already in your Lately** — "Saved 3 days ago." [Open card] |
| `422 BAD_URL` | **No reel link found** — "Share the reel itself, not a profile or story." |
| `429 QUOTA_EXCEEDED` | **You've used all 20 free saves this month** — "Saves reset on 1 Nov." [See Pro] |
| `429 RATE_LIMITED` | **That's a lot of saves at once** — "Try again in a minute." |
| network down | **Saved on this phone** — "We'll sync it when you're back online." |

---

## 2. Design system (paste into Stitch → Design system, and keep as DESIGN.md)

```
LATELY — DESIGN SYSTEM
Register: product app (design serves the content). Thumbnails carry the colour; the
interface stays quiet and warm. Dark theme first, light theme second.

Colour (dark)
  background      #121110  warm near-black (never pure #000)
  surface         #1B1A18  sheets, inputs
  surface-raised  #25231F  pressed rows, chips
  border          #34312C  hairlines only
  text-primary    #F4F1EC
  text-secondary  #A8A29A
  text-tertiary   #6F6A63
  accent          #F5A524  marigold — primary buttons, active chip, focus ring, check icon
  on-accent       #1A1408
  success         #5DBB8A
  danger          #E5484D
Colour (light)
  background #FAF8F5 · surface #FFFEFB · text-primary #1C1A17 · text-secondary #6B655D
  accent #D98A0B (darker marigold for contrast on light)
Category colours (dots + chip outlines only, never large fills)
  Dev & Tools #8FA8D9 · Career & Jobs #B9A3E3 · Food & Places #E58F6F
  Fitness #7BC4A4 · Style & Vibes #E8A3C0 · Watch Later #A8A29A

Type
  Display / screen titles / card-detail title: Fraunces (serif), 600, 28/34 and 24/30
  Everything else: Inter. Body 15/22 400 · card title 15/20 600 · meta 13/18 400
  · label 12/16 600 uppercase tracking 0.04em. No other fonts.

Shape & space
  4-pt grid: 4 8 12 16 24 32 48. Screen side padding 16.
  Radius: thumbnails 14 · sheets 24 (top corners) · inputs 12 · buttons 12 · chips full pill.
  Touch targets ≥ 48 px. Hairline borders 1 px; no drop shadows on dark, soft shadow on light.

Components
  Reel card: thumbnail (4:5, radius 14) with text directly on the background below it —
  no card container. Title (2 lines max), note in italic secondary text with curly
  quotes, meta row = category dot + category name · relative date.
  Chips: pill, 32 px tall, surface-raised fill, accent fill + on-accent text when active.
  Primary button: accent fill, on-accent text, 48 px. Secondary: text-only accent.
  Bottom sheet: surface, 24 radius top, drag handle 36×4.
  Skeleton: surface → surface-raised shimmer, 1.2 s loop.

Motion (state changes only, 150–250 ms, ease-out)
  Save sheet slides up 250 ms · thumbnail fades in when a card becomes ready ·
  check icon draws in 200 ms. Respect reduced motion.

Never: Instagram's gradient, neon/cyan-purple gradients, glassmorphism, gradient text,
coloured left-border callouts, emoji as decoration (emoji only inside "why it matched").
```

---

## 3. Stitch prompts (paste in order, Mobile mode)

Tip: generate one prompt, review, then send the next. Ask for edits one change at a
time. Keep screen names exactly as written (`02 Library`, …) so the MCP can find them.

### Prompt 1 — kickoff: app + the three core screens

```
Design a mobile app called "Lately" (Android, 390×844). Tagline: "Save it with a reason.
Find it when you need it."

What it does: people see a useful Instagram reel (a GitHub tip, a cafe, a workout, a
trip plan), share it to Lately from Instagram's share sheet, optionally add a one-line
reason, and later search for it by whatever they remember ("that momo cafe", "repo for
job search"). The app turns each reel into a card: thumbnail, title, the user's note,
category, and later a summary, steps and links.

Audience: 18–30, in India, heavy Instagram users, often type in Hinglish. They are
mid-scroll and impatient: the save must take 3 seconds and get out of the way.

Visual direction: a calm, warm personal library — dark theme first. The reel thumbnails
provide all the colour; the interface is quiet. Warm near-black background #121110,
surfaces #1B1A18, primary text #F4F1EC, secondary text #A8A29A, one accent: marigold
#F5A524 (primary buttons, active chips, check marks). Headings in Fraunces (serif),
everything else in Inter. 4-pt spacing grid, 16 px side padding, thumbnails rounded 14 px,
pill chips, 48 px touch targets. No Instagram gradient, no neon, no glassmorphism,
no gradient text, no drop shadows on dark.

Create these 3 screens:

"02 Library" — the home screen. Top: wordmark "Lately" in Fraunces on the left, a round
avatar on the right. Below it a full-width search field with a search icon and the
placeholder "Search what you remember…". Then a horizontally scrolling row of category
chips: All (active), Dev & Tools, Food & Places, Career & Jobs, Fitness, Style & Vibes,
Watch Later — each non-All chip has a small coloured dot. Then a 2-column grid of reel
cards. Each card: a 4:5 thumbnail with 14 px corners, and below it (no card background)
a 2-line title in Inter 15 semibold, the user's note in italic secondary text with curly
quotes, and a meta row with a category dot, category name and relative date.
Sample cards:
 1. "5 GitHub search tricks to find great repos" · note "job search tips" · Dev & Tools · 2d
 2. "Hole-in-the-wall momo spot in Koramangala" · note "cafe to try" · Food & Places · 5d
 3. "Manali in 4 days on ₹12k" · note "trek in june" · Food & Places · 1w
 4. "Companies that sponsor visas — GitHub list" · note "repo for job search" · Career & Jobs · 2w
A floating action button bottom-right: marigold circle with a "+" (label "Paste link").

"03 Save sheet" — what appears over Instagram right after the user taps Share → Lately.
Show a dimmed, blurred reel playing behind. A bottom sheet (surface #1B1A18, 24 px top
corners, drag handle) containing: a marigold circle with a check mark and the title
"Saved to Lately", subtitle "Your card will be ready in a few seconds."; a small pill
showing the link "instagram.com/reel/C8xYz12"; a label "Why are you saving this?
(optional)"; a text field with placeholder "e.g. cafe to try in June"; quick chips
"To try", "To buy", "To visit", "To learn", "Watch later"; a full-width marigold button
"Save note" and a text button "Skip". Small tertiary text at the bottom: "Closes in 5 s".

"04 Card detail" — for card 2 (the momo spot), ready state. Top bar: back arrow, and an
overflow menu icon. Full-width 4:5 thumbnail with an "Open in Instagram ↗" button
overlaid bottom-left. Below: creator "@bangalorefoodie", title in Fraunces 24
"Hole-in-the-wall momo spot in Koramangala", a category chip "Food & Places" and
"Saved 5 days ago". A "Your note" block with the note "cafe to try" and an edit pencil.
A "Summary" paragraph (2–3 lines). A "Good to know" list: "Cash only", "Try the
jhol momo", "≈ ₹150 for two". A "Places" row with a map pin, "Momo Point, Koramangala
5th Block" and a text button "Open in Maps". Tag chips: momos, street food, budget.
A collapsed "Original caption" row with a chevron.
```

### Prompt 2 — Library: the three card states + first-run

```
On "02 Library", show the three states of the reel card in the grid, keeping everything
else the same:
- Put a new card first in the "Processing" state: the thumbnail area is a shimmering
  skeleton (#1B1A18 → #25231F) with a small reel icon and the text "Getting details…";
  the title line shows the link "instagram.com/reel/C8xYz12" in secondary text; the note
  "trek in june" still shows; meta row says "Just now".
- Make card 4 a "Partial" card: the thumbnail area is a flat #1B1A18 panel with
  "Preview unavailable" and a small marigold text button "Retry"; the title is the first
  line of the caption "Day 3 of the 30-day mobility challenge"; meta "Fitness · 1w".
- The rest are "Ready".

Then create "02b Library — empty", the first-run screen: same header and search field,
no chips. Centered: a short Fraunces headline "Your Lately is empty — for now", one line
"Save a reel from Instagram and it shows up here.", and a 3-step visual: (1) open a reel
in Instagram, (2) tap Share → Lately, (3) add a reason — optional. Below: a secondary
button "Paste a link instead".
```

### Prompt 3 — Save sheet variants

```
Create four variants of "03 Save sheet", identical layout, different message:
"03b Already saved" — neutral info icon in a #25231F circle, title "Already in your
Lately", subtitle "Saved 3 days ago.", the existing note shown read-only, primary button
"Open card", text button "Close". No note field.
"03c No reel link" — warning icon in danger red #E5484D, title "No reel link found",
subtitle "Share the reel itself, not a profile or story.", one button "Close".
"03d Monthly limit" — title "You've used all 20 free saves this month", a progress bar
full at 20/20 in marigold, subtitle "Saves reset on 1 Nov. Pro has no limit.", primary
button "See Pro", text button "Not now".
"03e Offline" — cloud-off icon, title "Saved on this phone", subtitle "We'll sync it when
you're back online.", note field still available.
```

### Prompt 4 — Card detail: processing and partial

```
Create "04b Card detail — processing" for a card that was saved seconds ago: the hero
area is a skeleton with a reel icon; under it the link "instagram.com/reel/C8xYz12" and
"Open in Instagram ↗"; the "Your note" block with "trek in june"; and a 3-step vertical
progress tracker: "Saved" (done, marigold check), "Getting the preview" (in progress,
small spinner), "Writing the summary" (pending, tertiary). Everything else hidden.

Create "04c Card detail — partial": hero is a flat panel "Preview unavailable" with a
marigold "Retry" button; show the original caption text in full; the "Your note" block
with an "Add a note" prompt and the hint "A note makes this easy to find later."
```

### Prompt 5 — Search

```
Create "05 Search" with the keyboard open: the search field focused at the top with a
back arrow; under it "Recent" with 3 rows (clock icon): "momo", "github job repo",
"manali"; then "Try" with chips: "that cafe reel", "workout for back pain",
"repo for job search".

Create "05b Search results" for the query "momo cafe": a vertical list (not a grid).
Each row: a 64×80 thumbnail (radius 10), the title (2 lines), a row of small "why it
matched" chips in #25231F with secondary text — e.g. "📍 Koramangala", "your note: “cafe
to try”", "caption: momos" — and the date on the right. 4 results; the first is the
momo spot. Header line above the list: "4 reels".

Create "05c No results" for "trek shoes": Fraunces line "Nothing for “trek shoes” yet",
helper text "Try a word from your note, a place, or the creator's name.", and the "Try"
chips again.
```

### Prompt 6 — Sign in

```
Create "01 Sign in": the "Lately" wordmark large in Fraunces, the tagline "Save it with a
reason. Find it when you need it.", behind them a loose, slightly tilted stack of three
4:5 reel thumbnails (a cafe, a laptop with code, a mountain trail) dimmed to 40%.
Buttons at the bottom: "Continue with Google" (marigold, with Google logo) and
"Continue with email" (outlined #34312C). Tiny tertiary text: "By continuing you agree to
the Terms and Privacy Policy."

Create "01b Check your email": envelope icon, Fraunces title "Check your inbox", body
"We sent a sign-in link to riya@gmail.com. Open it on this phone.", text buttons
"Resend link" and "Use a different email".
```

### Prompt 7 — Account

```
Create "07 Account": back arrow and title "Account". A row with avatar, "Riya Sharma",
"riya@gmail.com". A plan block: label "FREE PLAN", "12 of 20 saves used this month", a
marigold progress bar at 60%, "Resets on 1 Nov". A row "Lately Pro — unlimited saves and
smarter search · ₹299/month" with a chevron. Then plain rows: "Privacy", "Help",
"Sign out" (danger red text). No cards inside cards.
```

### Prompt 8 — light theme

```
Create light-theme versions of "02 Library", "03 Save sheet" and "04 Card detail" using:
background #FAF8F5, surfaces #FFFEFB, primary text #1C1A17, secondary #6B655D, accent
#D98A0B, borders #E7E1D8, soft shadows allowed on sheets. Keep the layout identical.
Name them with the suffix " — light".
```

---

## 4. Wiring the screens to the backend (after Stitch)

| Screen / element | Endpoint | Exists today? |
|---|---|---|
| Save sheet | `POST /saves {text, channel:"app_share"}` → `201 {reel_id, deduped, status}`; `200` when deduped; errors `{error:{code,message}}` | ✅ |
| "Save note" | `PATCH /saves/{id} {note}` | ✅ |
| Library grid | `GET /saves?limit=25&before=<created_at>` (keyset) | ✅ (needs `thumbnail_url`, `title`, `caption`, `category` added) |
| Card detail | `GET /saves/{id}` | ❌ new |
| Retry (partial) | `POST /saves/{id}/retry` (re-enqueue from FETCH) | ❌ new |
| Delete + undo toast | `DELETE /saves/{id}` | ❌ new |
| Search | `GET /search?q=` → cards + `why[]` (SEARCH.md §7) | ❌ Phase 1 |
| Account usage | `GET /me` → plan, saves used, reset date | ❌ new |
| Sign in | Supabase Auth (Google + magic link); the access token goes in `Authorization: Bearer` | ✅ backend verifies; ❌ no client yet |

Card component state = `status` field: `pending` → Processing, `enriched` → Ready,
`partial` → Partial. While any card is `pending`, the Library refreshes `GET /saves`
every few seconds (or subscribes to Supabase Realtime later).

### Connecting Stitch to this repo (later)

1. In Stitch, create an API key (Settings → API key).
2. Add the server to the project's MCP config (`.mcp.json` is git-ignored; never commit the key):

   ```json
   {
     "mcpServers": {
       "stitch": {
         "type": "http",
         "url": "https://stitch.googleapis.com/mcp",
         "headers": { "X-Goog-Api-Key": "<your Stitch API key>" }
       }
     }
   }
   ```

3. Restart Claude Code, then ask: "Pull `02 Library` and `03 Save sheet` from the Lately
   Stitch project and implement them against the backend."

Stitch exports HTML + Tailwind. The share-sheet door needs a native Android app
(Expo + `expo-share-intent`, per `PLAN.md`), so the screens get ported to React Native
(NativeWind keeps the Tailwind class names). That is the Phase 3 decision still open in
the roadmap: restore `app/` from git or start fresh.
