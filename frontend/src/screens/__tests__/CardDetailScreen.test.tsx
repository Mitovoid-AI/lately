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
  expect(screen.getByText("READY • SYNCED")).toBeTruthy();
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
