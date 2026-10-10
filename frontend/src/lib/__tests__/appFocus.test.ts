import { focusManager } from "@tanstack/react-query";
import { AppState } from "react-native";

import { wireAppFocus } from "../appFocus";

test("React Query's focus follows AppState, so polling pauses in the background", () => {
  const addListener = AppState.addEventListener as unknown as jest.Mock;
  const before = addListener.mock.calls.length;
  wireAppFocus();
  const listeners = addListener.mock.calls
    .slice(before)
    .filter(([type]) => type === "change")
    .map(([, fn]) => fn as (s: string) => void);
  expect(listeners.length).toBeGreaterThan(0);
  listeners.forEach((fn) => fn("background"));
  expect(focusManager.isFocused()).toBe(false);
  listeners.forEach((fn) => fn("active"));
  expect(focusManager.isFocused()).toBe(true);
});
