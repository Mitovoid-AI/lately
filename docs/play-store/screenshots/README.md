# Play Store images

| File | Size | Use |
|---|---|---|
| `01-home.png` ... `06-dark.png` | 1080 x 1920 | Phone screenshots, in this order |
| `feature-graphic.png` | 1024 x 500 | Feature graphic |

Play Console → Grow → Store presence → Main store listing → Graphics. The app icon (512 x 512) is `frontend/assets/brand/play-store-icon.png`; read `../brand-risk.md` before uploading it.

How they were made (2026-10-22): the web demo (`EXPO_PUBLIC_API_MODE=demo`) was captured in headless Chrome at 375 x 812 and 3x, then each capture was placed in a phone frame under a caption, set in the app's own fonts (Bricolage Grotesque, Inter) on the app's warm tint `#FCEFD9`. Everything shown is real app UI with the demo account's sample content (sample.* creators, labelled demo data), not a mockup.

Captions, in order:

1. Every reel you save, findable in one search
2. Type what you remember. Lately finds the reel.
3. Reels become cards with places, prices and tips
4. Share a reel to Lately and watch its card get written
5. Group saves into stacks for trips, food and workouts
6. A dark theme for late-night scrolling

Alt text for Play Console (140 characters or fewer each):

1. Lately's Home screen: a search bar, a row of saved reels to revisit, and a grid of saved reels.
2. Search results for "reading room cafe" with the best match on top and why it matched.
3. A saved reel's card with the place, price, a short summary and a Directions button.
4. A new save in progress: got the reel, listening to it, finding places and steps, card ready.
5. Stacks grouping saves into Food and coffee, Job hunt, Pacific Northwest trip and more.
6. Lately's Home screen in the dark theme.

To redo them after a UI change, capture the same six screens from the demo build at 1080 x 1920 or larger (9:16) and keep the captions honest: only features that ship, no prices or "free" in the image text.

## Regenerating

The scripts in `tools/` need Google Chrome and `puppeteer-core` (`npm install puppeteer-core` in any scratch folder, then run the scripts from there with `node`). With the demo running (`EXPO_PUBLIC_API_MODE=demo npx expo start --web --port 8082` in `frontend/`):

1. `node shots.mjs http://localhost:8082 raw light 375 812 3 home=/ "search=/search?q=reading%20room%20cafe" card=/reel/s-momo pending=/reel/s-pending stacks=/stacks`, then the same with `dark` for `home=/`.
2. `node compose.mjs compose.example.json` (edit the paths in it first).
3. `node clickthrough.mjs http://localhost:8082` taps through the main flows and prints what each tap did, which is the evidence the anti-slop gate asks for.

On Git Bash, prefix commands with `MSYS_NO_PATHCONV=1` so routes like `/pro` are not turned into Windows paths. The Chrome path is set at the top of each script.
