import { screen } from "@testing-library/react-native";

import { renderWithProviders } from "../../test/render";
import { OfflineBanner } from "../OfflineBanner";

test("shows while signed in on a session that couldn't be refreshed", async () => {
  await renderWithProviders(<OfflineBanner />, { auth: { offline: true } });
  expect(screen.getByText("You're offline. Showing what's on this phone.")).toBeTruthy();
});

test("is a polite live region, so a screen reader says it once when it appears", async () => {
  await renderWithProviders(<OfflineBanner />, { auth: { offline: true } });
  expect(screen.getByRole("alert").props.accessibilityLiveRegion).toBe("polite");
});

test("its text may wrap to two lines instead of being cut off", async () => {
  await renderWithProviders(<OfflineBanner />, { auth: { offline: true } });
  const text = screen.getByText("You're offline. Showing what's on this phone.");
  expect(text.props.numberOfLines).toBe(2);
  expect(text.props.maxFontSizeMultiplier).toBe(1.3);
});

test("hidden when online", async () => {
  await renderWithProviders(<OfflineBanner />, { auth: { offline: false } });
  expect(screen.queryByText("You're offline. Showing what's on this phone.")).toBeNull();
});
