import { fireEvent, screen } from "@testing-library/react-native";

import { NOW } from "../../test/fixtures";
import { renderWithProviders } from "../../test/render";
import { CuratedScreen } from "../CuratedScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Link: require("../../test/expoRouterMock").mockLink(() => mockRouter),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

// Curated left the tab bar: it is a stack screen opened from Home's "See all".

test("it has a back button and no Stacks shortcut", async () => {
  await renderWithProviders(<CuratedScreen />);
  expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  expect(screen.queryByLabelText("Stacks")).toBeNull();
});

test("back returns to where it was opened from", async () => {
  await renderWithProviders(<CuratedScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test("opened cold (a link, no history), back goes Home", async () => {
  mockCanGoBack = false;
  await renderWithProviders(<CuratedScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});
