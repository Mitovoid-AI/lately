import { fireEvent, screen } from "@testing-library/react-native";

import { NOW } from "../../test/fixtures";
import { renderWithProviders } from "../../test/render";
import { CuratedScreen } from "../CuratedScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

test("shows the hero pick and every section", async () => {
  await renderWithProviders(<CuratedScreen />);
  expect(await screen.findByText("Curated for you")).toBeTruthy();
  expect(await screen.findByText("Sunday, 4 Oct · picked from your saves")).toBeTruthy();
  expect(screen.getByText("THIS WEEKEND")).toBeTruthy();
  expect(screen.getByText("3 cafes you saved and never visited")).toBeTruthy();
  expect(screen.getByText("Revisit · Dev & Tools")).toBeTruthy();
  expect(screen.getByText("From your note “trek in june”")).toBeTruthy();
  expect(screen.getByText("Forgotten gems")).toBeTruthy();
  expect(screen.getByText("Saved over a month ago")).toBeTruthy();
});

test("See all searches the hero's topic; cards open", async () => {
  await renderWithProviders(<CuratedScreen />);
  await fireEvent.press(await screen.findByText("See all 3"));
  expect(mockRouter.push).toHaveBeenCalledWith("/search?q=cafe");
  await fireEvent.press(screen.getByText("Drip coffee at home: the 3-minute recipe"));
  expect(mockRouter.push).toHaveBeenCalledWith("/reel/s-drip");
});
