# antislop audit 001: follow-up and Delivery Gate (2026-10-22)

Findings: `anti-slop/audit-001-2026-10-22.md` (U = UI, C = copy, A = people and accessibility, L = mobile layout). Every HIGH and MEDIUM finding was fixed or is listed below with the reason it was not. Most LOW findings were fixed too.

Design Read: a save-and-find utility app for US 18-34 Instagram users, in a bright media-first Daylight language with marigold as the one accent, dial ENERGY 2 / RHYTHM 2 / MOTION 2.

## What changed

- **Sign-in:** the decorative reel mock with invented counts, handles and Instagram chrome is gone. It is replaced by Lately's own reel-to-card pair, labelled "Example". There is one screen with no sign-in/sign-up toggle and no template pills. The buttons are pinned to the bottom.
- **Copy:** nothing claims a speed that hasn't been measured ("about 30 s" is gone). Demo creators are `sample.*` handles. The demo "Back for you" feed now matches what the real backend sends. "Member since" uses a date that fits the product's age. Search no longer claims it finds creators.
- **Dead or misleading controls removed:** the photo-change badge, the "Coming soon" settings with fake checkboxes, the duplicate "Open in Maps" button and the stock photo behind the save sheet.
- **One vocabulary:**
  - A reel is the Instagram video, a save is your item, and a card is what Lately writes.
  - The progress steps are the same on Home, in the save sheet and on the card.
  - "Upgrade to Pro" and "Sign out" are used everywhere.
- **Marigold** is now only a fill for Save, primary buttons, selected state and the done check. Links are ink, and glyph tints are ink-2.
- **Accessibility:**
  - Skeletons are labelled progress bars.
  - Toasts and errors are announced.
  - Buttons keep their names while busy.
  - Backdrops are no longer the first TalkBack stop.
  - Fields are labelled, titles are headings, and icons are hidden from screen readers.
  - Text size is one adjustable control.
  - Non-text contrast passes: control outlines are 3.5:1 or better.
- **Layout:**
  - Buttons and chips grow with text size.
  - The confirm dialog scrolls and stacks its buttons.
  - Toasts show above sheets and dialogs.
  - Check-email scrolls above the keyboard.
  - The Home top is shorter: the live bar is gone (the pending tile carries the step), "Back for you" is tighter, and the filter chips only show with two or more categories.
  - Grids adapt to foldables and tablets.
  - The tab labels share one baseline.
  - The offline banner no longer covers the header.
  - The paywall's sticky area is just the price line and the button.

## Not done, and why

- **U31, the logo:** a founder decision. See `docs/play-store/brand-risk.md`.
- **U26, best match as a tile and a tile on the paywall:** optional identity polish, left for a later pass.
- **A30, pausing the rotating search hint on focus:** optional. The hint is not in the accessibility tree and stops under Reduce Motion.
- **A33, raising ReelCard's 1.3x text cap:** optional. It needs a tile-height check on a device.
- **L19 and L20, keyboard behaviour in Android sheets and the note editor:** fixed in code (`behavior="height"`, scroll into view, keyboard-aware cap), but not yet confirmed on a device.

## Delivery Gate

### Block 1: Hard Gate (all must be no)

| Item | Result | Evidence |
|---|---|---|
| R-02 em dash in UI text | PASS | grep of `frontend/src` (non-test): em dashes only in code comments and generated-file headers |
| R-03 mobile overflow or clipping | PASS | after-shots at 375x812 light and dark; buttons and pills use min-height; examples fit ("reading room cafe") |
| R-17 numbers without a source | PASS | invented counts removed (SignInScreen); "about 30 s" removed; "Save 37%" is computed from prices |
| R-18 fictional testimonials | PASS | none in the app |
| R-23 assets made without confirmation | PASS | no new logos or people; demo avatar and photos are existing assets; the logo is untouched (founder decision) |
| R-24 nav to nothing | PASS | the tabs Home, Search, Save and Stacks all have screens (click-through below) |
| R-25 contrast | PASS | tokens measured (text 4.5:1 or better, controls 3:1 or better); on-photo text is full white on the tile scrim |
| R-26 dead controls | PASS | the photo badge and Coming-soon checkboxes are removed; every control in the click-through acted |
| R-27 empty, loading, error | PASS | Account, StackPicker and the deduped save sheet gained loading and error states; skeletons are labelled |
| R-28 generic FAQ | PASS | no FAQ |
| R-32 keyboard and TalkBack | PASS (code) | roles, labels, states and headings added; backdrops removed from focus order. Not run with TalkBack on a device. |
| R-33 patch scripts | PASS | all changes are in source |
| R-34 both themes | PASS | 26 after-shots, light and dark; on-photo pills are theme-independent |
| R-35 run and click through | PASS | see below |
| R-36 fabricated claims | PASS | the creator-search claim is removed; the privacy and speed claims are accurate |
| R-37 direction | PASS | founder-approved Daylight direction; dials declared above |
| R-38 fabricated realistic content | PASS | demo handles are `sample.*`; demo curated matches the real backend; the Example is labelled |

