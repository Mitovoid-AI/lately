import * as Haptics from "expo-haptics";

import { setDevicePref } from "../devicePrefs";
import { haptic } from "../haptics";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));

const fired = () =>
  (Haptics.selectionAsync as jest.Mock).mock.calls.length +
  (Haptics.impactAsync as jest.Mock).mock.calls.length +
  (Haptics.notificationAsync as jest.Mock).mock.calls.length;

const everyKind = () => {
  haptic.selection();
  haptic.light();
  haptic.medium();
  haptic.success();
  haptic.error();
};

beforeEach(() => jest.clearAllMocks());

test("haptics play while Vibration is on (the default)", () => {
  everyKind();
  expect(fired()).toBe(5);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
});

test("Vibration off silences every kind, and turning it back on brings them back", async () => {
  await setDevicePref("haptics", false);
  everyKind();
  expect(fired()).toBe(0);
  await setDevicePref("haptics", true);
  haptic.light();
  expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
});
