import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { ApiError, type LatelyApi } from "../../api/contract";
import { createDemoApi, PENDING_MS } from "../../api/demo";
import { PRO_CONFIRMING } from "../../billing/plans";
import { PROGRESS_EASE_AFTER_MS, PROGRESS_POLL_MS } from "../../hooks/useSaves";
import { TRACKER_ESTIMATE, TRACKER_SLOW, TRACKER_UNREACHABLE } from "../../lib/saveOutcome";
import { queueKey, readQueue } from "../../lib/saveQueue";
import { fakeBilling } from "../../test/fakeBilling";
import { NOW } from "../../test/fixtures";
import { createMemoryStore } from "../../test/memoryStore";
import { demoApi, renderWithProviders } from "../../test/render";
import { SaveSheetScreen } from "../SaveSheetScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

// The device-side read never settles here: the sheet must not wait for it.
jest.mock("../../lib/deviceFetch", () => ({
  sendDeviceHint: jest.fn(() => new Promise(() => {})),
}));
const { sendDeviceHint: mockSendDeviceHint } = jest.requireMock("../../lib/deviceFetch") as { sendDeviceHint: jest.Mock };

const link = (code: string) => `https://www.instagram.com/reel/${code}/`;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockCanGoBack = true;
});

afterEach(() => jest.useRealTimers());

test("shared text is saved right away; a note can be added", async () => {
  mockParams = { text: link("NEW123") };
  const api = demoApi();
  const setNote = jest.spyOn(api, "setNote");
  await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("Saved")).toBeTruthy();
  expect(screen.getByText("It's on Home now. Lately is writing its card.")).toBeTruthy();
  expect(screen.getByText("instagram.com/reel/NEW123")).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. cafe to try in June"), "for june");
  await fireEvent.press(screen.getByText("Save note"));
  expect(setNote).toHaveBeenCalledWith("s-new-1", "for june");
  expect(mockRouter.back).toHaveBeenCalled();
});

test("a shared save fires the device hint without waiting for it", async () => {
  mockParams = { text: link("NEW123") };
  const api = demoApi();
  await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("Saved")).toBeTruthy();
  expect(mockSendDeviceHint).toHaveBeenCalledTimes(1);
  const [arg] = mockSendDeviceHint.mock.calls[0];
  expect(arg).toMatchObject({ api, mode: "demo", text: link("NEW123"), result: { reel_id: "s-new-1", deduped: false } });
});

test("a pasted link fires the device hint too", async () => {
  await renderWithProviders(<SaveSheetScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText("instagram.com/reel/…"), link("NEW123"));
  await fireEvent.press(screen.getByText("Save"));
  await screen.findByText("Saved");
  expect(mockSendDeviceHint).toHaveBeenCalledWith(expect.objectContaining({ text: link("NEW123") }));
});

test("a failed save sends no hint", async () => {
  mockParams = { text: "hello" };
  await renderWithProviders(<SaveSheetScreen />);
  await screen.findByText("No reel link found");
  expect(mockSendDeviceHint).not.toHaveBeenCalled();
});

test("a quick chip fills the note", async () => {
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen />);
  await screen.findByText("Saved");
  await fireEvent.press(screen.getByText("To visit"));
  expect(screen.getByDisplayValue("To visit")).toBeTruthy();
});

test("an already-saved reel shows when it was saved and its note", async () => {
  jest.useFakeTimers({ now: NOW });
  mockParams = { text: link("MomoPt1") };
  await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("You saved this already")).toBeTruthy();
  expect(await screen.findByText("Saved 5 days ago.")).toBeTruthy();
  expect(screen.getByText("“dinner to try”")).toBeTruthy();
  await fireEvent.press(screen.getByText("Open card"));
  expect(mockRouter.replace).toHaveBeenCalledWith("/reel/s-momo");
});

test("an already-saved reel offers Try again if its details can't be loaded", async () => {
  mockParams = { text: link("MomoPt1") };
  const base = demoApi();
  let failing = true;
  const getSave = jest.fn(async (id: string) => {
    if (failing) throw new ApiError("NETWORK", 0);
    return base.getSave(id);
  });
  await renderWithProviders(<SaveSheetScreen />, { api: { ...base, getSave } });
  expect(await screen.findByText("You saved this already")).toBeTruthy();
  expect(await screen.findByText("Couldn't check your saves.")).toBeTruthy();
  failing = false;
  await fireEvent.press(screen.getByText("Try again"));
  expect(await screen.findByText("“dinner to try”")).toBeTruthy();
  expect(screen.queryByText("Couldn't check your saves.")).toBeNull();
});

