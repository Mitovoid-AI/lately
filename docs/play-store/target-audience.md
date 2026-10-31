# Target audience and content

Play Console → **Policy and programs** → **App content** → **Target audience and content** →
**Start** (or **Manage**). Age groups offered: 5 and under, 6-8, 9-12, 13-15, 16-17, 18 and
over ([Target audience and content](https://support.google.com/googleplay/android-developer/answer/9867159)).

## Recommendation: 18 and over only

Select **18 and over** and nothing else.

Why:

- **Families policy.** Any target audience that includes children must follow Google Play's
  Families requirements, and Google notes that 13-15 and 16-17 may count as children in some
  places (same page). Lately was not built or reviewed for those requirements.
- **The content is whatever reels the user saves.** Lately reads any public Instagram reel
  the user shares and shows its thumbnail and text back. There is no filtering by age or
  content type (`backend/app/enrich/`), so it should not be aimed at minors.
- **It sells a subscription.** Lately Pro is an auto-renewing Google Play subscription;
  targeting adults keeps the purchase flow simple.
- **Nothing in the app is designed for teens.** Choosing a younger group would invite
  questions the app has no answers for (parental consent, age checks).

Other answers in this section:

| Question | Answer |
|---|---|
| Does the store listing or app appeal to children? (if asked) | No. Plain productivity copy, no characters, games or child themes. |
| Ads | None (`ads-declaration.md`). |

## The terms say 13, the target says 18

`frontend/legal/terms.md` says "You must be at least 13 years old to use Lately", and
`privacy.md` says Lately is not meant for children under 13. Targeting 18+ in Play Console
does not contradict that (the target audience is who the app is designed for), but the two
read more cleanly if they match. **[CONFIRM]** whether to raise the minimum age in the terms
to 18 (proposed text below). If you keep 13, nothing in Play Console changes.

Proposed text, only if you choose 18 (not applied):

- `frontend/legal/terms.md`, "Your account": replace "You must be at least 13 years old to use
  Lately." with "You must be at least 18 years old to use Lately."
- `frontend/legal/privacy.md`, "Children": replace the paragraph with "Lately is meant for
  adults. It is not meant for anyone under 18, and we do not knowingly collect data from
  children under 13."

Then run `node scripts/build-legal.js` in `frontend/` (updates the app and `docs/site/`).
