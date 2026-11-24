// Settings kept on this phone only. They are not account data: signing out leaves them alone.
import { useSyncExternalStore } from "react";

import { deviceStore, readJson, writeJson } from "./storage";

export interface DevicePrefs {
  /** After a share is saved: ask what to do next, or go straight back to the app it came from. */
  afterShare: "ask" | "return";
  /** Whether the app plays haptics at all. */
  haptics: boolean;
}

export const DEFAULT_DEVICE_PREFS: DevicePrefs = { afterShare: "ask", haptics: true };

export const DEVICE_PREFS_KEY = "lately.devicePrefs";

let current: DevicePrefs = DEFAULT_DEVICE_PREFS;
// What was set before the stored copy was read; it wins over the stored copy.
let pending: Partial<DevicePrefs> = {};
let loading: Promise<DevicePrefs> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Only the fields and values this app knows; anything else reads as its default. */
function clean(raw: unknown): DevicePrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    afterShare: r.afterShare === "return" ? "return" : DEFAULT_DEVICE_PREFS.afterShare,
    haptics: typeof r.haptics === "boolean" ? r.haptics : DEFAULT_DEVICE_PREFS.haptics,
  };
}

/** Reads the stored settings once (missing or corrupt storage reads as the defaults). */
export function loadDevicePrefs(): Promise<DevicePrefs> {
  loading ??= readJson<unknown>(deviceStore, DEVICE_PREFS_KEY, null).then((raw) => {
    current = { ...clean(raw), ...pending };
    pending = {};
    emit();
    return current;
  });
  return loading;
}

/** The settings right now: the defaults until the stored copy has been read. */
export function devicePrefsSnapshot(): DevicePrefs {
  return current;
}

export async function setDevicePref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]): Promise<void> {
  current = { ...current, [key]: value };
  pending = { ...pending, [key]: value };
  emit();
  // Write only once the stored copy is in, so the other setting is never reset to its default.
  await loadDevicePrefs();
  await writeJson(deviceStore, DEVICE_PREFS_KEY, current);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void loadDevicePrefs();
  return () => {
    listeners.delete(listener);
  };
}

/** The settings, re-rendering when one changes; the first use reads them from storage. */
export function useDevicePrefs(): DevicePrefs {
  return useSyncExternalStore(subscribe, devicePrefsSnapshot, devicePrefsSnapshot);
}
