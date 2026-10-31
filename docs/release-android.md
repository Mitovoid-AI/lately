# Android release build for Google Play

This guide makes the signed Android file (`app-release.aab`) that Google Play Console accepts.
GitHub builds it for you. You create one key, store it safely, add a few settings to GitHub,
and press one button.

Facts in this guide were checked on 2026-10-22. The sources are at the end.

For the rest of launch (backend, billing, store listing, public pages), see
`docs/launch-checklist.md`.

**Just want an APK to test on your phone?** You don't need any of this. Every push to `main`
that touches the app runs the tests, builds a standalone APK and publishes it as a GitHub
Release (workflow `android-apk`). On your phone open
`https://github.com/Mitovoid-AI/lately/releases/latest/download/lately.apk` and install it.
It runs in demo mode (sample saves) until the repository variables `EXPO_PUBLIC_API_URL`
(https), `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` exist (step 4
below), then it is built live. It is signed with Android's public debug key, so it is only for
testing: it is not the Google Play app and can't buy Pro through Google Play.

---

## Words used in this guide

- **Upload key**: the key that signs the file you send to Google Play. You keep it safe.
  Google keeps its own signing key for the app (Play App Signing).
- **Keystore**: the file that holds the upload key. This guide calls it `lately-upload-key.jks`.
- **Secret**: a hidden value in GitHub. Nobody can read it back after you save it.
- **Variable**: a visible setting in GitHub. Use it for values that are not secret.

---

## Before you start

- A Java 17 JDK, which includes the `keytool` program. Check it by running `keytool -help`.
  If Windows or macOS says `keytool` is not found, install a Java 17 JDK and open a new terminal.
- Access to the Lately GitHub repository.
- Your Google Play Console account (only needed from step 7; see `docs/launch-checklist.md`).

---

## Step 1. Create the upload key (do this once)

Make one upload key for Lately and keep it for the life of the app. A second key means
a second set of secrets and a Play support request.

**Windows PowerShell:**

```powershell
New-Item -ItemType Directory -Force "$HOME\Documents\LatelyKeys" | Out-Null
Set-Location "$HOME\Documents\LatelyKeys"
keytool -genkeypair -v -storetype PKCS12 -keystore lately-upload-key.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

**macOS or Linux (Terminal):**

```bash
mkdir -p ~/LatelyKeys
cd ~/LatelyKeys
keytool -genkeypair -v -storetype PKCS12 -keystore lately-upload-key.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` asks you questions:

1. **Enter keystore password.** Choose a long password. Save it in your password manager
   right away. This is the store password.
2. **Re-enter new password.** Type the same password again.
3. **First and last name, organization, city, state, country.** Answer with your own details,
   or "Lately". They are stored in the certificate. Users never see them.
4. **Enter key password for <upload>.** If you are asked, type the same password as the
   keystore password. Use one password for both. This is the key password.
5. Type `yes` if it asks to confirm the details.

The key is named `upload` (the alias). Write that down too.

Check the file. Enter the keystore password when asked:

```powershell
keytool -list -keystore lately-upload-key.jks -storetype PKCS12
```

```bash
keytool -list -keystore lately-upload-key.jks -storetype PKCS12
```

The output should say `Your keystore contains 1 entry` and show `upload`.

The key is valid for 10,000 days, about 27 years. Google requires the key to stay valid past
22 October 2033.

---

## Step 2. Back up the keystore and its passwords

Losing the keystore is a serious problem. You then have to ask Google Play for an upload key
reset, which is a support request. It is not a quick fix. Make these backups now:

1. **The file `lately-upload-key.jks`.** Keep two copies in two places:
   - a password-protected archive or attachment in your password manager, and
   - an offline copy on a USB drive kept somewhere safe.
2. **The keystore password.** Save it in your password manager.
3. **The alias `upload`** and the **key password** (the same as the keystore password).

Rules for the keystore:

- Never email it, paste it into a chat, or commit it to the repository. The `frontend` folder's
  `.gitignore` skips `*.jks` files, but keep the file outside the project folder anyway.
- GitHub will not show a secret again after you save it. Your password manager copy is the
  only copy you can read.

Optional: export the public certificate for your records. It is safe to share with Google:

```powershell
keytool -export -rfc -keystore lately-upload-key.jks -alias upload -file upload_certificate.pem
```

```bash
keytool -export -rfc -keystore lately-upload-key.jks -alias upload -file upload_certificate.pem
```

---

## Step 3. Turn the keystore into text for GitHub

GitHub secrets hold text, so the keystore file is converted to one long line of text
(base64). That text is as sensitive as the file. Do not paste it anywhere except the GitHub
secret in step 4.

**Windows PowerShell:**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Documents\LatelyKeys\lately-upload-key.jks")) | Set-Clipboard
```

