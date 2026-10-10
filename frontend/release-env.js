// Release-build guard, used by app.config.js. A production build must talk to the real
// backend: never demo mode, never localhost, never without Supabase. Plain CommonJS so the
// Expo config loader can require it without a build step.

/** Is this config being evaluated for a production (store) build? */
function isProductionBuild(env) {
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
