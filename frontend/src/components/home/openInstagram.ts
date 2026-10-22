import { Linking, Platform } from "react-native";

const APP_URL = "instagram://";
const WEB_URL = "https://instagram.com";

/**
 * Opens the Instagram app, or instagram.com when it is not installed (or on the web build,
 * where there is no app to open). Trying the app link and catching the refusal works on both
 * platforms without a canOpenURL declaration.
 */
export async function openInstagram(): Promise<void> {
  if (Platform.OS !== "web") {
    try {
      await Linking.openURL(APP_URL);
      return;
    } catch {
      // Not installed: fall through to the website.
    }
  }
  try {
    await Linking.openURL(WEB_URL);
  } catch {
    // No browser to hand it to; there is nothing more to try.
  }
}
