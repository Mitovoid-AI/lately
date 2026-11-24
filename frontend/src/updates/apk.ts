import { Directory, File, Paths } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";
import { startActivityAsync } from "expo-intent-launcher";

import { buildNumber, type ApkRelease } from "./release";

const APK_MIME = "application/vnd.android.package-archive";
/** What downloadApk names its files: lately-<tag>.apk, e.g. lately-apk-12.apk. */
const APK_FILE = /^lately-(apk-[\d-]+)\.apk$/;
/** Intent.FLAG_GRANT_READ_URI_PERMISSION: lets the installer read the file Lately downloaded. */
const GRANT_READ = 1;

/**
 * Downloads the release's APK into the app's cache (no storage permission needed), reporting
 * progress from 0 to 1, and returns its file:// URI. Aborting `signal` cancels the download.
 */
export async function downloadApk(
  release: ApkRelease,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const destination = new File(Paths.cache, `lately-${release.tag}.apk`);
  const file = await File.downloadFileAsync(release.url, destination, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      // GitHub's download host normally sends the size; the release lists it too.
      const total = totalBytes > 0 ? totalBytes : release.bytes;
      if (total > 0) onProgress(Math.min(1, bytesWritten / total));
    },
  });
  return file.uri;
}

/**
 * Hands the downloaded APK to Android's package installer, which asks the person to confirm
 * (and, the first time, to allow installs from Lately). Resolves when the installer closes.
 */
export async function openInstaller(fileUri: string): Promise<void> {
  const data = await getContentUriAsync(fileUri);
  await startActivityAsync("android.intent.action.VIEW", { data, type: APK_MIME, flags: GRANT_READ });
}

/**
 * Deletes downloaded update files (about 56 MB each) that are done with: every build up to the
 * installed one, and every newer build except the newest, which may be the one waiting in
 * Android's installer. Runs at launch, before any download starts. Never throws.
 */
export function deleteOldApks(installedBuild: number): void {
  try {
    const apks = new Directory(Paths.cache).list().flatMap((entry) => {
      const match = entry instanceof File ? APK_FILE.exec(entry.name) : null;
      const build = match ? buildNumber(match[1]) : null;
      return build === null ? [] : [{ file: entry as File, build }];
    });
    const newest = Math.max(installedBuild, ...apks.map((a) => a.build));
    for (const { file, build } of apks) {
      if (build <= installedBuild || build < newest) file.delete();
    }
  } catch {
    // A cache that can't be read is cleared by Android when space runs low.
  }
}
