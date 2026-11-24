import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { FONTS, PACKAGES } from "../../legal/licenses";
import { renderWithProviders } from "../../test/render";
import { LicensesScreen } from "../LicensesScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

test("lists the bundled fonts with their copyright, every library, and the full OFL text", async () => {
  await renderWithProviders(<LicensesScreen />);
  for (const family of ["Bricolage Grotesque", "Inter", "Lora", "Newsreader"]) expect(screen.getByText(family)).toBeTruthy();
  expect(screen.getByText(FONTS[0].copyright)).toBeTruthy();
  for (const p of PACKAGES) expect(screen.getByText(`${p.name} ${p.version}`)).toBeTruthy();
  expect(screen.getByText(/SIL OPEN FONT LICENSE Version 1\.1/)).toBeTruthy();
  expect(screen.getByText(/PERMISSION & CONDITIONS/)).toBeTruthy();
});

test("a library row opens its home page", async () => {
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const react = PACKAGES.find((p) => p.name === "react")!;
  await renderWithProviders(<LicensesScreen />);
  await fireEvent.press(screen.getByRole("link", { name: `react ${react.version}, ${react.license}` }));
  await waitFor(() => expect(openUrl).toHaveBeenCalledWith(react.url));
  openUrl.mockRestore();
});
