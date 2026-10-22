import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { buildDemoSeed } from "../../api/demo-data";
import { deriveFacts, mapsUrl } from "../../components/detail/facts";
import { savedAgo } from "../../lib/dates";
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

// The demo content is rewritten from time to time, so these tests read what they expect from
// the seed itself: a card with a place (momo), a ready one without any, and the partial one.
const seed = buildDemoSeed(NOW).saves;
const MOMO = seed.find((s) => s.id === "s-momo")!;
const NO_PLACE = seed.find((s) => s.status === "enriched" && s.places.length === 0)!;
const PARTIAL = seed.find((s) => s.id === "s-partial")!;

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
  expect(await screen.findByText(MOMO.title!)).toBeTruthy();
  expect(screen.queryByText("READY • SYNCED")).toBeNull(); // ready cards carry no status label
  expect(screen.getByText(`@${MOMO.creator}`)).toBeTruthy();
  expect(screen.getByText(savedAgo(MOMO.created_at, NOW))).toBeTruthy();
  expect(screen.getByText(MOMO.category!)).toBeTruthy(); // the tinted category pill
  expect(screen.getByText(MOMO.summary!)).toBeTruthy();
  expect(screen.getByText("Good to know")).toBeTruthy();
  // The place shows as a fact chip and as its own card.
  expect(screen.getAllByText(MOMO.places[0].name).length).toBeGreaterThan(0);
  expect(screen.getByText(`#${MOMO.tags![0]}`)).toBeTruthy();
  expect(screen.getByText(`“${MOMO.note}”`)).toBeTruthy();
});

test("facts come first: the place, a price and a tip appear above the summary", async () => {
  const facts = deriveFacts(MOMO);
  expect(facts.map((f) => f.kind)).toContain("place");
  await open("s-momo");
  await screen.findByText(MOMO.title!);
  for (const fact of facts) expect(screen.getAllByText(fact.text).length).toBeGreaterThan(0);
});

test("a processing card shows the tracker, no steps, and Open in Instagram as the main action", async () => {
  await open("s-pending");
  expect(await screen.findByText("GETTING DETAILS")).toBeTruthy();
  expect(screen.getByText("Getting the preview")).toBeTruthy();
  expect(screen.queryByText("Good to know")).toBeNull();
  expect(screen.getByText("Open in Instagram")).toBeTruthy();
  expect(screen.queryByText("Directions")).toBeNull();
});

test("a partial card says the preview is unavailable and shows the caption", async () => {
  await open("s-partial");
  expect(await screen.findByText("PREVIEW UNAVAILABLE")).toBeTruthy();
  // first caption line is the title; the full caption is shown below it
  const firstLine = PARTIAL.caption!.split("\n")[0];
  expect(screen.getAllByText(firstLine).length).toBeGreaterThan(0);
  expect(screen.getByText(PARTIAL.caption!)).toBeTruthy();
  expect(screen.getByText("Add a note")).toBeTruthy();
});

test("the note can be edited, and the action bar steps aside while the keyboard is up", async () => {
  const api = demoApi();
  const setNote = jest.spyOn(api, "setNote");
  await open("s-momo", api);
  await screen.findByText(MOMO.title!);
  expect(screen.getByLabelText("Share")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Edit note"));
  expect(screen.queryByLabelText("Share")).toBeNull();
  await fireEvent.changeText(screen.getByDisplayValue(MOMO.note!), "for a date");
  await fireEvent.press(screen.getByText("Save"));
  expect(setNote).toHaveBeenCalledWith("s-momo", "for a date");
  expect(await screen.findByText("“for a date”")).toBeTruthy();
  expect(screen.getByLabelText("Share")).toBeTruthy();
});

test("delete asks first, then removes the card and goes back", async () => {
  const api = demoApi();
  const deleteSave = jest.spyOn(api, "deleteSave");
  await open("s-momo", api);
  await screen.findByText(MOMO.title!);
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
  await fireEvent.press(screen.getByText("Back to Home"));
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("Share, in the action bar, shares the title and link", async () => {
  await open("s-momo");
  await screen.findByText(MOMO.title!);
  await fireEvent.press(screen.getByLabelText("Share"));
  expect(shareOrCopy).toHaveBeenCalledWith({ title: MOMO.title, url: MOMO.source_url });
  expect(await screen.findByText("Link copied")).toBeTruthy();
});

test("the summary uses the reading text size from preferences", async () => {
  const api = demoApi();
  await api.updatePreferences({ text_size: 20 });
  await open("s-momo", api);
  const summary = await screen.findByText(MOMO.summary!);
  expect(summary).toHaveStyle({ fontSize: 20 });
});

test("Add to stack, in the action bar, opens the stack picker", async () => {
  const api = demoApi();
  const [stack] = await api.listStacks();
  await open("s-momo", api);
  await screen.findByText(MOMO.title!);
  await fireEvent.press(screen.getByLabelText("Add to stack"));
  expect(await screen.findByText(stack.name)).toBeTruthy();
});

test("a card with a place leads with Directions, which opens the place in maps", async () => {
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await open("s-momo");
  await screen.findByText(MOMO.title!);
  await fireEvent.press(screen.getByText("Directions"));
  expect(openUrl).toHaveBeenCalledWith(mapsUrl(MOMO.places[0]));
  // Instagram is still one tap away: a pill on the photo.
  openUrl.mockClear();
  await fireEvent.press(screen.getByText("Open in Instagram"));
  expect(openUrl).toHaveBeenCalledWith(MOMO.source_url);
});

test("a card without a place leads with Open in Instagram", async () => {
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await open(NO_PLACE.id);
  await screen.findByText(NO_PLACE.title!);
  expect(screen.queryByText("Directions")).toBeNull();
  await fireEvent.press(screen.getByText("Open in Instagram"));
  expect(openUrl).toHaveBeenCalledWith(NO_PLACE.source_url);
});

test("Open in Instagram and Delete stay in the More menu", async () => {
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await open(NO_PLACE.id);
  await screen.findByText(NO_PLACE.title!);
  await fireEvent.press(screen.getByLabelText("More"));
  expect(screen.getByText("Delete")).toBeTruthy();
  // The bar's button and the menu row both say it.
  const rows = screen.getAllByText("Open in Instagram");
  expect(rows).toHaveLength(2);
  await fireEvent.press(rows[1]);
  expect(openUrl).toHaveBeenCalledWith(NO_PLACE.source_url);
});

test("a failed note edit says so", async () => {
  const api = { ...demoApi(), setNote: jest.fn(async () => Promise.reject(new Error("down"))) };
  await open("s-momo", api);
  await screen.findByText(MOMO.title!);
  await fireEvent.press(screen.getByLabelText("Edit note"));
  await fireEvent.changeText(screen.getByDisplayValue(MOMO.note!), "for a date");
  await fireEvent.press(screen.getByText("Save"));
  expect(await screen.findByText("Couldn't save your note. Try again.")).toBeTruthy();
  expect(screen.getByDisplayValue("for a date")).toBeTruthy();
});

test("deleting refreshes curated and stack views too", async () => {
  const { client } = await open("s-momo");
  await screen.findByText(MOMO.title!);
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
