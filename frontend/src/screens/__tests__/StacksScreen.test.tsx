import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { StackDetailScreen } from "../StackDetailScreen";
import { StacksScreen } from "../StacksScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Link: require("../../test/expoRouterMock").mockLink(() => mockRouter),
}));

const NAMES = ["Food and coffee", "Job hunt", "Pacific Northwest trip", "Mobility routine", "Dev tools", "Outfit ideas"];

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
  await screen.findByText("Food and coffee");
  await fireEvent.press(screen.getByLabelText("Create a new stack"));
  const create = screen.getByRole("button", { name: "Create" });
  expect(create).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Cafes to try"), "Trip");
  await fireEvent.press(screen.getByText("Create"));
  expect(await screen.findByText("Trip")).toBeTruthy();
  expect(screen.getByText("0 reels · updated Just now")).toBeTruthy();
});

test("a tile opens the stack", async () => {
  await renderWithProviders(<StacksScreen />);
  await fireEvent.press(await screen.findByText("Food and coffee"));
  expect(mockRouter.push).toHaveBeenCalledWith("/stack/st-cafes");
});

test("stack detail lists its reels", async () => {
  mockParams = { id: "st-cafes" };
  await renderWithProviders(<StackDetailScreen />);
  expect(await screen.findByText("Hole-in-the-wall momo spot in Jackson Heights")).toBeTruthy();
  expect(screen.getByText("4 reels")).toBeTruthy();
});

test("an empty stack says how to add to it", async () => {
  const api = demoApi();
  const trip = await api.createStack("Trip");
  mockParams = { id: trip.id };
  await renderWithProviders(<StackDetailScreen />, { api });
  expect(await screen.findByText("No reels here yet. Add one from a card's bookmark.")).toBeTruthy();
});

test("a failed stacks load shows an error with retry", async () => {
  const api = { ...demoApi(), listStacks: async () => Promise.reject(new Error("down")) };
  await renderWithProviders(<StacksScreen />, { api });
  expect(await screen.findByText("Couldn't load your stacks")).toBeTruthy();
  expect(screen.getByText("Try again")).toBeTruthy();
});

test("pressing Enter twice creates one stack", async () => {
  const api = demoApi();
  const createStack = jest.spyOn(api, "createStack");
  await renderWithProviders(<StacksScreen />, { api });
  await screen.findByText("Food and coffee");
  await fireEvent.press(screen.getByLabelText("Create a new stack"));
  const input = screen.getByPlaceholderText("e.g. Cafes to try");
  await fireEvent.changeText(input, "Trip");
  await fireEvent(input, "submitEditing");
  await fireEvent(input, "submitEditing");
  expect(await screen.findByText("Trip")).toBeTruthy();
  expect(createStack).toHaveBeenCalledTimes(1);
});

test("a reel can be removed from a stack in edit mode", async () => {
  mockParams = { id: "st-cafes" };
  const api = demoApi();
  const remove = jest.spyOn(api, "removeFromStack");
  await renderWithProviders(<StackDetailScreen />, { api });
  await screen.findByText("Hole-in-the-wall momo spot in Jackson Heights");
  await fireEvent.press(screen.getByText("Edit"));
  await fireEvent.press(screen.getByLabelText("Remove Hole-in-the-wall momo spot in Jackson Heights"));
  expect(remove).toHaveBeenCalledWith("st-cafes", "s-momo");
  expect(await screen.findByText("3 reels")).toBeTruthy();
  expect(screen.queryByText("Hole-in-the-wall momo spot in Jackson Heights")).toBeNull();
});

test("a stack can be deleted after confirming", async () => {
  mockParams = { id: "st-cafes" };
  const api = demoApi();
  const del = jest.spyOn(api, "deleteStack");
  await renderWithProviders(<StackDetailScreen />, { api });
  await screen.findByText("Hole-in-the-wall momo spot in Jackson Heights");
  await fireEvent.press(screen.getByLabelText("Delete stack"));
  expect(screen.getByText("Delete “Food and coffee”?")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("st-cafes"));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/stacks"));
});

test("a failed stack load shows an error with retry", async () => {
  mockParams = { id: "st-cafes" };
  const api = { ...demoApi(), getStack: async () => Promise.reject(new Error("down")) };
  await renderWithProviders(<StackDetailScreen />, { api });
  expect(await screen.findByText("Couldn't load this stack")).toBeTruthy();
  expect(screen.getByText("Try again")).toBeTruthy();
});
