// Wraps app.json. A production build (APP_VARIANT / EAS_BUILD_PROFILE / NODE_ENV =
// "production") fails here, at config time, unless it is pointed at the live backend over
// https with Supabase configured: release builds must never ship demo mode or localhost.
//
// Optional release overrides, read only when set (the release workflow sets them):
//   APP_VERSION          -> version (Android versionName), e.g. 1.0.1
//   ANDROID_VERSION_CODE -> android.versionCode, a whole number Google Play has not seen before
//
// Every build also gets the release signing plugin (plugins/with-release-signing.js), which
// signs the release build type with the upload key from Gradle properties.
//
// Test APKs for GitHub Releases (APP_VARIANT=preview, the android-apk workflow) update
// themselves: they check this repository's latest release and hand the downloaded APK to
// Android's installer (src/updates). Google Play forbids self-updating, so every other build
// gets neither the install permission nor the `apkUpdates` setting.
const { assertReleaseEnv } = require("./release-env");

const APK_UPDATES = { repo: "Mitovoid-AI/lately" };
const INSTALL_PERMISSION = "android.permission.REQUEST_INSTALL_PACKAGES";

const VERSION_NAME = /^\d+(\.\d+){0,2}$/;
const MAX_VERSION_CODE = 2100000000; // the highest versionCode Google Play accepts

/** The version settings a build overrides from the environment (empty = keep app.json). */
function versionOverrides(env) {
  const overrides = {};
  const version = (env.APP_VERSION ?? "").trim();
  if (version) {
    if (!VERSION_NAME.test(version)) {
      throw new Error(`APP_VERSION must look like 1.2 or 1.2.3 (got ${JSON.stringify(version)})`);
    }
    overrides.version = version;
  }
  const code = (env.ANDROID_VERSION_CODE ?? "").trim();
  if (code) {
    const value = Number(code);
    if (!/^\d+$/.test(code) || value < 1 || value > MAX_VERSION_CODE) {
      throw new Error(
        `ANDROID_VERSION_CODE must be a whole number from 1 to ${MAX_VERSION_CODE} (got ${JSON.stringify(code)})`,
      );
    }
    overrides.androidVersionCode = value;
  }
  return overrides;
}

module.exports = ({ config }) => {
  assertReleaseEnv(process.env);
  const overrides = versionOverrides(process.env);
  const testBuild = process.env.APP_VARIANT === "preview";
  const android = {
    ...config.android,
    ...(overrides.androidVersionCode !== undefined ? { versionCode: overrides.androidVersionCode } : {}),
    ...(testBuild ? { permissions: [...(config.android?.permissions ?? []), INSTALL_PERMISSION] } : {}),
  };
  return {
    ...config,
    ...(overrides.version ? { version: overrides.version } : {}),
    ...(config.android || overrides.androidVersionCode !== undefined || testBuild ? { android } : {}),
    ...(testBuild ? { extra: { ...config.extra, apkUpdates: APK_UPDATES } } : {}),
    plugins: [...(config.plugins ?? []), "./plugins/with-release-signing"],
  };
};