The text is now on your clipboard. Paste it into GitHub in step 4. Then copy something harmless
over the clipboard.

**macOS (Terminal):**

```bash
openssl base64 -A -in ~/LatelyKeys/lately-upload-key.jks | pbcopy
```

**Linux (Terminal):**

```bash
openssl base64 -A -in ~/LatelyKeys/lately-upload-key.jks
```

Copy the one line it prints.

---

## Step 4. Add the GitHub secrets and variables

On GitHub, open the repository, then **Settings**, then **Secrets and variables**, then **Actions**.

Add the first four on the **Secrets** tab with **New repository secret**. Add the last four on
the **Variables** tab with **New repository variable**. Type the names exactly as shown.

| Name | Where it goes | What to paste |
|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Secret | The one line from step 3 |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Secret | The keystore password from step 1 |
| `ANDROID_UPLOAD_KEY_ALIAS` | Secret | `upload` |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Secret | The key password (the same as the keystore password) |
| `EXPO_PUBLIC_API_URL` | Variable | Your backend address, starting with `https://`, for example `https://lately-api.fly.dev`. Use the address from `docs/deploy.md` |
| `EXPO_PUBLIC_SUPABASE_URL` | Variable | `https://<project-ref>.supabase.co` from Supabase, Project Settings, API |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Variable | The **publishable** key from Supabase. Never the secret or service role key |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | Variable | The RevenueCat **Google Play** key, which starts with `goog_`. Never a key that starts with `sk_` (see `docs/billing-setup.md`, Part 2) |

The first run stops and lists any empty name, so you find a missing value before the long build starts.

---

## Step 5. Run the workflow

1. **The workflow must be on the `main` branch first.** GitHub shows the **Run workflow**
   button only when the workflow file is on the default branch, which is `main`. It gets there
   with the next merge from `qa` to `main`.
2. Open the **Actions** tab. In the left list, click **android-release**.
3. Click **Run workflow**. Choose the branch to build. Use **main** for a store build, so the
   build matches what is on `main`.
4. Fill in the two boxes:
   - **version_name**: leave it empty to use the version in `frontend/app.json` (now `1.0.0`).
     For a new upload, type the new version, for example `1.0.1`. Then change `"version"` in
     `frontend/app.json` to the same value, so the repository matches the upload.
   - **version_code_offset**: leave it as `0`. See "Version rules" below.
5. Click the green **Run workflow** button.
6. Wait. The build can take a long time. GitHub stops it after 90 minutes.

If the run fails, open it and read the red step. The "Troubleshooting" section lists the common
messages.

**Use Run workflow for every new upload, not Re-run.** A re-run keeps the same run number, so
the version code stays the same, and Google Play rejects a code it has already seen.

---

## Step 6. Download the bundle

1. Open the finished run. The **Summary** page shows the version name, the version code, and
   two SHA-256 fingerprints. Keep them with your backups.
2. Scroll to **Artifacts**. Download `lately-android-release-<number>`. GitHub gives you a zip.
3. Unzip it. The file is `app-release.aab`.
4. Keep a copy with your backups. The workflow keeps artifacts for 30 days, then GitHub deletes them.

If an artifact named `lately-android-mapping-<number>` is also there, download it too and keep
it. It decodes crash reports that Google Play sends back.

---

## Step 7. Upload to Google Play Console

Use the Play Console for the Lately app (create it first; see `docs/billing-setup.md`, Part 1).

