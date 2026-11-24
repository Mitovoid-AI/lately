import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { ApiError } from "../../api/contract";
import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { StackDetailScreen } from "../StackDetailScreen";
import { StacksScreen } from "../StacksScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), back: jest.fn(), canGoBack: () => true };
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

test("lists every stack with its count and its category as a word, not only a colour", async () => {
  await renderWithProviders(<StacksScreen />);
  for (const name of NAMES) expect(await screen.findByText(name)).toBeTruthy();
  expect(screen.getByText("4 saves · Food · updated 2d")).toBeTruthy();
  expect(screen.getByText("Your saves, grouped your way.")).toBeTruthy();
  // The tile reads as one thing to a screen reader, category included.
  expect(screen.getByLabelText("Food and coffee, 4 saves · Food · updated 2d")).toBeTruthy();
  expect(screen.getByText("Stacks").props.accessibilityRole).toBe("header");
});

test("with stacks the header button is the way to make one: no dashed tile", async () => {
  await renderWithProviders(<StacksScreen />);
  await screen.findByText("Food and coffee");
  expect(screen.queryByLabelText("New stack")).toBeNull();
  expect(screen.getByLabelText("Create a new stack")).toBeTruthy();
});

test("with no stacks the dashed tile shows, with one line on what a stack is", async () => {
  const api = { ...demoApi(), listStacks: async () => [] };
  await renderWithProviders(<StacksScreen />, { api });
  const tile = await screen.findByLabelText("New stack");
  expect(screen.getByText("Stacks group saves. Make one to start.")).toBeTruthy();
  expect(screen.queryByText("Create collection")).toBeNull();
  await fireEvent.press(tile);
  expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
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
  expect(screen.getByText("0 saves · updated Just now")).toBeTruthy();
});

test("a tile opens the stack", async () => {
  await renderWithProviders(<StacksScreen />);
  await fireEvent.press(await screen.findByText("Food and coffee"));
  expect(mockRouter.push).toHaveBeenCalledWith("/stack/st-cafes");
});

test("stack detail lists its saves", async () => {
  mockParams = { id: "st-cafes" };
  await renderWithProviders(<StackDetailScreen />);
  expect(await screen.findByText("Hole-in-the-wall momo spot in Jackson Heights")).toBeTruthy();
  expect(screen.getByText("4 saves")).toBeTruthy();
});

