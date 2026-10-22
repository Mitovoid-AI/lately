import { Linking, Platform } from "react-native";

import { openInstagram } from "../openInstagram";

// react-native's jest setup already makes Linking.openURL a mock, so a spy on it is that same mock
// and its calls would carry over from one test to the next.
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test("on a phone it opens the Instagram app", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await openInstagram();
  expect(openURL).toHaveBeenCalledTimes(1);
  expect(openURL).toHaveBeenCalledWith("instagram://");
});

test("without the app installed it opens instagram.com instead", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockRejectedValueOnce(new Error("no app")).mockResolvedValue(true);
  await openInstagram();
  expect(openURL.mock.calls.map((c) => c[0])).toEqual(["instagram://", "https://instagram.com"]);
});

test("on the web there is no app to try: it goes straight to instagram.com", async () => {
  const os = jest.replaceProperty(Platform, "OS", "web");
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await openInstagram();
  expect(openURL.mock.calls.map((c) => c[0])).toEqual(["https://instagram.com"]);
  os.restore();
});

test("if nothing can open it, it fails quietly", async () => {
  jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("nothing"));
  await expect(openInstagram()).resolves.toBeUndefined();
});
