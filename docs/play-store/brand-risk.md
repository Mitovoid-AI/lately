# Brand risk: the launcher icon and Instagram

Decision for the founder. Nothing has been changed; the icon stays as it is until you choose.

## What the icon is today

- `frontend/assets/brand/play-store-icon.png` (512 × 512) and the adaptive icon layers
  (`adaptive-foreground.png`, `adaptive-background.png`) show a white egg with an orange-pink
  yolk on a diagonal blue-purple-pink-red-orange gradient. The adaptive icon's
  `backgroundColor` in `frontend/app.json` is `#C13584`.
- They are rendered by `frontend/scripts/render-icons.js` from
  `docs/design/stitch/logo-insta.svg`. The gradient in that script is named `ig` and uses ten
  colour stops, `#405de6` through `#ffdc80`. That is the set of hex values widely published as
  Instagram's gradient colours, and `#C13584` is one of them. The file names show the
  gradient was chosen to look like Instagram's.
- The egg is not Instagram's camera glyph, and the app does not show Instagram's logo
  anywhere. Inside the app, Instagram is named only in plain text ("Open in Instagram").

## What Google Play's policies say

- **Impersonation** ([policy](https://support.google.com/googleplay/android-developer/answer/9888374)):
  "We don't allow apps that mislead users by impersonating someone else." Icons, titles,
  descriptions and in-app elements must not suggest a relationship with a company the
  developer is not connected to. The listed violations include copying a business's logo to
  look like its official app, and branding so close to an existing product that users may be
  confused. The policy names no disclaimer exception.
- **Intellectual property** ([policy](https://support.google.com/googleplay/android-developer/answer/9888072)):
  trademark infringement is the unauthorized use of an identical or similar mark that is
  likely to cause confusion about where a product comes from; such apps may be suspended. Do
  not use third-party brand names or logos without permission or in a confusing way.
  Trademark owners can file complaints with Google.
- **Store graphics** ([preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)):
  no third-party trademarks or characters without permission in the icon, feature graphic or
  screenshots.

## The risk

The icon alone copies no logo. The concern is the combination: Instagram's signature
gradient, an app whose whole purpose is Instagram reels, and a listing that names Instagram.
Together that can read as "an Instagram app". Possible outcomes, from most to least likely:

1. A Play reviewer flags the icon under Impersonation at first review, and the release is
   rejected until the icon changes. Cost: a few days.
2. The app is approved, and later Meta files a trademark complaint, or a reviewer re-checks
   it. Cost: removal or a forced update, after users already know the icon.
3. Nothing happens.

Changing the icon is cheapest now: there are no users, no store listing graphics yet, and
the icon pipeline is one script.

The name and description already avoid the main problems: no "Instagram" in the app name,
"Lately is not affiliated with Instagram or Meta." at the end of the description and on
every public page, Instagram named only to say what the app works with. "Reels" in the name
is a common word for short videos and is used descriptively; the risk there is low.

## Option 1: keep the current icon

- Keep the disclaimer in the full description and on the public pages (already there).
- Keep Instagram's name, logo and glyph out of the icon, title, feature graphic and
  screenshots (`listing.md`, Graphics).
- Prepare option 2 anyway, so a rejection costs a rebuild, not a redesign.

## Option 2: a marigold "Daylight" icon

Use the app's own colours instead of Instagram's: the Daylight theme's marigold accent
`#E39A1E` with near-black `#1A1208` (`frontend/src/theme/tokens.js`), for example the same
white egg on a flat marigold background, with the yolk in a darker marigold such as
`#CC8612` (the theme's pressed accent) so it still reads at small sizes.
`docs/design/stitch/logo-icon.svg` is an older orange egg mark that could be a starting point.

What changes, if you choose it (a short task for the team, then a new build):

1. `frontend/scripts/render-icons.js`: replace the `ig` gradient and the yolk gradient with the
   marigold colours, re-run it (instructions at the top of the script) to regenerate
   `icon.png`, `play-store-icon.png`, the adaptive layers and the splash image.
2. `frontend/app.json`: set `android.adaptiveIcon.backgroundColor` to the new background colour.
3. Save the Play icon as a 32-bit PNG with alpha (Play's spec; today's file is 24-bit).
4. Rebuild and check the icon on a phone with light and dark wallpapers, and as a themed
   (monochrome) icon.

## Related, not about the icon

`docs/launch-checklist.md` §7 already notes that reading Instagram pages automatically may
conflict with Meta's terms. Google Play's
[Device and Network Abuse policy](https://support.google.com/googleplay/android-developer/answer/9888379)
also bars apps from accessing another service without authorization. Lately reads only
public reel pages, one reel per user save, but this is the second place where Meta could
object. Worth the same legal advice before scaling.