**Play App Signing.** New apps use Play App Signing. Google keeps the app's signing key, and
you keep the upload key. When you upload your first bundle, accept Play App Signing if asked.

Upload the bundle in this order. Do not skip ahead.

### 7a. Internal testing (first check)

1. **Testing**, then **Internal testing**, then **Create new release**.
2. Upload `app-release.aab`. Enter release notes. Save, then **Review release**, then
   **Start rollout**.
3. Under **Testers**, add your own Google account email. Install the app from the testing
   link on your phone and check that it opens and signs in.

### 7b. Closed testing (required before production)

Personal developer accounts created after November 13, 2023 must run a closed test first:
at least **12 testers**, opted in **continuously for 14 days**. Google requires this before it
allows production access.

1. **Testing**, then **Closed testing**, then create a track. Name it something like
   "Closed test". Upload the same `.aab` or a newer one, and roll it out.
2. Add the emails of at least 12 testers. They need Google accounts. Each tester opens the
   opt-in link and joins.
3. Keep all 12 testers opted in for 14 days. Do not remove anyone during that time.
   Testers who must buy Lately Pro in the test also need to be on the license-testing list
   (`docs/billing-setup.md`, Part 1, step 3).
4. After 14 days, open the Play Console **Dashboard** and choose **Apply for production access**.
   Answer the questions. Google reviews the answers before it approves production.

### 7c. Production

1. When production access is approved: **Production**, then **Create new release**.
2. Upload the newest `app-release.aab`, write the release notes, and roll it out. You can
   start with a partial rollout and raise it later.

---

## Version rules

**versionCode** is the number Google Play uses to decide which upload is newer.

- Google Play needs every upload to have a higher versionCode than the one before it, and
  no code can be used twice. The highest allowed value is 2100000000.
- The workflow sets it from the run number (plus the offset, which starts at 0). Each new
  run gets a higher number, so you do not need to edit any file for it.
- Only use the offset if the run number is ever lower than a code you already uploaded. That
  happens if the repository is moved or recreated, because GitHub's run counter starts again.
  Example: if the highest uploaded code is 57 and the new run number is 3, enter an offset
  of 60. The new code is 63.

**version name** is what users see, for example `1.0.1`.

- Change it with the **version_name** box, and change `"version"` in `frontend/app.json` to
  match.

For a local build, the same values come from the environment (see the local build section).

---

## Build on your own computer (alternative)

Use this only if GitHub is down or you need a build on your PC. A local build needs a lot of
free memory and a long time. The GitHub workflow is the normal path.

Local builds read the same secrets from your own user folder, never from the repository.

### 1. Put the signing settings in your Gradle user file

This file is outside the project. The password is stored in plain text on your PC. Delete the
file after the build if the PC is shared.

**Windows PowerShell:**

```powershell
New-Item -ItemType Directory -Force "$HOME\.gradle" | Out-Null
notepad "$HOME\.gradle\gradle.properties"
```

Paste these four lines and fill in your values. Use forward slashes in the path:

```properties
android.injected.signing.store.file=C:/Users/YOUR_NAME/Documents/LatelyKeys/lately-upload-key.jks
android.injected.signing.store.password=YOUR_KEYSTORE_PASSWORD
android.injected.signing.key.alias=upload
android.injected.signing.key.password=YOUR_KEY_PASSWORD
```

**macOS or Linux:** the file is `~/.gradle/gradle.properties`. Use the same four lines, with
your real path, for example `/Users/YOUR_NAME/LatelyKeys/lately-upload-key.jks`.

### 2. Generate the Android project and build

