import { fireEvent, screen } from "@testing-library/react-native";

import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { StackDetailScreen } from "../StackDetailScreen";
import { StacksScreen } from "../StacksScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const NAMES = ["Cafes to try", "Job hunt", "Manali trip", "Mobility routine", "Dev tools", "Outfit ideas"];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

test("lists every stack with its count", async () => {
  await renderWithProviders(<StacksScreen />);
  for (const name of NAMES) expect(await screen.findByText(name)).toBeTruthy();
  expect(screen.getByText("4 reels · updated 2d")).toBeTruthy();
  expect(screen.getByText("Your saves, grouped your way.")).toBeTruthy();
});

test("a new stack can be created", async () => {
  await renderWithProviders(<StacksScreen />);
  await screen.findByText("Cafes to try");
  await fireEvent.press(screen.getByText("+ New stack"));
  const create = screen.getByRole("button", { name: "Create" });
  expect(create).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Cafes to try"), "Trip");
  await fireEvent.press(screen.getByText("Create"));
  expect(await screen.findByText("Trip")).toBeTruthy();
  expect(screen.getByText("0 reels · updated Just now")).toBeTruthy();
});

test("a tile opens the stack", async () => {
  await renderWithProviders(<StacksScreen />);
  await fireEvent.press(await screen.findByText("Cafes to try"));
  expect(mockRouter.push).toHaveBeenCalledWith("/stack/st-cafes");
});

test("stack detail lists its reels", async () => {
  mockParams = { id: "st-cafes" };
  await renderWithProviders(<StackDetailScreen />);
  expect(await screen.findByText("Hole-in-the-wall momo spot in Koramangala")).toBeTruthy();
  expect(screen.getByText("4 reels")).toBeTruthy();
});

test("an empty stack says how to add to it", async () => {
  const api = demoApi();
  const trip = await api.createStack("Trip");
  mockParams = { id: trip.id };
  await renderWithProviders(<StackDetailScreen />, { api });
  expect(await screen.findByText("No reels here yet — add one from a card's bookmark.")).toBeTruthy();
});
