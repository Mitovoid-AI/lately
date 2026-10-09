import { AccessibilityInfo } from "react-native";

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Tests run with reduced motion: looping animations (skeleton pulse) stay still.
jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);

// Reanimated's Jest mock: every animation lands on its final value at once (and fires its
// callback), layout animations are no-ops, Animated.View is a plain View.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => ({
  ...require("react-native-reanimated/mock"),
  useReducedMotion: () => true,
}));
/* eslint-enable @typescript-eslint/no-require-imports */
