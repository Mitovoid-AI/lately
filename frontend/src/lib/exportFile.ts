import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

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
