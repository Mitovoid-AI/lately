import { useEffect } from "react";

import { usePreferences } from "../hooks/usePreferences";
import { setThemePreference } from "./preference";

/**
 * The account's saved theme (Account > Theme) becomes this device's theme, and
 * a pick there applies at once (the preferences cache updates optimistically). Mounted only
 * while signed in, so the sign-in screen never asks the API for preferences.
 */
export function ThemeSync() {
  const { prefs, loaded } = usePreferences();
  useEffect(() => {
    if (loaded) setThemePreference(prefs.theme);
  }, [loaded, prefs.theme]);
  return null;
}
