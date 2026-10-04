import { act, fireEvent, screen } from "@testing-library/react-native";

import { ApiError, type LatelyApi } from "../../api/contract";
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

test("monthly limit shows the limit and the reset date", async () => {
  mockParams = { text: link("QUOTA") };
  await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("You've used all 20 free saves this month")).toBeTruthy();
  expect(await screen.findByText("Saves reset on 1 Nov.")).toBeTruthy();
});

test("rate limited", async () => {
  mockParams = { text: link("RATE") };
  await renderWithProviders(<SaveSheetScreen />);
  expect(await screen.findByText("That's a lot of saves at once")).toBeTruthy();
});

test("network error can be retried", async () => {
  mockParams = { text: link("NEW123") };
  const base = demoApi();
  const api: LatelyApi = {
    ...base,
    createSave: jest
      .fn()
      .mockRejectedValueOnce(new ApiError("NETWORK", 0))
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
