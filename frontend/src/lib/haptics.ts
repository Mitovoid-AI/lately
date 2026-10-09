import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const SUPPORTED = Platform.OS === "ios" || Platform.OS === "android";

function run(fire: () => Promise<void>) {
  if (!SUPPORTED) return;
  try {
    fire().catch(() => {});
  } catch {
    // Haptics are a garnish: never let them break the action they accompany.
  }
}

/**
 * One haptic per user action, fired in the same frame as its visual, never as the only
 * feedback (many users have haptics off, and most Android hardware is silent).
 */
export const haptic = {
  /** A value ticks to a new step: tab, chip, segmented control, picker. */
  selection: () => run(() => Haptics.selectionAsync()),
  /** Something snaps into place: a sheet catches, a toggle commits. */
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A destructive action lands. */
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

export type HapticKind = keyof typeof haptic;
