import { AccessibilityInfo } from "react-native";

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Tests run with reduced motion: looping animations (skeleton pulse) stay still.
jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
