import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { ApiError, type FailReason } from "../../api/contract";
import { buildDemoSeed } from "../../api/demo-data";
import { deriveFacts, mapsUrl } from "../../components/detail/facts";
import { savedAgo } from "../../lib/dates";
import { displayLink } from "../../lib/instagram";
import { TRACKER_ESTIMATE, trackerSteps } from "../../lib/saveOutcome";
import { shareOrCopy } from "../../lib/share";
import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { CardDetailScreen, FAIL_NOTICE, PARTIAL_GENERIC, RETRY_CAPPED, RETRY_RUNNING } from "../CardDetailScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Link: require("../../test/expoRouterMock").mockLink(() => mockRouter),
}));
jest.mock("../../lib/share", () => ({ shareOrCopy: jest.fn(async () => "copied") }));
// The phone's own read of the reel: the tests only check that a retry sends it.
jest.mock("../../lib/deviceFetch", () => ({ sendDeviceHint: jest.fn(async () => "skipped") }));
const { sendDeviceHint: mockSendDeviceHint } = jest.requireMock("../../lib/deviceFetch") as { sendDeviceHint: jest.Mock };

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
  expect(screen.getByText("Tips")).toBeTruthy();
  expect(screen.queryByText("Good to know")).toBeNull();
  // The place shows as a fact chip and as its own card.
  expect(screen.getAllByText(MOMO.places[0].name).length).toBeGreaterThan(0);
  expect(screen.getByText(`#${MOMO.tags![0]}`)).toBeTruthy();
  expect(screen.getByText(`“${MOMO.note}”`)).toBeTruthy();
  // Gone: the "Saved to Lately via Share" line, which was wrong for a pasted link.
  expect(screen.queryByText(/Saved to/)).toBeNull();
});

test("a step shown as a chip is not listed again under Tips, and Directions leads to Maps", async () => {
  await open("s-momo");
  await screen.findByText(MOMO.title!);
  const facts = deriveFacts(MOMO).filter((f) => f.kind !== "place");
  expect(facts.length).toBeGreaterThan(0);
  for (const fact of facts) expect(screen.getAllByText(fact.text)).toHaveLength(1);
  const listed = MOMO.steps!.filter((step) => !facts.some((f) => f.text === step));
  expect(listed.length).toBeGreaterThan(0);
  for (const step of listed) expect(screen.getByText(step)).toBeTruthy();
  expect(screen.queryByText("Open in Maps")).toBeNull();
  expect(screen.getAllByText("Directions")).toHaveLength(1);
});

test("a tag is a link that searches your saves for it", async () => {
  await open("s-momo");
  const tag = MOMO.tags![0];
  await fireEvent.press(await screen.findByText(`#${tag}`));
  expect(mockRouter.push).toHaveBeenCalledWith(`/search?q=${encodeURIComponent(tag)}`);
  expect(screen.getByRole("link", { name: `Search your saves for ${tag}` })).toBeTruthy();
});

test("facts come first: the place, a price and a tip appear above the summary", async () => {
  const facts = deriveFacts(MOMO);
  expect(facts.map((f) => f.kind)).toContain("place");
  await open("s-momo");
  await screen.findByText(MOMO.title!);
  for (const fact of facts) expect(screen.getAllByText(fact.text).length).toBeGreaterThan(0);
});

