import { BackHandler, Platform } from "react-native";

/** The save sheet's `from` param when a share from another app opened it. */
export const FROM_SHARE = "share";

/**
 * Whether closing a sheet that a share opened can take the person back to the app they shared
 * from. Android only: shares arrive there as an intent (expo-share-intent). iOS has no share
 * extension in this app, and the web gets no shares.
 */
export function canReturnToSharer(): boolean {
  return Platform.OS === "android";
}

/**
 * Puts Lately in the background so the app the share came from (Instagram) is in front again.
 * MainActivity is singleTask, so a share opens Lately in its own task on top of the sharing app's.
 * `BackHandler.exitApp()` runs the activity's default Back, which moves that task to the back
 * (Android 12+ does this for a root launcher activity; Expo's MainActivity does the same on older
 * versions with moveTaskToBack). Lately keeps running: nothing is finished or lost.
 */
export function returnToSharer(): void {
  if (canReturnToSharer()) BackHandler.exitApp();
}
