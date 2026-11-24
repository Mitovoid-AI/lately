import { BackHandler, Platform } from "react-native";

import { canReturnToSharer, returnToSharer } from "../returnToSharer";

afterEach(() => jest.restoreAllMocks());

test("on Android, going back to the sharing app runs the default Back (Lately's task moves behind it)", () => {
  jest.replaceProperty(Platform, "OS", "android");
  const exitApp = jest.spyOn(BackHandler, "exitApp").mockImplementation(() => {});
  expect(canReturnToSharer()).toBe(true);
  returnToSharer();
  expect(exitApp).toHaveBeenCalledTimes(1);
});

test.each(["ios", "web"] as const)("on %s there is no app to go back to: nothing happens", (os) => {
  jest.replaceProperty(Platform, "OS", os);
  const exitApp = jest.spyOn(BackHandler, "exitApp").mockImplementation(() => {});
  expect(canReturnToSharer()).toBe(false);
  returnToSharer();
  expect(exitApp).not.toHaveBeenCalled();
});
