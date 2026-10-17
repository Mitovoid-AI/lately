import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { shareOrCopy } from "../../lib/share";
import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { CardDetailScreen } from "../CardDetailScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Link: require("../../test/expoRouterMock").mockLink(() => mockRouter),
}));
jest.mock("../../lib/share", () => ({ shareOrCopy: jest.fn(async () => "copied") }));

const MOMO = "Hole-in-the-wall momo spot in Koramangala";

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

async function open(id: string, api = demoApi()) {
  mockParams = { id };
  return renderWithProviders(<CardDetailScreen />, { api });
}

test("a ready card shows everything the reel has", async () => {
  await open("s-momo");
  expect(await screen.findByText(MOMO)).toBeTruthy();
  expect(screen.queryByText("READY • SYNCED")).toBeNull(); // ready cards carry no status label
  expect(screen.getByText("@bangalorefoodie")).toBeTruthy();
  expect(screen.getByText("Saved 5 days ago")).toBeTruthy();
  expect(screen.getByText("Cash only")).toBeTruthy();
  expect(screen.getByText("Momo Point")).toBeTruthy();
  expect(screen.getByText("#momos")).toBeTruthy();
  expect(screen.getByText("“cafe to try”")).toBeTruthy();
});

test("a processing card shows the tracker and no summary", async () => {
  await open("s-pending");
  expect(await screen.findByText("GETTING DETAILS")).toBeTruthy();
  expect(screen.getByText("Getting the preview")).toBeTruthy();
  expect(screen.queryByText("SUMMARY")).toBeNull();
});

test("a partial card says the preview is unavailable and shows the caption", async () => {
  await open("s-partial");
  expect(await screen.findByText("PREVIEW UNAVAILABLE")).toBeTruthy();
  // first caption line is the title; the full caption is shown below it
  expect(screen.getByText("Day 3 of the 30-day mobility challenge…")).toBeTruthy();
  expect(screen.getByText(/Hips and thoracic spine today/)).toBeTruthy();
  expect(screen.getByText("Add a note")).toBeTruthy();
});

test("the note can be edited", async () => {
  const api = demoApi();
  const setNote = jest.spyOn(api, "setNote");
  await open("s-momo", api);
  await screen.findByText(MOMO);
  await fireEvent.press(screen.getByLabelText("Edit note"));
  await fireEvent.changeText(screen.getByDisplayValue("cafe to try"), "for a date");
  await fireEvent.press(screen.getByText("Save"));
  expect(setNote).toHaveBeenCalledWith("s-momo", "for a date");
  expect(await screen.findByText("“for a date”")).toBeTruthy();
});

test("delete asks first, then removes the card and goes back", async () => {
  const api = demoApi();
  const deleteSave = jest.spyOn(api, "deleteSave");
  await open("s-momo", api);
  await screen.findByText(MOMO);
  await fireEvent.press(screen.getByLabelText("More"));
  await fireEvent.press(screen.getByText("Delete"));
  expect(screen.getByText("Delete this reel?")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(deleteSave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("More"));
  await fireEvent.press(screen.getByText("Delete"));
  await fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(deleteSave).toHaveBeenCalledWith("s-momo"));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
});

test("an unknown card shows the not-found state", async () => {
  await open("nope");
  expect(await screen.findByText("This card isn't here anymore")).toBeTruthy();
  await fireEvent.press(screen.getByText("Back to Library"));
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("Export shares the title and link", async () => {
  await open("s-momo");
  await screen.findByText(MOMO);
  await fireEvent.press(screen.getByText("Export"));
  expect(shareOrCopy).toHaveBeenCalledWith({ title: MOMO, url: "https://www.instagram.com/reel/MomoPt1/" });
});

test("the summary uses the reading text size from preferences", async () => {
  const api = demoApi();
  await api.updatePreferences({ text_size: 20 });
  await open("s-momo", api);
  const summary = await screen.findByText(/A cozy hidden gem/);
  expect(summary).toHaveStyle({ fontSize: 20 });
});

test("the bookmark opens the stack picker", async () => {
  await open("s-momo");
  await screen.findByText(MOMO);
  await fireEvent.press(screen.getByLabelText("Add to stack"));
  expect(await screen.findByText("Cafes to try")).toBeTruthy();
});

test("a failed note edit says so", async () => {
  const api = { ...demoApi(), setNote: jest.fn(async () => Promise.reject(new Error("down"))) };
  await open("s-momo", api);
  await screen.findByText(MOMO);
  await fireEvent.press(screen.getByLabelText("Edit note"));
  await fireEvent.changeText(screen.getByDisplayValue("cafe to try"), "for a date");
  await fireEvent.press(screen.getByText("Save"));
  expect(await screen.findByText("Couldn't save your note. Try again.")).toBeTruthy();
  expect(screen.getByDisplayValue("for a date")).toBeTruthy();
});

test("deleting refreshes curated and stack views too", async () => {
  const { client } = await open("s-momo");
  await screen.findByText(MOMO);
  client.setQueryData(["curated"], { cached: true });
  client.setQueryData(["stack", "st-cafes"], { cached: true });
  await fireEvent.press(screen.getByLabelText("More"));
  await fireEvent.press(screen.getByText("Delete"));
  await fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(client.getQueryState(["curated"])?.isInvalidated).toBe(true));
  expect(client.getQueryState(["stack", "st-cafes"])?.isInvalidated).toBe(true);
});

test("a partial card can retry getting its details", async () => {
  const api = demoApi();
  const retry = jest.spyOn(api, "retryEnrichment");
  await open("s-partial", api);
  expect(await screen.findByText("PREVIEW UNAVAILABLE")).toBeTruthy();
  await fireEvent.press(screen.getByText("Try getting details again"));
  expect(retry).toHaveBeenCalledWith("s-partial");
  expect(await screen.findByText("GETTING DETAILS")).toBeTruthy();
});

test("a card still processing after 10 minutes offers Try again", async () => {
  const base = demoApi();
  const stuck = { ...(await base.getSave("s-pending")), created_at: new Date(NOW - 11 * 60_000).toISOString() };
  const api = { ...base, getSave: jest.fn(async () => stuck) };
  const retry = jest.spyOn(api, "retryEnrichment");
  await open("s-pending", api);
  expect(await screen.findByText("This is taking longer than usual. Lately can try again.")).toBeTruthy();
  await fireEvent.press(screen.getByText("Try getting details again"));
  expect(retry).toHaveBeenCalledWith("s-pending");
});

test("a young processing card does not offer a retry", async () => {
  await open("s-pending");
  expect(await screen.findByText("GETTING DETAILS")).toBeTruthy();
  expect(screen.queryByText("Try getting details again")).toBeNull();
});

test("a failed retry says so", async () => {
  const api = { ...demoApi(), retryEnrichment: jest.fn(async () => Promise.reject(new Error("down"))) };
  await open("s-partial", api);
  await fireEvent.press(await screen.findByText("Try getting details again"));
  expect(await screen.findByText("Couldn't retry. Try again later.")).toBeTruthy();
});