**R-35 click-through:** `anti-slop/clickthrough-001.log` (web demo, 375x812, headless Chrome):

| Action | Result |
|---|---|
| Home search front door | opens `/search` |
| Example chip "reading room cafe" | shows results |
| Best match | opens `/reel/s-espresso` |
| Add to stack | sheet opens, then closes |
| Back | returns to `/search` |
| Stacks tab | opens `/stacks` |
| Stack "Food and coffee" | opens `/stack/st-cafes` |
| Back | returns to `/stacks` |
| Save tab | opens `/save-sheet`; Close returns to the tab |
| Back for you "See all" | opens `/curated`; Back returns to `/` |
| Avatar | opens `/account` |
| Upgrade to Pro | opens `/pro` |
| Monthly, then Subscribe (demo) | shows "You're on Pro" |
| Done | returns to `/account` |
| Card Directions | opens the maps URL |
| Tag `#momos` | opens `/search?q=momos` with 1 result |

The run produced no console or page errors. Automated: 647 of 647 jest tests, tsc and lint are clean, and the backend curated and saves-view tests pass (12).

### Block 2: Purpose-Gate (technique allowed, reason written)

| Item | Result | Reason |
|---|---|---|
| R-01 gradients and glow | PASS | The only gradient is the tile scrim, which keeps text on photos readable. The accent glow shadow is gone. |
| R-04 icons | PASS | No sparkle or AI icons. One glyph per meaning: albums means stack, bookmark is not used for stacks. Ionicons outline matches the app's line weight (reason in `Icon.tsx`). |
| R-06 typography | PASS | Bricolage Grotesque display gives the bold media-app voice; Inter is for reading. No all-caps tracked eyebrows remain. |
| R-07 background patterns | PASS | none |
| R-08 arrows | PASS | Only "open-in-new" on Open in Instagram, which signals that you are leaving the app. |
| R-09 badges | PASS | "Example" labels a sample (required by R-38). "Save 37%" states a computed fact. The category pills do wayfinding. |
| R-10 glass | PASS | none |
| R-12 shadows | PASS | About 5 elevated elements: hero media, sheets, dialogs and the paywall CTA area. |
| R-13 glow | PASS | Only the focus ring. |
| R-14 copy-paste cards | PASS | The paywall benefit rows are gone; facts are no longer repeated on the card. |
| R-19 motion | PASS | One rise-in, a press scale, and a one-time first-card check. The pulsing dot is gone. Every animation has a reduced-motion path. |
| R-22 illustrations | PASS | none; real reel photos only |

### Block 3: Liveliness (all must be yes)

| Item | Result | Note |
|---|---|---|
| Dials declared | YES | ENERGY 2 / RHYTHM 2 / MOTION 2 |
| Output matches the dials | YES | Bold display type and photo-led tiles (energy 2). Screens vary between grid, answer-first search, tracker and form (rhythm 2). Restrained, purposeful motion (motion 2). |
| One focal point per screen | YES | Home: the search door, then the tiles. Search: the best match. Card: the hero photo, then the title. Paywall: the selected plan and the CTA. |
| Structural whitespace | YES | 16 pt gutters, 12 pt grid gaps, 24 pt sections |
| One deliberate accent | YES | marigold, for saving, selection and primary actions |
| Identity motif | YES | Tall 3:4 tiles with the title on the photo, on Home, Back for you, Curated and stacks |
| Design Read declared | YES | above |

### Block 4: Craftsmanship and Quality Locks (all must be no)

| Item | Result |
|---|---|
| C-1 AI-default decisions | NO: each technique has a reason above |
| C-2 dead controls | NO |
| C-3 template sections | NO: the paywall filler rows and the duplicate live bar are removed |
| C-4 breaks in a state, theme, size or without a mouse | NO in code and screenshots. TalkBack and Android keyboard are still to be checked on a device. |
| C-5 fabricated claims | NO |
| R-05 template layout | NO |
| R-11 everything pill-shaped | NO: radius by role (12 tiles and controls, 16 cards and hero, pills only for chips) |
| R-15 generic CTAs | NO: "Upgrade to Pro", "Try 7 days free", "Continue with Google", "Directions" |
| R-16 buzzwords | NO |
| R-20 generic if logo swapped | NO: tall tiles with the title on the photo, marigold on white, Bricolage voice |
| R-21 forced dark | NO: Daylight is the default and Espresso is optional |
| R-29 palette | NO: ink and white plus marigold; category colours are small labels only |
| R-30 clone of a popular product | NO: mechanics borrowed, not looks |
| R-31 decision without a reason | NO |

**Gate result: PASS.** Device-only checks remain: TalkBack, the Android keyboard in sheets, and text size 2.0 on a phone. Run them on the next emulator or phone pass.
