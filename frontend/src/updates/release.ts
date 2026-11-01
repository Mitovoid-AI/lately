import Constants from "expo-constants";
import { Platform } from "react-native";

/** The newest test APK on GitHub Releases (android-apk workflow: tag apk-<run>, asset lately.apk). */
export type ApkRelease = {
  /** The workflow run number, which is also that APK's Android versionCode. */
  build: number;
  tag: string;
  url: string;
  bytes: number;
  publishedAt: string;
};

const APK_ASSET = "lately.apk";
const CHECK_TIMEOUT_MS = 10_000;

/** apk-12 → 12; a re-run's apk-12-2 → 12; any other tag → null. */
export function buildNumber(tag: string): number | null {
  const match = /^apk-(\d+)(?:-\d+)?$/.exec(tag);
  return match ? Number(match[1]) : null;
}

/** The APK in GitHub's "latest release" answer, or null when it is not a test-APK release. */
export function parseLatestRelease(json: unknown): ApkRelease | null {
  if (!json || typeof json !== "object") return null;
  const { tag_name, published_at, assets } = json as { tag_name?: unknown; published_at?: unknown; assets?: unknown };
  if (typeof tag_name !== "string" || !Array.isArray(assets)) return null;
  const build = buildNumber(tag_name);
  const apk = assets.find((a) => a && typeof a === "object" && (a as { name?: unknown }).name === APK_ASSET) as
    | { browser_download_url?: unknown; size?: unknown }
    | undefined;
  if (build === null || !apk || typeof apk.browser_download_url !== "string") return null;
  return {
    build,
    tag: tag_name,
    url: apk.browser_download_url,
    bytes: typeof apk.size === "number" ? apk.size : 0,
    publishedAt: typeof published_at === "string" ? published_at : "",
  };
}

/**
 * Where this build looks for updates and which build it is, or null when it doesn't update
 * itself: only Android test APKs carry `apkUpdates` (app.config.js, APP_VARIANT=preview).
 */
export function updateSource(): { repo: string; installedBuild: number } | null {
  if (Platform.OS !== "android") return null;
  const repo = (Constants.expoConfig?.extra as { apkUpdates?: { repo?: unknown } } | undefined)?.apkUpdates?.repo;
  const installedBuild = Constants.expoConfig?.android?.versionCode;
  if (typeof repo !== "string" || typeof installedBuild !== "number") return null;
  return { repo, installedBuild };
}

/**
 * The latest release when it is newer than the installed build. Any failure (offline, GitHub's
 * hourly limit for anonymous requests, a private repository) means "no update", never an error.
 */
export async function findNewerRelease(
  repo: string,
  installedBuild: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ApkRelease | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const release = parseLatestRelease(await res.json());
    return release && release.build > installedBuild ? release : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
