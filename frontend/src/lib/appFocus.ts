import { focusManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";

/**
 * React Native has no window focus, so React Query thinks the app is always focused and keeps
 * polling in the background. Tie its focus to AppState: polling pauses when the app leaves
 * the screen, and stale queries refetch when it comes back. (Web keeps its own visibility.)
 */
export function wireAppFocus() {
  if (Platform.OS === "web") return;
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
    return () => sub?.remove();
  });
}
