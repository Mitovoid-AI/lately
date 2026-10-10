import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { SearchScreen } from "../SearchScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const MOMO = "Hole-in-the-wall momo spot in Koramangala";

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  mockCanGoBack = true;
  await AsyncStorage.clear();
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

async function type(q: string) {
  await fireEvent.changeText(screen.getByPlaceholderText("Search what you remember…"), q);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}

test("typing finds the momo card and explains why", async () => {
  await renderWithProviders(<SearchScreen />);
  await type("momo");
  expect(await screen.findByText(MOMO)).toBeTruthy();
  expect(screen.getByText("#momos")).toBeTruthy();
  expect(screen.getByText(/^\d+ reels?$/)).toBeTruthy();
});

test("a submitted search shows up under Recent and can be re-run", async () => {
  await renderWithProviders(<SearchScreen />);
  expect(screen.getByText("Recent")).toBeTruthy();
  await type("momo");
  await fireEvent(screen.getByPlaceholderText("Search what you remember…"), "submitEditing");
  await type("");
  expect(await screen.findByText("momo")).toBeTruthy();
  await fireEvent.press(screen.getByText("momo"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(await screen.findByText(MOMO)).toBeTruthy();
});

test("no results", async () => {
  await renderWithProviders(<SearchScreen />);
  await type("zzzz");
  expect(await screen.findByText("Nothing for “zzzz” yet")).toBeTruthy();
  expect(screen.getByText("Try a word from your note, a place, or the creator's name.")).toBeTruthy();
});

test("regex characters do not break search", async () => {
  await renderWithProviders(<SearchScreen />);
  await type("c++(");
  expect(await screen.findByText("Nothing for “c++(” yet")).toBeTruthy();
});

test("back and result rows navigate", async () => {
  await renderWithProviders(<SearchScreen />);
  await type("momo");
  await fireEvent.press(await screen.findByText(MOMO));
  expect(mockRouter.push).toHaveBeenCalledWith("/reel/s-momo");
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
});

test("a q param runs on open", async () => {
  mockParams = { q: "cafe" };
  await renderWithProviders(<SearchScreen />);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(await screen.findByText(MOMO)).toBeTruthy();
  expect(screen.getByDisplayValue("cafe")).toBeTruthy();
});

test("back with no history goes to the Library", async () => {
  mockCanGoBack = false;
  await renderWithProviders(<SearchScreen />);
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("the search box takes at most 200 characters", async () => {
  await renderWithProviders(<SearchScreen />);
  expect(screen.getByPlaceholderText("Search what you remember…").props.maxLength).toBe(200);
});

test("a failed search says so with a retry", async () => {
  mockParams = { q: "cafe" };
  const api = { ...demoApi(), search: jest.fn(async () => Promise.reject(new Error("down"))) };
  await renderWithProviders(<SearchScreen />, { api });
  expect(await screen.findByText("Couldn't search right now")).toBeTruthy();
  expect(screen.getByText("Try again")).toBeTruthy();
});
