import { colorScheme as nativewindScheme } from "nativewind";
import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { Platform, useColorScheme } from "react-native";

import { useThemePreference, type ThemePreference } from "./preference";
import { palettes, shadowSets, sheens, type Palette, type Shadows } from "./tokens";

export type Scheme = "light" | "dark";

export interface Theme {
  scheme: Scheme;
  colors: Palette;
  shadows: Shadows;
  sheen: string;
}

export const THEMES: Record<Scheme, Theme> = {
  light: { scheme: "light", colors: palettes.light, shadows: shadowSets.light, sheen: sheens.light },
  dark: { scheme: "dark", colors: palettes.dark, shadows: shadowSets.dark, sheen: sheens.dark },
};

const ThemeContext = createContext<Theme>(THEMES.light);

/**
 * The active palette for inline colours: icon tints, highlight colours, Reanimated colour
 * interpolation (which needs plain strings, not PlatformColor). className colours follow the
 * same scheme through CSS variables.
 */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function resolveScheme(preference: ThemePreference, system: string | null | undefined): Scheme {
  if (preference === "system") return system === "dark" ? "dark" : "light";
  return preference;
}

/**
 * Points NativeWind's CSS variables at the scheme. Native hands it the preference itself:
 * "system" clears the Appearance override so the OS (and its later changes) decide, and
 * "light"/"dark" also turn the keyboard, alerts and other native chrome. Web toggles the
 * "dark" class on <html>, which only knows light and dark, so it gets the resolved scheme.
 */
function applyScheme(preference: ThemePreference, scheme: Scheme) {
  try {
    nativewindScheme.set(Platform.OS === "web" ? scheme : preference);
  } catch {
    // No window during a static web render; the client render applies it.
  }
  if (Platform.OS === "web" && typeof document !== "undefined") {
    // Scrollbars, form controls and the overscroll area match too.
    document.documentElement.style.colorScheme = scheme;
    document.body.style.backgroundColor = THEMES[scheme].colors.canvas;
  }
}

/** Light, Espresso, or whatever the OS says: the Theme & Appearance setting, applied. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useThemePreference();
  const system = useColorScheme();
  const scheme = resolveScheme(preference, system);
  useLayoutEffect(() => applyScheme(preference, scheme), [preference, scheme]);
  return <ThemeContext.Provider value={THEMES[scheme]}>{children}</ThemeContext.Provider>;
}
