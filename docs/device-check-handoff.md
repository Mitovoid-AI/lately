# Device check handoff (2026-10-22, paused)

This picks up the Android device check of the qa build, which was cut short when the MuMu emulator shut down. The audit context is in `anti-slop/audit-001-followup.md`, and the item still open there is "L19 and L20 not yet confirmed on a device".

## The task

Build a fresh x86_64 debug APK, install it on MuMu, and check on the device what was only checked in code:

1. With no RevenueCat key, the paywall shows prices and "Purchases aren't available in this build." without crashing.
2. TalkBack: toasts and errors are spoken, sheets don't put the backdrop first in focus order, buttons keep their names while busy, and the text-size control is adjustable.
3. Keyboard: the sign-in email sheet, new-stack sheet, add-to-stack sheet, card note editor and save sheet note field stay above Gboard with 3-button navigation. `Sheet.tsx` uses `behavior="height"` on Android.
4. Largest system font: the tab bar, card action bar, confirm dialog, chips and paywall.
5. Flow: save a reel, then search for it.

Then fix failures, run `npx tsc --noEmit`, `npx expo lint` and the jest files you touch (`--maxWorkers=1 --testTimeout=180000`), add a "Device check" section to `anti-slop/audit-001-followup.md`, and commit on qa. Don't push.

## Done

- **Build:** `npx expo prebuild -p android --no-install` cleared and regenerated `frontend/android/`. The `"android"` script it rewrites in `package.json` was reverted. `frontend/android/local.properties` now holds `sdk.dir=C:/Users/ashu2/AppData/Local/Android/Sdk`, since `ANDROID_HOME` is not set. The build command was `./gradlew :app:assembleDebug -PreactNativeArchitectures=x86_64 --max-workers=2` (18 min cold; the first try failed on a passing DNS error for Maven Central). The APK is at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.
- **Install and start:** `adb install -r` kept your sign-in. The app starts in live mode on Home with your real saves, so the `react-native-purchases` native module loads fine. The first launch showed "Unable to load script" because Metro wasn't ready yet. A force-stop and restart fixed it.
- **Paywall (item 1): PASS.** It shows Yearly $29.99 (Save 37%, 7 days free) and Monthly $3.99, with "Purchases aren't available in this build." above a disabled button. Tapping the plans and the disabled button does not crash it.
- **Largest font, `font_scale` 2.0 (item 4): PASS** for the tab bar, the card action bar (the main button gets its own row and the two icon buttons share the row below), the delete confirm dialog (it wraps and the buttons stack), the Home filter chips (they scroll sideways), the Search example chips (they wrap) and the paywall. Home tile titles truncate with an ellipsis. The font scale was set back to 1.0 afterwards.

## Bug found and fixed, not yet confirmed on the device

On Android, a `PressableScale` with `self-start` (or `self-center`/`self-end`) in `containerClassName` is laid out far too tall. Its inner box has `flexGrow: 1`, and native Yoga grows it to all the height on offer when the pressable is sized to its content. On card pages, the "Add a note" link measured 2044 dp in `onLayout`, which is the scroll content height plus the viewport. The "Your note" box then covered the tags and the "Original caption" row. This shows at any font size. Web flexbox doesn't do it, which is why the web screenshots passed.

Affected call sites: `NoteBlock.tsx` ("Add a note"), `CuratedScreen.tsx:208` ("See all N") and `PaywallScreen.tsx:395` (the `self-start` "Try again" button).

The uncommitted fix is in `frontend/src/components/motion/PressableScale.tsx`: when `containerClassName` has a `self-*` alignment class, the box doesn't get `flexGrow`. It still needs:
- A check on the device that the note box ends under its text and the tags and caption show again, plus a look at Curated "See all".
- A jest test for the `SELF_ALIGNED` rule, then tsc, lint and jest.
- A follow-up check: a column parent with `items-start`/`items-center` probably triggers the same thing, and the regex can't see it (e.g. `AuthCallbackScreen`'s `w-full` button inside an `alignItems: "center"` Reveal).

## Still open

- **TalkBack (item 2) and Gboard (item 3) need you first.** MuMu has neither installed and no Google account is signed in. Sign in to the Play Store on MuMu and install "Android Accessibility Suite" and "Gboard".
- **3-button navigation can't be reproduced on MuMu.** It has no on-screen nav bar (`qemu.hw.mainkeys=1`, no root), and the Android SDK has no emulator or system image. Test on a phone or in an Android Studio emulator, or record this as not covered.
- **Keyboard tests on MuMu:** the Sogou keyboard runs in hardware-keyboard mode, so no on-screen keyboard appears. `settings put secure show_ime_with_hard_keyboard 1` should bring it up; set it back to 0 afterwards.
- **Tab bar side finding:** in that mode RN still fires `keyboardDidShow` with zero insets, so `TabBar.tsx` hides the tab bar on the Search tab while nothing covers it. A real phone with a physical keyboard would see the same. A possible fix is to hide only when the keyboard height is over a threshold.
- **Sign-in email sheet:** reaching it in live mode means signing out, and signing back in needs a magic link opened in MuMu's browser by you. Test it in demo mode instead: same APK, with Metro started with `EXPO_PUBLIC_API_MODE=demo`.
- **Save-and-search flow (item 5):** not started. It works on the dev DB, because saves, cards and search don't read the 0013 columns. Start the `backend-worker` preview server too.
- **Wrap-up:** add the "Device check" section to `anti-slop/audit-001-followup.md`, then commit on qa. Don't push.

## Environment notes

- **The dev DB is missing `0013_billing.sql`.** `/me` returns 500 with `column p.plan_expires_at does not exist`, as does `/billing` and the export job. The app copes: the paywall falls back to a limit of 20 and Account uses the auth profile. Applying 0013 to the dev DB is your call. It is a cloud write, and it has been blocked before.
- **MuMu:** start it with `"C:\Program Files\Netease\MuMuPlayer\nx_main\MuMuManager.exe" control -v 0 launch`. Then run `adb connect 127.0.0.1:16384`, `adb reverse tcp:8081 tcp:8081` and `adb reverse tcp:8001 tcp:8001`. The screen is 900x1600 at 240 dpi.
- **Memory:** free RAM sits around 600 MB with MuMu running, and frames take 1 to 4 s, so screenshots can catch in-between states. Run one heavy thing at a time and stop the Gradle daemon (`./gradlew --stop`) after a build. MuMu shut down once during this run.
- **Servers:** Metro is `frontend-phone` and the API is `backend-api`, both in `.claude/launch.json`. They were left running.
- **Driving the device:** `adb exec-out screencap -p` for screenshots. `uiautomator dump` lists nodes, but only those visible on screen. `dumpsys activity top` gives the real native frames, which is how the layout bug was found.
- **Careful with taps:** Account has Sign out and Delete account. Don't tap near them, and never confirm a delete.