test("an empty stack says how to add to it", async () => {
  const api = demoApi();
  const trip = await api.createStack("Trip");
  mockParams = { id: trip.id };
  await renderWithProviders(<StackDetailScreen />, { api });
  expect(await screen.findByText("No saves here yet. Open a card and tap Add to stack.")).toBeTruthy();
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

test("a save can be removed from a stack in edit mode", async () => {
  mockParams = { id: "st-cafes" };
  const api = demoApi();
  const remove = jest.spyOn(api, "removeFromStack");
  await renderWithProviders(<StackDetailScreen />, { api });
  await screen.findByText("Hole-in-the-wall momo spot in Jackson Heights");
  await fireEvent.press(screen.getByText("Edit"));
  await fireEvent.press(screen.getByLabelText("Remove Hole-in-the-wall momo spot in Jackson Heights from this stack"));
  expect(remove).toHaveBeenCalledWith("st-cafes", "s-momo");
  expect(await screen.findByText("3 saves")).toBeTruthy();
  expect(screen.queryByText("Hole-in-the-wall momo spot in Jackson Heights")).toBeNull();
});

test("a stack can be deleted after confirming, and that returns to the Stacks tab underneath", async () => {
  mockParams = { id: "st-cafes" };
  const api = demoApi();
  const del = jest.spyOn(api, "deleteStack");
  await renderWithProviders(<StackDetailScreen />, { api });
  await screen.findByText("Hole-in-the-wall momo spot in Jackson Heights");
  await fireEvent.press(screen.getByLabelText("More"));
  await fireEvent.press(screen.getByText("Delete stack"));
  expect(screen.getByText("Delete “Food and coffee”?")).toBeTruthy();
  // A stack holds saves: one word for one thing.
  expect(screen.getByText("The stack goes away; the saves in it stay.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("st-cafes"));
  // Not a replace: that stacked a second copy of the tabs on top of the first.
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith("/stacks"));
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

describe("renaming a stack", () => {
  async function openRename(api = demoApi()) {
    mockParams = { id: "st-cafes" };
    const view = await renderWithProviders(<StackDetailScreen />, { api });
    await screen.findByText("Hole-in-the-wall momo spot in Jackson Heights");
    await fireEvent.press(screen.getByLabelText("More"));
    await fireEvent.press(screen.getByText("Rename"));
    return view;
  }

  test("the form starts with the name; Save stays off until it changes, and never empty", async () => {
    await openRename();
    expect(screen.getByText("Rename stack")).toBeTruthy();
    const field = screen.getByDisplayValue("Food and coffee");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await fireEvent.changeText(field, "   ");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await fireEvent.changeText(field, "Food and coffee ");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await fireEvent.changeText(field, "Coffee crawl");
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  test("saving renames it, closes the form and shows the new name", async () => {
    const api = demoApi();
    const rename = jest.spyOn(api, "renameStack");
    await openRename(api);
    await fireEvent.changeText(screen.getByDisplayValue("Food and coffee"), "  Coffee crawl ");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(rename).toHaveBeenCalledWith("st-cafes", "Coffee crawl");
    expect(await screen.findByText("Stack renamed")).toBeTruthy();
    // The stack's heading on this screen; the form is gone.
    expect(screen.getByRole("header", { name: "Coffee crawl" })).toBeTruthy();
    expect(screen.queryByText("Food and coffee")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Rename stack")).toBeNull());
  });

  test("the stacks list already loaded takes the new name at once", async () => {
    const api = demoApi();
    const { client } = await openRename(api);
    client.setQueryData(["stacks"], await api.listStacks());
    // Hold the refetch so what shows is the cache update itself.
    jest.spyOn(api, "listStacks").mockImplementation(() => new Promise(() => {}));
    await fireEvent.changeText(screen.getByDisplayValue("Food and coffee"), "Coffee crawl");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Stack renamed");
    const cached = client.getQueryData<{ id: string; name: string }[]>(["stacks"]);
    expect(cached?.find((st) => st.id === "st-cafes")?.name).toBe("Coffee crawl");
  });

  test("a failed rename says so on the form and keeps what was typed", async () => {
    const api = { ...demoApi(), renameStack: jest.fn(async () => Promise.reject(new ApiError("SERVER", 500))) };
    await openRename(api);
    await fireEvent.changeText(screen.getByDisplayValue("Food and coffee"), "Coffee crawl");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Couldn't rename the stack. Try again.")).toBeTruthy();
    expect(screen.getByDisplayValue("Coffee crawl")).toBeTruthy();
  });
});

test("an unknown stack says it isn't here anymore, with no retry", async () => {
  mockParams = { id: "st-nope" };
  await renderWithProviders(<StackDetailScreen />);
  expect(await screen.findByText("This stack isn't here anymore")).toBeTruthy();
  expect(screen.queryByText("Try again")).toBeNull();
});

test("a server problem is not 'gone': the stack offers Try again", async () => {
  mockParams = { id: "st-cafes" };
  const api = { ...demoApi(), getStack: async () => Promise.reject(new ApiError("SERVER", 404)) };
  await renderWithProviders(<StackDetailScreen />, { api });
  expect(await screen.findByText("Couldn't load this stack")).toBeTruthy();
  expect(screen.queryByText("This stack isn't here anymore")).toBeNull();
  expect(screen.getByText("Try again")).toBeTruthy();
});

test("a failed stack load shows an error with retry", async () => {
  mockParams = { id: "st-cafes" };
  const api = { ...demoApi(), getStack: async () => Promise.reject(new Error("down")) };
  await renderWithProviders(<StackDetailScreen />, { api });
  expect(await screen.findByText("Couldn't load this stack")).toBeTruthy();
  expect(screen.getByText("Try again")).toBeTruthy();
});