test("text without a reel link", async () => {
  mockParams = { text: "hello" };
  await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("No reel link found")).toBeTruthy();
  expect(screen.getByText("Paste or share a link to an Instagram reel or post.")).toBeTruthy();
});

test("monthly limit shows the limit, the reset date and what Pro changes", async () => {
  mockParams = { text: link("QUOTA") };
  await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("You've used all 20 free saves this month")).toBeTruthy();
  expect(await screen.findByText("Saves reset on Nov 1. Pro removes the monthly cap.")).toBeTruthy();
});

test("monthly limit: Upgrade to Pro replaces the sheet with the paywall, and the reel goes along", async () => {
  mockParams = { text: link("QUOTA") };
  await renderWithProviders(<SaveSheetScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "Upgrade to Pro" }));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/pro", params: { text: link("QUOTA") } });
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test("a link pasted into the sheet goes along to the paywall too", async () => {
  await renderWithProviders(<SaveSheetScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText("instagram.com/reel/…"), link("QUOTA"));
  await fireEvent.press(screen.getByText("Save"));
  await fireEvent.press(await screen.findByRole("button", { name: "Upgrade to Pro" }));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/pro", params: { text: link("QUOTA") } });
});

test("monthly limit: Not now just closes the sheet", async () => {
  mockParams = { text: link("QUOTA") };
  await renderWithProviders(<SaveSheetScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "Not now" }));
  expect(mockRouter.back).toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test("monthly limit before the account has loaded still says what Pro changes", async () => {
  mockParams = { text: link("QUOTA") };
  const api: LatelyApi = { ...demoApi(), getMe: () => new Promise(() => {}) };
  await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("Pro removes the monthly cap.")).toBeTruthy();
});

test("the store says Pro but the server hasn't heard: the sheet syncs the plan and retries the save once", async () => {
  const api = demoApi();
  const createSave = jest
    .spyOn(api, "createSave")
    .mockRejectedValueOnce(new ApiError("QUOTA_EXCEEDED", 429))
    .mockResolvedValueOnce({ reel_id: "s-pro", deduped: false, status: "pending" });
  const syncPlan = jest.spyOn(api, "syncPlan");
  const fake = fakeBilling({ isProActive: jest.fn(async () => true) });
  await renderWithProviders(<SaveSheetScreen />, { api, billing: fake.client });
  // Let the billing provider read the store before the save starts.
  await waitFor(() => expect(fake.client.isProActive).toHaveBeenCalled());
  await act(async () => {});
  await fireEvent.changeText(screen.getByPlaceholderText("instagram.com/reel/…"), link("QUOTA"));
  await fireEvent.press(screen.getByText("Save"));
  expect(await screen.findByText("Saved")).toBeTruthy();
  expect(createSave).toHaveBeenCalledTimes(2);
  expect(syncPlan).toHaveBeenCalledTimes(1);
});

