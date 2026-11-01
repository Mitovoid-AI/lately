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

test("a preview test build is not a production build, even while a release bundle sets NODE_ENV", () => {
  expect(releaseEnv.isProductionBuild({ APP_VARIANT: "preview", NODE_ENV: "production" })).toBe(false);
  // The GitHub Releases test APK runs in demo mode until live settings exist; the guard lets it through.
  expect(() =>
    releaseEnv.assertReleaseEnv({ APP_VARIANT: "preview", NODE_ENV: "production", EXPO_PUBLIC_API_MODE: "demo" }),
  ).not.toThrow();
  // A store build still declares production and stays fully checked.
  expect(() =>
    releaseEnv.assertReleaseEnv({ APP_VARIANT: "production", NODE_ENV: "production", EXPO_PUBLIC_API_MODE: "demo" }),
  ).toThrow(/production build/);
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

describe("app.config.js release overrides", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const base = { name: "Lately", version: "1.0.0", android: { package: "app.lately.android", versionCode: 1 } };

  test("APP_VERSION and ANDROID_VERSION_CODE override version and versionCode", () => {
    process.env = { ...saved, APP_VERSION: "1.0.1", ANDROID_VERSION_CODE: "42" };
    const out = appConfig({ config: base }) as { version: string; android: Record<string, unknown> };
    expect(out.version).toBe("1.0.1");
    expect(out.android).toMatchObject({ package: "app.lately.android", versionCode: 42 });
  });

  test("the largest versionCode Google Play accepts is allowed", () => {
    process.env = { ...saved, ANDROID_VERSION_CODE: "2100000000" };
    const out = appConfig({ config: base }) as { android: Record<string, unknown> };
    expect(out.android.versionCode).toBe(2100000000);
  });

  test("blank or unset overrides leave app.json alone", () => {
    process.env = { ...saved, APP_VERSION: "  ", ANDROID_VERSION_CODE: "" };
    const out = appConfig({ config: base }) as { version: string; android: Record<string, unknown> };
    expect(out.version).toBe("1.0.0");
    expect(out.android.versionCode).toBe(1);
  });

  test("a malformed APP_VERSION or ANDROID_VERSION_CODE fails the config", () => {
    for (const version of ["1.0.1-beta", "v1", "1.0.0.0", "1..2"]) {
      process.env = { ...saved, APP_VERSION: version };
      expect(() => appConfig({ config: base })).toThrow(/APP_VERSION/);
    }
    for (const code of ["0", "4.5", "-3", "abc", "2100000001"]) {
      process.env = { ...saved, ANDROID_VERSION_CODE: code };
      expect(() => appConfig({ config: base })).toThrow(/ANDROID_VERSION_CODE/);
    }
  });

  test("only a preview test build can update itself: install permission and apkUpdates", () => {
    const withPermissions = { ...base, android: { ...base.android, permissions: ["android.permission.INTERNET"] } };
    process.env = { ...saved, APP_VARIANT: "preview", ANDROID_VERSION_CODE: "12" };
    const preview = appConfig({ config: withPermissions }) as {
      android: { permissions: string[]; versionCode: number };
      extra: { apkUpdates: { repo: string } };
    };
    expect(preview.android.permissions).toEqual(["android.permission.INTERNET", "android.permission.REQUEST_INSTALL_PACKAGES"]);
    expect(preview.android.versionCode).toBe(12);
    expect(preview.extra.apkUpdates).toEqual({ repo: "Mitovoid-AI/lately" });

    // Google Play forbids self-updating: the store build and plain builds get neither.
    for (const env of [{ ...GOOD, APP_VARIANT: "production" }, { APP_VARIANT: undefined, NODE_ENV: "development" as const }]) {
      process.env = { ...saved, ...env };
      const out = appConfig({ config: withPermissions }) as { android: { permissions: string[] }; extra?: unknown };
      expect(out.android.permissions).toEqual(["android.permission.INTERNET"]);
      expect(out.extra).toBeUndefined();
    }
  });

  test("every build registers the release signing plugin after the app.json plugins", () => {
    process.env = { ...saved, APP_VARIANT: undefined, EAS_BUILD_PROFILE: undefined, NODE_ENV: "development" };
    const out = appConfig({ config: { ...base, plugins: ["expo-router"] } }) as { plugins: unknown[] };
    expect(out.plugins).toEqual(["expo-router", "./plugins/with-release-signing"]);
  });
});

describe("release signing (plugins/release-signing-gradle.js)", () => {
  // The release-related lines of Expo SDK 57's android/app/build.gradle template.
  const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const releaseSigning = require("../../plugins/release-signing-gradle") as {
    applyReleaseSigning(contents: string): string;
  };

  test("release uses the upload config and debug keeps the debug key", () => {
    const out = releaseSigning.applyReleaseSigning(TEMPLATE);
    expect(out).toContain("signingConfigs {\n        upload {");
    expect(out).toMatch(/release \{[\s\S]*?signingConfig signingConfigs\.upload/);
    expect(out).not.toMatch(/release \{[\s\S]*?signingConfig signingConfigs\.debug/);
    expect(out).toMatch(/debug \{\n\s*signingConfig signingConfigs\.debug/);
    expect(out).toContain("gradle.taskGraph.whenReady");
  });

  test("braces stay balanced and applying it twice changes nothing", () => {
    const once = releaseSigning.applyReleaseSigning(TEMPLATE);
    expect((once.match(/\{/g) ?? []).length).toBe((once.match(/\}/g) ?? []).length);
    expect(releaseSigning.applyReleaseSigning(once)).toBe(once);
  });

  test("a changed template fails loudly instead of keeping the debug key", () => {
    expect(() => releaseSigning.applyReleaseSigning("android {\n}\n")).toThrow(/release signing lines/);
  });
});
