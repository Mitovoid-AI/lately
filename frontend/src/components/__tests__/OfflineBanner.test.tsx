import { screen } from "@testing-library/react-native";

import { renderWithProviders } from "../../test/render";
import { OfflineBanner } from "../OfflineBanner";

test("shows while signed in on a session that couldn't be refreshed", async () => {
  await renderWithProviders(<OfflineBanner />, { auth: { offline: true } });
  expect(screen.getByText("You're offline. Showing what's on this phone.")).toBeTruthy();
});

test("hidden when online", async () => {
  await renderWithProviders(<OfflineBanner />, { auth: { offline: false } });
  expect(screen.queryByText("You're offline. Showing what's on this phone.")).toBeNull();
});
