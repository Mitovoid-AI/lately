import { Platform } from "react-native";

import { appVersionLabel, ISSUES_URL, reportProblemUrl } from "../about";

const mockConfig: { expoConfig: Record<string, unknown> | null } = {
  expoConfig: { version: "1.0.0", android: { versionCode: 11 } },
};
jest.mock("expo-constants", () => ({
  __esModule: true,
  get default() {
    return mockConfig;
  },
}));

afterEach(() => jest.restoreAllMocks());

test("Android names the version and the build testers quote", () => {
  jest.replaceProperty(Platform, "OS", "android");
  expect(appVersionLabel()).toBe("Lately 1.0.0 (build 11)");
});

test("the web (no versionCode) names just the version", () => {
  jest.replaceProperty(Platform, "OS", "web");
  expect(appVersionLabel()).toBe("Lately 1.0.0");
});

test("with no support address, a problem is reported on GitHub", () => {
  expect(reportProblemUrl("")).toBe(ISSUES_URL);
});

test("with a support address, an email with the version filled in", () => {
  jest.replaceProperty(Platform, "OS", "android");
  const url = reportProblemUrl("help@example.com");
  expect(url.startsWith("mailto:help@example.com?subject=")).toBe(true);
  expect(decodeURIComponent(url)).toContain("Lately 1.0.0 (build 11)");
});