**Windows PowerShell** (run from the repository's `frontend` folder):

```powershell
$env:APP_VARIANT = "production"
$env:EXPO_PUBLIC_API_MODE = "live"
$env:EXPO_PUBLIC_API_URL = "https://lately-api.fly.dev"
$env:EXPO_PUBLIC_SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "<publishable key>"
$env:EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = "<goog_ key>"
$env:APP_VERSION = "1.0.1"
$env:ANDROID_VERSION_CODE = "<a number higher than any uploaded code>"
npx expo prebuild --platform android --no-install --clean
Set-Location android
.\gradlew.bat :app:bundleRelease --no-daemon
Set-Location ..
```

The bundle is at `frontend\android\app\build\outputs\bundle\release\app-release.aab`.

**macOS or Linux** (run from the repository's `frontend` folder):

```bash
export APP_VARIANT=production
export EXPO_PUBLIC_API_MODE=live
export EXPO_PUBLIC_API_URL=https://lately-api.fly.dev
export EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='<publishable key>'
export EXPO_PUBLIC_REVENUECAT_ANDROID_KEY='<goog_ key>'
export APP_VERSION=1.0.1
export ANDROID_VERSION_CODE='<a number higher than any uploaded code>'
npx expo prebuild --platform android --no-install --clean
cd android && ./gradlew :app:bundleRelease --no-daemon && cd ..
```

The bundle is at `frontend/android/app/build/outputs/bundle/release/app-release.aab`.

The `frontend/.env` file (git-ignored) can hold the `EXPO_PUBLIC_*` values instead of the
`export` lines. The `APP_VERSION` and `ANDROID_VERSION_CODE` lines are only needed when you
change the version.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| "These GitHub secrets or variables are empty" | A name is missing or misspelled | Check step 4. Names are case sensitive |
| The decode step fails, or says the keystore password is wrong | The base64 text or the store password is wrong | Redo step 3, then check the store password secret |
| The build fails with a message about a key or password | The key password secret does not match the key | Set `ANDROID_UPLOAD_KEY_PASSWORD` to the key password you chose in step 1 |
| "Release builds need the upload key" | A local build has no signing settings | Add the four lines in the local build section, step 1 |
| "The bundle is not signed with the upload key" | The bundle came out with a different key | Do not upload it. Check the secrets, then run the workflow again |
| Play says a version code was already used | You re-ran an old run, or the offset is too low | Use **Run workflow** for a new run, or raise `version_code_offset` |
| "version_name must look like 1.0.1" | The version name has letters or extra parts | Use only numbers and dots, for example `1.0.1` |
| The run stops after 90 minutes | The build is slow or stuck | Run it again. If it keeps stopping, ask the person who maintains the repository |
| There is no Run workflow button | The workflow is not on `main` yet | Merge `qa` into `main` first (step 5, item 1) |
| The Artifacts list is empty | GitHub deletes artifacts after 30 days | Run the workflow again |

---

## What Google Play checks for this build (verified 2026-10-22)

- **Target API level.** From 31 August 2026, new apps and app updates must target Android 16
  (API level 36) or higher. This build targets API level 36, because Expo SDK 57 uses the
  Android settings of React Native 0.86.3, which set it to 36. Check it again after each Expo
  or React Native upgrade.
- **Upload key.** An RSA key of 2048 bits or more, stored in a Java keystore (`.jks` or `.keystore`).
- **Debug-signed builds are refused.** This workflow never signs with the debug key.
- **Version code.** At most 2100000000, higher than every earlier upload, never reused.

---

## Sources (checked 2026-10-22)

- Google Play target API level for new apps and updates:
  https://developer.android.com/google/play/requirements/target-sdk
- Version your app (versionCode rules, 2100000000 maximum):
  https://developer.android.com/studio/publish/versioning
- Sign your app (25-year validity advice, 22 October 2033 date, debug keys not accepted):
  https://developer.android.com/studio/publish/app-signing
- Build your app from the command line (keytool syntax):
  https://developer.android.com/build/building-cmdline
- Use Play App Signing (upload key RSA 2048 or larger, upload key reset, new apps):
  https://support.google.com/googleplay/android-developer/answer/9842756
- App testing requirements for new personal developer accounts (12 testers, 14 days):
  https://support.google.com/googleplay/android-developer/answer/14151465
- React Native signed Android builds (the Gradle signing pattern this workflow follows):
  https://reactnative.dev/docs/signed-apk-android
- GitHub: events that trigger workflows (workflow_dispatch needs the file on the default branch):
  https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
- Expo config plugin mods (withAppBuildGradle):
  https://docs.expo.dev/versions/v57.0.0/config-plugins/mod-plugins/