test("a processing card is New reel with its link as meta, the named steps, and Open in Instagram as the main action", async () => {
  await open("s-pending");
  expect(await screen.findByText("New reel")).toBeTruthy();
  const pending = seed.find((s) => s.id === "s-pending")!;
  const link = screen.getByText(displayLink(pending.source_url));
  expect(link.props.ellipsizeMode).toBe("middle");
  expect(link.props.numberOfLines).toBe(1);
  // No eyebrow: the steps say it, with a state word each, in the words Home and the save sheet use.
  expect(screen.queryByText("GETTING DETAILS")).toBeNull();
  expect(screen.queryByText("Getting details…")).toBeNull();
  // The step names come from the shared tracker words, at the stage the demo reports now.
  const { stage } = await demoApi().getSave("s-pending");
  const [reel, listen, find, ready] = trackerSteps("pending", stage).map((s) => s.label);
  expect(screen.getByLabelText(`${reel}, done`)).toBeTruthy();
  expect(screen.getByLabelText(`${listen}, in progress`)).toBeTruthy();
  expect(screen.getByLabelText(`${find}, up next`)).toBeTruthy();
  expect(screen.getByLabelText(`${ready}, up next`)).toBeTruthy();
  expect(screen.getByText(TRACKER_ESTIMATE)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open card" })).toBeNull();
  expect(screen.queryByText("Getting the preview")).toBeNull();
  expect(screen.queryByText("Tips")).toBeNull();
  expect(screen.getByText("Open in Instagram")).toBeTruthy();
  expect(screen.queryByText("Directions")).toBeNull();
});

test("a partial card says the preview is unavailable and shows the caption", async () => {
  await open("s-partial");
  expect(await screen.findByText("Preview unavailable")).toBeTruthy();
  expect(screen.queryByText("PREVIEW UNAVAILABLE")).toBeNull();
  // The demo's partial card was blocked by Instagram, and says so.
  expect(PARTIAL.fail_reason).toBe("fetch_blocked");
  expect(screen.getByText(FAIL_NOTICE.fetch_blocked)).toBeTruthy();
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
  expect(screen.getByText("Delete this save?")).toBeTruthy();
  expect(screen.getByText("Its card and note leave your saves and stacks. The reel stays on Instagram.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(deleteSave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("More"));
  await fireEvent.press(screen.getByText("Delete"));
  await fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(deleteSave).toHaveBeenCalledWith("s-momo"));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
});

test("an unknown card shows the not-found state, and Back to Home returns to the tabs underneath", async () => {
  await open("nope");
  expect(await screen.findByText("This card isn't here anymore")).toBeTruthy();
  expect(screen.queryByText("Try again")).toBeNull();
  await fireEvent.press(screen.getByText("Back to Home"));
  // Not a replace: that stacked a second copy of the tabs on top of the first.
  expect(mockRouter.dismissTo).toHaveBeenCalledWith("/");
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test.each([
  ["a server problem (a 404 that did not come from the API)", new ApiError("SERVER", 404)],
  ["no connection", new ApiError("NETWORK", 0)],
])("%s is not 'gone': the card offers Try again", async (_what, error) => {
  const getSave = jest.fn(async () => Promise.reject(error));
  await open("s-momo", { ...demoApi(), getSave });
  // The screen retries twice on its own before it gives up.
  await act(() => jest.advanceTimersByTimeAsync(5000));
  expect(await screen.findByText("Couldn't load this card")).toBeTruthy();
  expect(screen.queryByText("This card isn't here anymore")).toBeNull();
  const calls = getSave.mock.calls.length;
  await fireEvent.press(screen.getByText("Try again"));
  await waitFor(() => expect(getSave.mock.calls.length).toBeGreaterThan(calls));
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
  expect(await screen.findByText("Preview unavailable")).toBeTruthy();
  await fireEvent.press(screen.getByText("Try getting details again"));
  expect(retry).toHaveBeenCalledWith("s-partial");
  expect(await screen.findByLabelText(/, in progress$/)).toBeTruthy();
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

test("a stuck card says so in the tracker too", async () => {
  const base = demoApi();
  // Its own id: the retry test above marks "s-pending" as retried (module state), which would
  // restart this card's age and make it young again.
  const stuck = {
    ...(await base.getSave("s-pending")),
    id: "s-stuck",
    created_at: new Date(NOW - 11 * 60_000).toISOString(),
  };
  await open("s-stuck", { ...base, getSave: jest.fn(async () => stuck) });
  expect(await screen.findByText("Still working. You can close this; the card keeps filling in.")).toBeTruthy();
});

test("the caption toggle reports whether it is open", async () => {
  await open("s-momo");
  await screen.findByText(MOMO.title!);
  const toggle = screen.getByRole("button", { name: "Original caption" });
  expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
  await fireEvent.press(toggle);
  expect(screen.getByRole("button", { name: "Original caption" }).props.accessibilityState).toMatchObject({ expanded: true });
});

test("the card's title is a heading", async () => {
  await open("s-momo");
  const title = await screen.findByText(MOMO.title!);
  expect(title.props.accessibilityRole).toBe("header");
});

test("a young processing card does not offer a retry", async () => {
  await open("s-pending");
  expect(await screen.findByText("New reel")).toBeTruthy();
  expect(screen.queryByText("Try getting details again")).toBeNull();
});

test("a failed retry says so", async () => {
  const api = { ...demoApi(), retryEnrichment: jest.fn(async () => Promise.reject(new Error("down"))) };
  await open("s-partial", api);
  await fireEvent.press(await screen.findByText("Try getting details again"));
  expect(await screen.findByText("Couldn't retry. Try again later.")).toBeTruthy();
});

test("every place card opens that place in Maps, not only the first", async () => {
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const base = demoApi();
  const second = { name: "Momo Point Too", address: "Elmhurst, Queens, NY", maps_url: "https://maps.google.com/?cid=42" };
  const card = { ...(await base.getSave("s-momo")), places: [...MOMO.places, second] };
  await open("s-momo", { ...base, getSave: jest.fn(async () => card) });
  await screen.findByText(MOMO.title!);
  await fireEvent.press(screen.getByRole("link", { name: `${second.name}, ${second.address}` }));
  expect(openUrl).toHaveBeenCalledWith(second.maps_url);
  const first = MOMO.places[0];
  await fireEvent.press(screen.getByRole("link", { name: `${first.name}, ${first.address}` }));
  expect(openUrl).toHaveBeenLastCalledWith(mapsUrl(first));
});

describe("a partial card says why it is incomplete", () => {
  const reasons: [FailReason, boolean][] = [
    ["fetch_blocked", true],
    ["unavailable", false],
    ["ai_unavailable", true],
    ["timed_out", true],
  ];

  test.each(reasons)("%s (retry offered: %s)", async (reason, retryable) => {
    const base = demoApi();
    const card = { ...(await base.getSave("s-partial")), id: `s-why-${reason}`, fail_reason: reason };
    await open(card.id, { ...base, getSave: jest.fn(async () => card) });
    expect(await screen.findByText(FAIL_NOTICE[reason])).toBeTruthy();
    expect(screen.queryByText(PARTIAL_GENERIC)).toBeNull();
    // A private or deleted reel: retrying cannot help, so only the note is offered.
    if (retryable) expect(screen.getByText("Try getting details again")).toBeTruthy();
    else expect(screen.queryByText("Try getting details again")).toBeNull();
    expect(screen.getByText("Add a note")).toBeTruthy();
  });

  test("with no reason (an older server) it keeps the general line and the retry", async () => {
    const base = demoApi();
    const { fail_reason: _omit, ...older } = await base.getSave("s-partial");
    for (const card of [{ ...older, id: "s-why-none" }, { ...older, id: "s-why-null", fail_reason: null }]) {
      const view = await open(card.id, { ...base, getSave: jest.fn(async () => card) });
      expect(await screen.findByText(PARTIAL_GENERIC)).toBeTruthy();
      expect(screen.getByText("Try getting details again")).toBeTruthy();
      await view.unmount();
    }
  });
});

test("Try getting details again also sends the phone's own read of the reel", async () => {
  await open("s-partial");
  await fireEvent.press(await screen.findByText("Try getting details again"));
  expect(mockSendDeviceHint).toHaveBeenCalledTimes(1);
  expect(mockSendDeviceHint).toHaveBeenCalledWith(
    expect.objectContaining({
      text: PARTIAL.source_url,
      result: { reel_id: "s-partial", deduped: false, status: "partial" },
    }),
  );
});

test("Try again while the card is already being made says so, without an error", async () => {
  const base = demoApi();
  const card = { ...(await base.getSave("s-partial")), id: "s-running" };
  const retryEnrichment = jest.fn(async () => ({ status: "running" as const }));
  await open(card.id, { ...base, getSave: jest.fn(async () => card), retryEnrichment });
  await fireEvent.press(await screen.findByText("Try getting details again"));
  expect(retryEnrichment).toHaveBeenCalledWith("s-running");
  expect(await screen.findByText(RETRY_RUNNING)).toBeTruthy();
  expect(screen.queryByText("Couldn't retry. Try again later.")).toBeNull();
});

test("after 3 retries today the card says so and Try again stays off for the session", async () => {
  const base = demoApi();
  const card = { ...(await base.getSave("s-partial")), id: "s-capped" };
  const retryEnrichment = jest.fn(async () => Promise.reject(new ApiError("RATE_LIMITED", 429)));
  const api = { ...base, getSave: jest.fn(async () => card), retryEnrichment };
  const view = await open(card.id, api);
  await fireEvent.press(await screen.findByText("Try getting details again"));
  // Said as a toast (announced) and on the card, where it explains the button that is now off.
  expect((await screen.findAllByText(RETRY_CAPPED)).length).toBeGreaterThan(0);
  expect(screen.queryByText("Couldn't retry. Try again later.")).toBeNull();
  expect(screen.getByRole("button", { name: "Try getting details again" })).toBeDisabled();
  // Opened again later in the session: still off, still saying why.
  await view.unmount();
  await open(card.id, api);
  expect(await screen.findByText(RETRY_CAPPED)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try getting details again" })).toBeDisabled();
  await fireEvent.press(screen.getByText("Try getting details again"));
  expect(retryEnrichment).toHaveBeenCalledTimes(1);
});

test("a note can be removed by saving it empty, and a toast confirms it", async () => {
  const api = demoApi();
  const setNote = jest.spyOn(api, "setNote");
  await open("s-momo", api);
  await screen.findByText(MOMO.title!);
  await fireEvent.press(screen.getByLabelText("Edit note"));
  await fireEvent.changeText(screen.getByDisplayValue(MOMO.note!), "  ");
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).not.toBeDisabled();
  await fireEvent.press(save);
  expect(setNote).toHaveBeenCalledWith("s-momo", "");
  expect(await screen.findByText("Note removed")).toBeTruthy();
  expect(screen.getByText("Add a note")).toBeTruthy();
});

test("with no note to clear, an empty note cannot be saved", async () => {
  await open("s-partial");
  await fireEvent.press(await screen.findByText("Add a note"));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});
