import { Platform } from "react-native";

import { buildNumber, findNewerRelease, parseLatestRelease, updateSource } from "../release";

const mockConfig: { expoConfig: Record<string, unknown> | null } = { expoConfig: null };
jest.mock("expo-constants", () => ({
  __esModule: true,
  get default() {
    return mockConfig;
  },
}));

const LATEST = {
  tag_name: "apk-12",
  published_at: "2026-11-01T10:00:00Z",
  assets: [
    { name: "notes.txt", browser_download_url: "https://example.test/notes.txt", size: 10 },
    { name: "lately.apk", browser_download_url: "https://github.com/x/y/releases/download/apk-12/lately.apk", size: 56_259_151 },
  ],
};

function answer(body: unknown, ok = true): typeof fetch {
  return jest.fn(async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
}

test("the build number comes from the apk-<run> tag, re-runs included", () => {
  expect(buildNumber("apk-12")).toBe(12);
  expect(buildNumber("apk-12-2")).toBe(12);
  expect(buildNumber("v1.0.0")).toBeNull();
  expect(buildNumber("apk-")).toBeNull();
});

test("the latest release is read only when it is a test APK release with the APK attached", () => {
  expect(parseLatestRelease(LATEST)).toEqual({
    build: 12,
    tag: "apk-12",
    url: "https://github.com/x/y/releases/download/apk-12/lately.apk",
    bytes: 56_259_151,
    publishedAt: "2026-11-01T10:00:00Z",
  });
  expect(parseLatestRelease({ ...LATEST, tag_name: "v2.0.0" })).toBeNull();
  expect(parseLatestRelease({ ...LATEST, assets: [LATEST.assets[0]] })).toBeNull();
  expect(parseLatestRelease(null)).toBeNull();
  expect(parseLatestRelease("not json")).toBeNull();
});

test("only a release newer than the installed build is offered", async () => {
  const fetchLatest = answer(LATEST);
  await expect(findNewerRelease("Mitovoid-AI/lately", 9, fetchLatest)).resolves.toMatchObject({ build: 12 });
  expect(fetchLatest).toHaveBeenCalledWith(
    "https://api.github.com/repos/Mitovoid-AI/lately/releases/latest",
    expect.objectContaining({ headers: { Accept: "application/vnd.github+json" } }),
  );
  await expect(findNewerRelease("Mitovoid-AI/lately", 12, answer(LATEST))).resolves.toBeNull();
  await expect(findNewerRelease("Mitovoid-AI/lately", 13, answer(LATEST))).resolves.toBeNull();
});

test("a failed check (rate limit, private repo, offline) is just no update", async () => {
  await expect(findNewerRelease("Mitovoid-AI/lately", 9, answer({ message: "rate limited" }, false))).resolves.toBeNull();
  const offline = jest.fn(async () => {
    throw new TypeError("Network request failed");
  }) as unknown as typeof fetch;
  await expect(findNewerRelease("Mitovoid-AI/lately", 9, offline)).resolves.toBeNull();
});

describe("updateSource", () => {
  afterEach(() => {
    mockConfig.expoConfig = null;
    jest.restoreAllMocks();
  });

  test("an Android test APK checks its repo, as the build it is", () => {
    jest.replaceProperty(Platform, "OS", "android");
    mockConfig.expoConfig = { android: { versionCode: 9 }, extra: { apkUpdates: { repo: "Mitovoid-AI/lately" } } };
    expect(updateSource()).toEqual({ repo: "Mitovoid-AI/lately", installedBuild: 9 });
  });

  test("store builds (no apkUpdates), other platforms and builds without a versionCode never check", () => {
    jest.replaceProperty(Platform, "OS", "android");
    mockConfig.expoConfig = { android: { versionCode: 9 } };
    expect(updateSource()).toBeNull();
    mockConfig.expoConfig = { extra: { apkUpdates: { repo: "Mitovoid-AI/lately" } } };
    expect(updateSource()).toBeNull();
    jest.replaceProperty(Platform, "OS", "web");
    mockConfig.expoConfig = { android: { versionCode: 9 }, extra: { apkUpdates: { repo: "Mitovoid-AI/lately" } } };
    expect(updateSource()).toBeNull();
  });
});
