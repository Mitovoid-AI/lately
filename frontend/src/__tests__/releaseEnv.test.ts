// eslint-disable-next-line @typescript-eslint/no-require-imports
const releaseEnv = require("../../release-env") as {
  isProductionBuild(env: Record<string, string | undefined>): boolean;
  releaseEnvProblems(env: Record<string, string | undefined>): string[];
  assertReleaseEnv(env: Record<string, string | undefined>): void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../../app.config") as (ctx: { config: Record<string, unknown> }) => Record<string, unknown>;

const GOOD = {
  EXPO_PUBLIC_API_MODE: "live",
  EXPO_PUBLIC_API_URL: "https://api.lately.app",
  EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: "goog_abc123",
};

test("any of the three production signals marks a production build", () => {
  expect(releaseEnv.isProductionBuild({ APP_VARIANT: "production" })).toBe(true);
  expect(releaseEnv.isProductionBuild({ EAS_BUILD_PROFILE: "production" })).toBe(true);
  expect(releaseEnv.isProductionBuild({ NODE_ENV: "production" })).toBe(true);
  expect(releaseEnv.isProductionBuild({ NODE_ENV: "development", EAS_BUILD_PROFILE: "preview" })).toBe(false);
});

test("a complete live https config has no problems", () => {
  expect(releaseEnv.releaseEnvProblems(GOOD)).toEqual([]);
  expect(() => releaseEnv.assertReleaseEnv({ ...GOOD, APP_VARIANT: "production" })).not.toThrow();
});

test("a production build refuses demo mode, localhost, missing Supabase and a missing RevenueCat key", () => {
  const cases: Record<string, string | undefined>[] = [
    { ...GOOD, EXPO_PUBLIC_API_MODE: undefined },
    { ...GOOD, EXPO_PUBLIC_API_MODE: "demo" },
    { ...GOOD, EXPO_PUBLIC_API_URL: undefined },
    { ...GOOD, EXPO_PUBLIC_API_URL: "http://localhost:8000" },
    { ...GOOD, EXPO_PUBLIC_API_URL: "http://api.lately.app" },
    { ...GOOD, EXPO_PUBLIC_SUPABASE_URL: "" },
    { ...GOOD, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
    { ...GOOD, EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: undefined },
    { ...GOOD, EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: "" },
  ];
  for (const env of cases) {
    expect(releaseEnv.releaseEnvProblems(env)).toHaveLength(1);
    expect(() => releaseEnv.assertReleaseEnv({ ...env, EAS_BUILD_PROFILE: "production" })).toThrow(/production build/);
  }
});

test("the RevenueCat key must be the Google Play SDK key, not another platform's or a secret key", () => {
  for (const key of ["appl_abc123", "sk_abc123", "test_abc123", "GOOG_abc123", " goog_abc123"]) {
    const problems = releaseEnv.releaseEnvProblems({ ...GOOD, EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: key });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/EXPO_PUBLIC_REVENUECAT_ANDROID_KEY.*goog_/);
  }
  // The message names the setting but never echoes a (possibly secret) value.
  const problems = releaseEnv.releaseEnvProblems({ ...GOOD, EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: "sk_supersecret" });
  expect(problems.join(" ")).not.toContain("sk_supersecret");
});

test("development builds are not checked", () => {
  expect(() => releaseEnv.assertReleaseEnv({ NODE_ENV: "development" })).not.toThrow();
});

describe("app.config.js", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  test("passes app.json through for development", () => {
    process.env = { ...saved, NODE_ENV: "development", APP_VARIANT: undefined, EAS_BUILD_PROFILE: undefined };
    const config = { name: "Lately", slug: "lately" };
    expect(appConfig({ config })).toMatchObject(config);
  });

  test("throws for a misconfigured production build", () => {
    process.env = { ...saved, APP_VARIANT: "production", EXPO_PUBLIC_API_MODE: "demo" };
    expect(() => appConfig({ config: { name: "Lately" } })).toThrow(/EXPO_PUBLIC_API_MODE/);
  });

  test("a production build without the RevenueCat key does not configure", () => {
    process.env = { ...saved, ...GOOD, APP_VARIANT: "production", EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: undefined };
    expect(() => appConfig({ config: { name: "Lately" } })).toThrow(/EXPO_PUBLIC_REVENUECAT_ANDROID_KEY/);
    process.env = { ...saved, ...GOOD, APP_VARIANT: "production" };
    expect(appConfig({ config: { name: "Lately" } })).toMatchObject({ name: "Lately" });
  });
});
