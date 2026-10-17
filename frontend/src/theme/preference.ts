import { useSyncExternalStore } from "react";

import { deviceStore, type KeyValueStore } from "../lib/storage";

export type ThemePreference = "light" | "dark" | "system";

/**
 * The theme this device shows, kept on the phone so the first frame (and the sign-in screen)
 * is already in the right colours. The account's saved preference overwrites it once loaded.
 */
export const THEME_KEY = "lately.theme";

let current: ThemePreference = "light";
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Reads the stored theme once at startup; a missing or unreadable value stays light. */
export async function loadThemePreference(store: KeyValueStore = deviceStore): Promise<void> {
  try {
    const stored = await store.getItem(THEME_KEY);
    if (isPreference(stored)) current = stored;
  } catch {
    // Storage can be unavailable (private browsing); the app starts light.
  }
  loaded = true;
  emit();
}

export function getThemePreference(): ThemePreference {
  return current;
}

export function setThemePreference(next: ThemePreference, store: KeyValueStore = deviceStore): void {
  if (!isPreference(next) || next === current) return;
  current = next;
  emit();
  store.setItem(THEME_KEY, next).catch(() => {});
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, getThemePreference);
}

/** True once the stored theme has been read (the root layout waits for it, like the fonts). */
export function useThemeLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded, () => loaded);
}