test("the retry happens only once: still over the limit after syncing says Pro is turning on, with no upsell", async () => {
  const api = demoApi();
  const createSave = jest.spyOn(api, "createSave").mockRejectedValue(new ApiError("QUOTA_EXCEEDED", 429));
  const syncPlan = jest.spyOn(api, "syncPlan");
  const fake = fakeBilling({ isProActive: jest.fn(async () => true) });
  await renderWithProviders(<SaveSheetScreen />, { api, billing: fake.client });
  await waitFor(() => expect(fake.client.isProActive).toHaveBeenCalled());
  await act(async () => {});
  await fireEvent.changeText(screen.getByPlaceholderText("instagram.com/reel/…"), link("QUOTA"));
  await fireEvent.press(screen.getByText("Save"));
  expect(await screen.findByText("Pro is turning on")).toBeTruthy();
  expect(screen.getByText(PRO_CONFIRMING)).toBeTruthy();
  expect(screen.queryByText(/free saves this month/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).toBeNull();
  expect(createSave).toHaveBeenCalledTimes(2);
  expect(syncPlan).toHaveBeenCalledTimes(1);

  // Try again syncs and retries once more; this time the server has caught up.
  createSave.mockResolvedValueOnce({ reel_id: "s-pro", deduped: false, status: "pending" });
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Saved")).toBeTruthy();
});

test("Pro turning on says so and offers nothing to buy; Close just closes", async () => {
  const api = demoApi();
  jest.spyOn(api, "createSave").mockRejectedValue(new ApiError("QUOTA_EXCEEDED", 429));
  const fake = fakeBilling({ isProActive: jest.fn(async () => true) });
  mockParams = { text: link("QUOTA") };
  await renderWithProviders(<SaveSheetScreen />, { api, billing: fake.client });
  await screen.findByText("Pro is turning on");
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  expect(mockRouter.back).toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test("on the free plan the limit is final: no sync, no retry", async () => {
  mockParams = { text: link("QUOTA") };
  const api = demoApi();
  const createSave = jest.spyOn(api, "createSave");
  const syncPlan = jest.spyOn(api, "syncPlan");
  await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("You've used all 20 free saves this month")).toBeTruthy();
  expect(createSave).toHaveBeenCalledTimes(1);
  expect(syncPlan).not.toHaveBeenCalled();
});

test("a Pro member's save goes through in demo mode, where the free limit no longer applies", async () => {
  mockParams = { text: link("QUOTA") };
  const api = demoApi();
  api.setPlan("pro");
  await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("Saved")).toBeTruthy();
});

test("rate limited: the save waits in the queue instead of being lost", async () => {
  mockParams = { text: link("RATE") };
  const { queueStore } = await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("Waiting to save")).toBeTruthy();
  expect(screen.getByText("Lately is busy right now. It will save this reel in a moment.")).toBeTruthy();
  expect((await readQueue(queueStore, queueKey("demo-user"))).map((q) => q.text)).toEqual([link("RATE")]);
});

test("a server error (5xx) queues the save", async () => {
  mockParams = { text: link("NEW500") };
  const api: LatelyApi = { ...demoApi(), createSave: jest.fn().mockRejectedValue(new ApiError("SERVER", 503)) };
  const { queueStore } = await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("Waiting to save")).toBeTruthy();
  expect(screen.getByText("Lately's server is having trouble. It will save this reel as soon as it's back.")).toBeTruthy();
  expect((await readQueue(queueStore, queueKey("demo-user"))).map((q) => q.text)).toEqual([link("NEW500")]);
});

test("offline with text that has no reel link: says so at once and queues nothing", async () => {
  mockParams = { text: "look at this cool thing" };
  const api: LatelyApi = { ...demoApi(), createSave: jest.fn().mockRejectedValue(new ApiError("NETWORK", 0)) };
  const { queueStore } = await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("No reel link found")).toBeTruthy();
  expect(await readQueue(queueStore, queueKey("demo-user"))).toEqual([]);
});

test("offline: the save is queued on the device and can be retried now", async () => {
  mockParams = { text: link("NEW123") };
  const base = demoApi();
  const api: LatelyApi = {
    ...base,
    createSave: jest
      .fn()
      .mockRejectedValueOnce(new ApiError("NETWORK", 0))
      .mockResolvedValueOnce({ reel_id: "s-x", deduped: false, status: "pending" }),
  };
  const { queueStore } = await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("Waiting to save")).toBeTruthy();
  expect((await readQueue(queueStore, queueKey("demo-user"))).map((q) => q.text)).toEqual([link("NEW123")]);
  await fireEvent.press(screen.getByText("Try again now"));
  expect(await screen.findByText("Saved")).toBeTruthy();
  await waitFor(async () => expect(await readQueue(queueStore, queueKey("demo-user"))).toEqual([]));
});

test("an unexpected failure offers a retry", async () => {
  mockParams = { text: link("NEW123") };
  const base = demoApi();
  const api: LatelyApi = {
    ...base,
    createSave: jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ reel_id: "s-x", deduped: false, status: "pending" }),
  };
  await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("Couldn't reach Lately")).toBeTruthy();
  await fireEvent.press(screen.getByText("Try again"));
  expect(await screen.findByText("Saved")).toBeTruthy();
});

test("paste step: a double tap on Save sends one request", async () => {
  const api = demoApi();
  const createSave = jest.spyOn(api, "createSave");
  await renderWithProviders(<SaveSheetScreen />, { api });
  expect(screen.getByText("Paste a reel link")).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText("instagram.com/reel/…"), link("NEW123"));
  const save = screen.getByText("Save");
  await fireEvent.press(save);
  await fireEvent.press(save);
  await screen.findByText("Saved");
  expect(createSave).toHaveBeenCalledTimes(1);
});

