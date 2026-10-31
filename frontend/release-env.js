// Release-build guard, used by app.config.js. A production build must talk to the real
// backend: never demo mode, never localhost, never without Supabase or the RevenueCat key
// (a store build without it could not sell Pro). Plain CommonJS so the
// Expo config loader can require it without a build step.

/** Is this config being evaluated for a production (store) build? */
function isProductionBuild(env) {
  // A test build for GitHub Releases (android-apk workflow) says so explicitly: bundling any
  // release build can set NODE_ENV=production, so NODE_ENV alone can't tell the two apart.
  if (env.APP_VARIANT === "preview") return false;
  return env.APP_VARIANT === "production" || env.EAS_BUILD_PROFILE === "production" || env.NODE_ENV === "production";
}

/** Everything wrong with the EXPO_PUBLIC_* settings for a release build (empty = fine). */
function releaseEnvProblems(env) {
  const problems = [];
  if (env.EXPO_PUBLIC_API_MODE !== "live") {
    problems.push(`EXPO_PUBLIC_API_MODE must be "live" (got ${JSON.stringify(env.EXPO_PUBLIC_API_MODE ?? null)})`);
  }
  const apiUrl = env.EXPO_PUBLIC_API_URL ?? "";
  if (!/^https:\/\/[^/\s]+/.test(apiUrl)) {
    problems.push(`EXPO_PUBLIC_API_URL must be an https:// URL (got ${JSON.stringify(apiUrl || null)})`);
  }
  if (!env.EXPO_PUBLIC_SUPABASE_URL) problems.push("EXPO_PUBLIC_SUPABASE_URL is not set");
  if (!env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) problems.push("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  // RevenueCat's public Google Play SDK key; its secret API key (sk_...) must never end up here.
  if (!(env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "").startsWith("goog_")) {
    problems.push('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY must be the RevenueCat Google Play SDK key (starts with "goog_")');
  }
  return problems;
}

/** Throws (failing the build at config time) when a production build is misconfigured. */
function assertReleaseEnv(env) {
  if (!isProductionBuild(env)) return;
  const problems = releaseEnvProblems(env);
  if (problems.length) {
    throw new Error(
      `Refusing to configure a production build of Lately:\n  - ${problems.join("\n  - ")}\n` +
        "Set these in the EAS environment (or frontend/.env) before building a release.",
    );
  }
}

module.exports = { isProductionBuild, releaseEnvProblems, assertReleaseEnv };
