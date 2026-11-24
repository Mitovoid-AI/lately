import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import type * as DevicePrefsModule from "../devicePrefs";
import { DEFAULT_DEVICE_PREFS, DEVICE_PREFS_KEY, setDevicePref, useDevicePrefs } from "../devicePrefs";

/**
 * A fresh copy of the module and an emptied AsyncStorage, as on a cold start: the in-memory
 * copy is module state, so each test gets its own. `stored` is what is on the phone.
 */
async function fresh(stored?: string) {
  let prefs!: typeof DevicePrefsModule;
  let storage!: typeof AsyncStorage;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const mod = require("@react-native-async-storage/async-storage");
    storage = mod.default ?? mod; // the Jest mock is CommonJS
    prefs = require("../devicePrefs");
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  // The AsyncStorage mock is shared with the rest of this file: start it empty with no calls.
  await storage.clear();
  if (stored !== undefined) await storage.setItem(DEVICE_PREFS_KEY, stored);
  jest.mocked(storage.getItem).mockClear();
  jest.mocked(storage.setItem).mockClear();
  return { prefs, storage };
}

test("the defaults are ask after a share, haptics on", async () => {
  expect(DEFAULT_DEVICE_PREFS).toEqual({ afterShare: "ask", haptics: true });
  const { prefs } = await fresh();
  expect(prefs.devicePrefsSnapshot()).toEqual(DEFAULT_DEVICE_PREFS);
  expect(await prefs.loadDevicePrefs()).toEqual(DEFAULT_DEVICE_PREFS);
});

test("a setting is kept on the phone and read back on the next start", async () => {
  const first = await fresh();
  await first.prefs.setDevicePref("afterShare", "return");
  expect(first.prefs.devicePrefsSnapshot()).toEqual({ afterShare: "return", haptics: true });
  const saved = await first.storage.getItem(DEVICE_PREFS_KEY);
  expect(JSON.parse(saved!)).toEqual({ afterShare: "return", haptics: true });

  const next = await fresh(saved!);
  expect(next.prefs.devicePrefsSnapshot()).toEqual(DEFAULT_DEVICE_PREFS); // not read yet
  expect(await next.prefs.loadDevicePrefs()).toEqual({ afterShare: "return", haptics: true });
  expect(next.prefs.devicePrefsSnapshot()).toEqual({ afterShare: "return", haptics: true });
});

test.each([["{nope"], ["[1, 2]"], ["null"], ['"return"'], ['{"afterShare":"sideways","haptics":"yes"}']])(
  "corrupt or unknown storage (%s) reads as the defaults",
  async (stored) => {
    const { prefs } = await fresh(stored);
    expect(await prefs.loadDevicePrefs()).toEqual(DEFAULT_DEVICE_PREFS);
  },
);

test("one good field survives a bad one", async () => {
  const { prefs } = await fresh(JSON.stringify({ afterShare: 3, haptics: false, extra: "x" }));
  expect(await prefs.loadDevicePrefs()).toEqual({ afterShare: "ask", haptics: false });
});

test("storage is read only once", async () => {
  const { prefs, storage } = await fresh(JSON.stringify({ haptics: false }));
  await Promise.all([prefs.loadDevicePrefs(), prefs.loadDevicePrefs()]);
  await prefs.loadDevicePrefs();
  expect(jest.mocked(storage.getItem)).toHaveBeenCalledTimes(1);
});

test("a setting changed before the stored copy is read wins, and the other stored setting is kept", async () => {
  const { prefs, storage } = await fresh(JSON.stringify({ afterShare: "return", haptics: true }));
  const write = prefs.setDevicePref("haptics", false);
  // The screen sees the change at once, before storage answers.
  expect(prefs.devicePrefsSnapshot().haptics).toBe(false);
  await write;
  expect(prefs.devicePrefsSnapshot()).toEqual({ afterShare: "return", haptics: false });
  expect(JSON.parse((await storage.getItem(DEVICE_PREFS_KEY))!)).toEqual({ afterShare: "return", haptics: false });
});

test("a storage that throws still gives the defaults and accepts changes in memory", async () => {
  const { prefs, storage } = await fresh();
  jest.mocked(storage.getItem).mockRejectedValueOnce(new Error("unavailable"));
  jest.mocked(storage.setItem).mockRejectedValueOnce(new Error("unavailable"));
  expect(await prefs.loadDevicePrefs()).toEqual(DEFAULT_DEVICE_PREFS);
  await expect(prefs.setDevicePref("haptics", false)).resolves.toBeUndefined();
  expect(prefs.devicePrefsSnapshot().haptics).toBe(false);
});

// The module imported at the top is used only here, so its in-memory copy starts empty.
test("useDevicePrefs loads the stored settings and re-renders when one changes", async () => {
  await AsyncStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify({ afterShare: "return" }));
  const { result, unmount } = await renderHook(() => useDevicePrefs());
  await waitFor(() => expect(result.current.afterShare).toBe("return"));
  expect(result.current.haptics).toBe(true);
  await act(() => setDevicePref("haptics", false));
  expect(result.current).toEqual({ afterShare: "return", haptics: false });
  await unmount();
  // No subscriber left: setting it again must not throw.
  await setDevicePref("haptics", true);
});
