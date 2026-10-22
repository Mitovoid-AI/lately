# Content rating (IARC questionnaire)

Play Console → **Policy and programs** → **App content** → **Content ratings** → **Start**.
Enter an email address IARC can write to, pick a category, answer the questions, check the
summary, **Submit** ([How to complete the content rating questionnaire](https://support.google.com/googleplay/android-developer/answer/188189)).
Every app needs a rating; wrong answers can get the app removed, and a new questionnaire is
due whenever content or features change ([Content ratings](https://support.google.com/googleplay/android-developer/answer/9898843)).

Google's help pages do not list the category names or the exact questions, so the wording
below may differ from the console. Answer each question from the facts in the table; where a
question is not covered, answer from the same facts and note it here.

## Facts about Lately that the answers rest on

| Fact | Source |
|---|---|
| A personal tool: you save reels you chose, and only you see your saves, notes, cards and stacks. | `backend/app/routers/*` scope every query to the signed-in user; `privacy.md` "Each account can only read its own..." |
| No feed of other people's content. The home screen and suggestions are built only from your own saves. | `backend/app/routers/curated.py` docstring |
| No chat, comments, profiles visible to others, following or sharing between users. | No such tables or routes in `supabase/migrations/` or `backend/app/routers/` |
| No location access, and nothing shares a location. Places in a card are text from the reel; tapping one opens a maps app. | `frontend/app.json` permissions; `PlaceCard.tsx` |
| Digital purchase: Lately Pro, a Google Play subscription. | `docs/billing-setup.md` |
| No ads. | `ads-declaration.md` |
| No in-app web browser. Reel links open in Instagram or the phone's browser; a browser tab opens only for Google sign-in. | `CardDetailScreen.tsx` (`Linking.openURL`), `AuthProvider.tsx` (`openAuthSessionAsync`) |
| No gambling, no simulated gambling, no loot boxes. | No such features |
| The app ships no violent, sexual, drug, crude or frightening content. Cards show text and a thumbnail derived from reels the user saved. | `backend/app/enrich/structure.py` |

## Suggested answers

| Topic (as it usually appears) | Answer | Note |
|---|---|---|
| Category | The utility or productivity category (the "other app types" choice, not Game, Social networking or Content aggregator). **[CONFIRM]** the exact label in the console. | Lately organizes the user's own saves. It does not let users share content, so a social or user-generated-content category does not fit. |
| Violence, blood, fear | No | |
| Sexuality, nudity | No | |
| Language (profanity) | No | |
| Controlled substances (drugs, alcohol, tobacco) | No | |
| Crude humor | No | |
| Gambling or simulated gambling | No | |
| Users can interact or exchange content with each other (chat, posting, sharing) | No | Saves are private to each account. |
| App shares the user's physical location with others | No | |
| Users can buy digital goods or subscriptions | Yes | Lately Pro on Google Play. |
| Unrestricted internet or web browsing | No | No in-app browser; links leave the app. |
| Age-restricted products or services | No | |

**[CONFIRM]** One judgment call: a card shows a thumbnail and text from whatever reel the user
saved, so a user who saves mature reels will see that in their own library. That is the
user's own content, not content Lately provides or shows to anyone else, which is why the
answers above are "No". If a reviewer reads it differently, the honest fallback is to keep
these answers and mention in the questionnaire (if it offers a comment) that all content is
user-chosen and private.
