import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** The archive files this app writes: the server's `lately-export-YYYYMMDD.json`, or the fallback `lately-export.json`. */
const EXPORT_FILE = /^lately-export.*\.json$/;

/**
 * Writes the export to the app's cache directory and opens the system share sheet, so the
 * person can keep it in Files/Drive or send it anywhere. No storage permission is needed.
 */
export async function shareExportFile(filename: string, json: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing files is not available on this device.");
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(json);
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    UTI: "public.json",
    dialogTitle: "Save your Lately archive",
  });
}

/**
 * Deletes every archive file left in the cache (they hold all saves and notes), on sign-out and
 * account deletion. Never throws: on the web, or with an unreadable cache, there is nothing to do.
 */
export function deleteExportFiles(): void {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && EXPORT_FILE.test(entry.name)) entry.delete();
    }
  } catch {
    // The system clears the cache eventually; sign-out must not fail over it.
  }
}