// ------------------------------------------------------------ the card being made --

/** A demo API on a clock the test moves: the pending card walks through the server's stages as it does. */
function clockApi() {
  let clock = NOW;
  const api = createDemoApi({ now: () => clock, storage: createMemoryStore() });
  return {
    api,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** Lets the sheet's next check of the card go out (and answer). Needs fake timers. */
async function poll(ms = PROGRESS_POLL_MS) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

// The person has already had their first card, so nothing is celebrated unless a test wants it.
const FIRST_CARD_SEEN = { "lately.firstCard.demo-user": "true" };

test("the saved sheet stays open while the card is made: no countdown, it closes on Done", async () => {
  jest.useFakeTimers();
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />);
  await screen.findByText("Saved");
  expect(screen.queryByText(/Closes in/)).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  expect(mockRouter.back).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockRouter.back).toHaveBeenCalled();
});

test("typing a note while the card is made works and does not close the sheet", async () => {
  jest.useFakeTimers();
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />);
  await screen.findByText("Saved");
  await fireEvent(screen.getByPlaceholderText("e.g. cafe to try in June"), "focus");
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. cafe to try in June"), "for june");
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue("for june")).toBeTruthy();
});

test("a named-step tracker follows the server's stages, then offers Open card", async () => {
  jest.useFakeTimers({ now: NOW });
  const { api, advance } = clockApi();
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />, { api });
  expect(await screen.findByText("Saved")).toBeTruthy();

  // Just saved: the server is at its first stage and says what Lately is doing, with no time.
  expect(await screen.findByLabelText("Getting the reel, in progress")).toBeTruthy();
  expect(screen.getByLabelText("Card ready, up next")).toBeTruthy();
  expect(screen.getByText(TRACKER_ESTIMATE)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open card" })).toBeNull();

  advance(PENDING_MS * 0.4); // the server is transcribing
  await poll();
  expect(await screen.findByLabelText("Got the reel, done")).toBeTruthy();
  expect(screen.getByLabelText("Listening to it, in progress")).toBeTruthy();
  expect(screen.getByLabelText("Finding places and steps, up next")).toBeTruthy();

  advance(PENDING_MS * 0.4); // the server is structuring
  await poll();
  expect(await screen.findByLabelText("Listened to it, done")).toBeTruthy();
  expect(screen.getByLabelText("Finding places and steps, in progress")).toBeTruthy();
  expect(screen.getByText("Almost there")).toBeTruthy();

  advance(PENDING_MS); // the card landed
  await poll();
  expect(await screen.findByText("Your card is ready.")).toBeTruthy();
  expect(screen.getByLabelText("Found places and steps, done")).toBeTruthy();
  expect(screen.getByLabelText("Card ready, done")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Open card" }));
  expect(mockRouter.replace).toHaveBeenCalledWith("/reel/s-new-1");
});

test("the note box and Done keep working once the card is ready, and Open card keeps a typed note", async () => {
  jest.useFakeTimers({ now: NOW });
  const { api, advance } = clockApi();
  const setNote = jest.spyOn(api, "setNote");
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />, { api });
  await screen.findByLabelText("Getting the reel, in progress");
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. cafe to try in June"), "for june");
  advance(PENDING_MS);
  await poll();
  await fireEvent.press(await screen.findByRole("button", { name: "Open card" }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/reel/s-new-1"));
  expect(setNote).toHaveBeenCalledWith("s-new-1", "for june");
});

test("a card that ends up partial says so plainly and still offers to open it", async () => {
  jest.useFakeTimers({ now: NOW });
  const { api } = clockApi();
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />, { api });
  await screen.findByLabelText("Getting the reel, in progress");
  // The server gives up on part of the reel: the card is saved with what could be read.
  const real = api.getSave.bind(api);
  jest.spyOn(api, "getSave").mockImplementation(async (id) => ({ ...(await real(id)), status: "partial" }));
  await poll();
  expect(await screen.findByText("Lately could only read part of this reel. Open the card to try again.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open card" })).toBeTruthy();
});

test("a card that takes 90 s says it is still working and that the sheet can be closed", async () => {
  jest.useFakeTimers({ now: NOW });
  const { api } = clockApi(); // the clock never moves, so the card stays pending
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />, { api });
  await screen.findByLabelText("Getting the reel, in progress");
  expect(screen.queryByText(TRACKER_SLOW)).toBeNull();
  await poll(PROGRESS_EASE_AFTER_MS);
  expect(await screen.findByText(TRACKER_SLOW)).toBeTruthy();
});

