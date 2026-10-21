import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { ApiError, type LatelyApi } from "../../api/contract";
import { PRO_CONFIRMING } from "../../billing/plans";
import { queueKey, readQueue } from "../../lib/saveQueue";
import { fakeBilling } from "../../test/fakeBilling";
import { NOW } from "../../test/fixtures";
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
  expect(await screen.findByText("Saved to Lately")).toBeTruthy();
  expect(screen.getByText("Your card will be ready in a few seconds.")).toBeTruthy();
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
  expect(await screen.findByText("Saved to Lately")).toBeTruthy();
  expect(mockSendDeviceHint).toHaveBeenCalledTimes(1);
  const [arg] = mockSendDeviceHint.mock.calls[0];
  expect(arg).toMatchObject({ api, mode: "demo", text: link("NEW123"), result: { reel_id: "s-new-1", deduped: false } });
});

test("a pasted link fires the device hint too", async () => {
  await renderWithProviders(<SaveSheetScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText("instagram.com/reel/…"), link("NEW123"));
  await fireEvent.press(screen.getByText("Save"));
  await screen.findByText("Saved to Lately");
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
  await screen.findByText("Saved to Lately");
  await fireEvent.press(screen.getByText("To visit"));
  expect(screen.getByDisplayValue("To visit")).toBeTruthy();
});

test("an already-saved reel shows when it was saved and its note", async () => {
  jest.useFakeTimers({ now: NOW });
  mockParams = { text: link("MomoPt1") };
  await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("Already in your Lately")).toBeTruthy();
  expect(await screen.findByText("Saved 5 days ago.")).toBeTruthy();
  expect(screen.getByText("“cafe to try”")).toBeTruthy();
  await fireEvent.press(screen.getByText("Open card"));
  expect(mockRouter.replace).toHaveBeenCalledWith("/reel/s-momo");
});

test("text without a reel link", async () => {
  mockParams = { text: "hello" };
  await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("No reel link found")).toBeTruthy();
  expect(screen.getByText("Share the reel itself, not a profile or story.")).toBeTruthy();
});

test("monthly limit shows the limit, the reset date and what Pro changes", async () => {
  mockParams = { text: link("QUOTA") };
  await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("You've used all 20 free saves this month")).toBeTruthy();
  expect(await screen.findByText("Saves reset on 1 Nov. Pro removes the monthly cap.")).toBeTruthy();
});

test("monthly limit: Go unlimited with Pro replaces the sheet with the paywall, and the reel goes along", async () => {
  mockParams = { text: link("QUOTA") };
  await renderWithProviders(<SaveSheetScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "Go unlimited with Pro" }));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/pro", params: { text: link("QUOTA") } });
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test("a link pasted into the sheet goes along to the paywall too", async () => {
  await renderWithProviders(<SaveSheetScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText("instagram.com/reel/…"), link("QUOTA"));
  await fireEvent.press(screen.getByText("Save"));
  await fireEvent.press(await screen.findByRole("button", { name: "Go unlimited with Pro" }));
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
  expect(await screen.findByText("Saved to Lately")).toBeTruthy();
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
  expect(screen.queryByRole("button", { name: "Go unlimited with Pro" })).toBeNull();
  expect(createSave).toHaveBeenCalledTimes(2);
  expect(syncPlan).toHaveBeenCalledTimes(1);

  // Try again syncs and retries once more; this time the server has caught up.
  createSave.mockResolvedValueOnce({ reel_id: "s-pro", deduped: false, status: "pending" });
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Saved to Lately")).toBeTruthy();
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
  expect(await screen.findByText("Saved to Lately")).toBeTruthy();
});

test("rate limited: the save waits in the queue instead of being lost", async () => {
  mockParams = { text: link("RATE") };
  const { queueStore } = await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("Saved for later")).toBeTruthy();
  expect(screen.getByText("Lately is busy right now. It will save this reel in a moment.")).toBeTruthy();
  expect((await readQueue(queueStore, queueKey("demo-user"))).map((q) => q.text)).toEqual([link("RATE")]);
});

test("a server error (5xx) queues the save", async () => {
  mockParams = { text: link("NEW500") };
  const api: LatelyApi = { ...demoApi(), createSave: jest.fn().mockRejectedValue(new ApiError("SERVER", 503)) };
  const { queueStore } = await renderWithProviders(<SaveSheetScreen />, { api });
  expect(await screen.findByText("Saved for later")).toBeTruthy();
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
  expect(await screen.findByText("Saved for later")).toBeTruthy();
  expect((await readQueue(queueStore, queueKey("demo-user"))).map((q) => q.text)).toEqual([link("NEW123")]);
  await fireEvent.press(screen.getByText("Try again now"));
  expect(await screen.findByText("Saved to Lately")).toBeTruthy();
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
  expect(await screen.findByText("Saved to Lately")).toBeTruthy();
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
  await screen.findByText("Saved to Lately");
  expect(createSave).toHaveBeenCalledTimes(1);
});

test("the saved sheet closes itself after 5 s", async () => {
  jest.useFakeTimers();
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen />);
  await screen.findByText("Saved to Lately");
  expect(screen.getByText("Closes in 5 s")).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(mockRouter.back).toHaveBeenCalled();
});

test("touching the note field stops the auto-close", async () => {
  jest.useFakeTimers();
  mockParams = { text: link("NEW123") };
  await renderWithProviders(<SaveSheetScreen />);
  await screen.findByText("Saved to Lately");
  await fireEvent(screen.getByPlaceholderText("e.g. cafe to try in June"), "focus");
  await act(async () => {
    jest.advanceTimersByTime(6000);
  });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(screen.queryByText(/Closes in/)).toBeNull();
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
  await screen.findByText("Saved to Lately");
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. cafe to try in June"), "for june");
  await fireEvent.press(screen.getByText("Save note"));
  expect(await screen.findByText("Couldn't save your note. Try again.")).toBeTruthy();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test("a double tap on Save note sends one request", async () => {
  mockParams = { text: link("NEW123") };
  const api = demoApi();
  const setNote = jest.spyOn(api, "setNote");
  await renderWithProviders(<SaveSheetScreen />, { api });
  await screen.findByText("Saved to Lately");
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. cafe to try in June"), "for june");
  const button = screen.getByText("Save note");
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(setNote).toHaveBeenCalledTimes(1);
});
