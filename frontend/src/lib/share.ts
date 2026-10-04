import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";

/** Native share sheet when available; otherwise copy the link (desktop web). */
export async function shareOrCopy(o: { title: string; url: string }): Promise<"shared" | "copied"> {
  const webCanShare = Platform.OS !== "web" || (typeof navigator !== "undefined" && "share" in navigator);
  if (webCanShare) {
    try {
      await Share.share({ title: o.title, message: `${o.title}\n${o.url}`, url: o.url });
      return "shared";
    } catch {
      // fall through to copying
    }
  }
  await Clipboard.setStringAsync(o.url);
  return "copied";
}