test("a check that fails says progress can't be read and the card keeps filling in", async () => {
  jest.useFakeTimers({ now: NOW });
  const { api } = clockApi();
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />, { api });
  await screen.findByLabelText("Getting the reel, in progress");
  jest.spyOn(api, "getSave").mockRejectedValue(new ApiError("NETWORK", 0));
  await poll();
  expect(await screen.findByText(TRACKER_UNREACHABLE)).toBeTruthy();
});

test("polling stops once the card is ready", async () => {
  jest.useFakeTimers({ now: NOW });
  const { api, advance } = clockApi();
  const getSave = jest.spyOn(api, "getSave");
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />, { api });
  await screen.findByLabelText("Getting the reel, in progress");
  advance(PENDING_MS);
  await poll();
  await screen.findByText("Your card is ready.");
  const calls = getSave.mock.calls.length;
  await poll(60_000);
  expect(getSave.mock.calls.length).toBe(calls);
});

test("closing the sheet stops asking the server about the card", async () => {
  jest.useFakeTimers({ now: NOW });
  const { api } = clockApi();
  const getSave = jest.spyOn(api, "getSave");
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />, { api });
  await screen.findByLabelText("Getting the reel, in progress");
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockRouter.back).toHaveBeenCalled();
  const calls = getSave.mock.calls.length;
  await poll(60_000);
  expect(getSave.mock.calls.length).toBe(calls);
});

test("the first card a person ever saves is celebrated once; the next one is not", async () => {
  jest.useFakeTimers({ now: NOW });
  const store = createMemoryStore();
  const { api, advance } = clockApi();

  mockParams = { text: link("NEW123") };
  const sheet = await renderWithProviders(<SaveSheetScreen firstCardStore={store} />, { api });
  await screen.findByLabelText("Getting the reel, in progress");
  advance(PENDING_MS);
  await poll();
  expect(await screen.findByText("Your first card is ready.")).toBeTruthy();
  await sheet.unmount();

  mockParams = { text: link("NEW456") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={store} />, { api });
  await screen.findByLabelText("Getting the reel, in progress");
  advance(PENDING_MS);
  await poll();
  expect(await screen.findByText("Your card is ready.")).toBeTruthy();
  expect(screen.queryByText("Your first card is ready.")).toBeNull();
});

test("the Pro quota outcome still replaces the sheet with the paywall, and no tracker shows for a save that did not happen", async () => {
  mockParams = { text: link("QUOTA") };
  await renderWithProviders(<SaveSheetScreen firstCardStore={createMemoryStore(FIRST_CARD_SEEN)} />);
  expect(await screen.findByRole("button", { name: "Upgrade to Pro" })).toBeTruthy();
  expect(screen.queryByText("Saved")).toBeNull();
  expect(screen.queryByLabelText(/in progress/)).toBeNull();
});

test("closing with nothing to go back to opens the Library", async () => {
  mockCanGoBack = false;
  mockParams = { text: "hello" };
  await renderWithProviders(<SaveSheetScreen />);
  await screen.findByText("No reel link found");
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("a failed note save says so and keeps the sheet open", async () => {
  mockParams = { text: link("NEW123") };
  const api = { ...demoApi(), setNote: jest.fn(async () => Promise.reject(new ApiError("NETWORK", 0))) };
  await renderWithProviders(<SaveSheetScreen />, { api });
  await screen.findByText("Saved");
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. cafe to try in June"), "for june");
  await fireEvent.press(screen.getByText("Save note"));
  // Said under the note, as an alert, where the person is looking.
  const alert = await screen.findByText("Couldn't save your note. Try again.");
  expect(alert.props.accessibilityRole).toBe("alert");
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test("the fields are named for a screen reader, not only by their placeholder", async () => {
  await renderWithProviders(<SaveSheetScreen />);
  expect(screen.getByLabelText("Reel link")).toBeTruthy();
});

test("a double tap on Save note sends one request", async () => {
  mockParams = { text: link("NEW123") };
  const api = demoApi();
  const setNote = jest.spyOn(api, "setNote");
  await renderWithProviders(<SaveSheetScreen />, { api });
  await screen.findByText("Saved");
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. cafe to try in June"), "for june");
  const button = screen.getByText("Save note");
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(setNote).toHaveBeenCalledTimes(1);
});
