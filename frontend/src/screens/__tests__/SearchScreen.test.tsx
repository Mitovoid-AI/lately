import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { ApiError, type Save, type SearchHit } from "../../api/contract";
import { relativeShort } from "../../lib/dates";
import { RECENT_KEY } from "../../lib/recent";
import { SEARCH_EXAMPLES } from "../../lib/searchExamples";
import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { SearchScreen } from "../SearchScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
let mockCanGoBack = true;
let mockParams: Record<string, string> = {};
// How deep the app's stack is under Search: 0 = Search is the tab root, 1 = pushed over a screen.
let mockStackIndex = 0;
const mockNavigation = {
  getState: () => ({ type: "stack", index: mockStackIndex }),
  getParent: () => undefined,
};
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require("react");
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useNavigation: () => mockNavigation,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});

const PLACEHOLDER = "Search what you remember…";
const DAY = 24 * 60 * 60_000;

function save(id: string, over: Partial<Save> = {}): Save {
  return {
    id,
    source_url: `https://www.instagram.com/reel/${id}/`,
    shortcode: id,
    status: "enriched",
    note: null,
    created_at: new Date(NOW - 2 * DAY).toISOString(),
    title: `Title of ${id}`,
    caption: null,
    category: "Food & Places",
    thumbnail_url: null,
    creator: "foodie",
    channel: "app_share",
    ...over,
  };
}

const BEST: SearchHit = {
  save: save("best", { title: "Dumpling spot in Chinatown", note: "to try" }),
  why: ['📍 Chinatown', 'your note: "to try"', "#dumplings", "caption: dumpling"],
};
const SECOND: SearchHit = { save: save("second", { title: "Soup dumplings at home", category: "Food & Places" }), why: ["#soup"] };
const THIRD: SearchHit = { save: save("third", { title: "Chili oil recipe", category: "Watch Later", creator: null }), why: [] };

/** An api whose search answers `hits` for anything except "zzzz" (which finds nothing). */
function apiWith(hits: SearchHit[]) {
  const search = jest.fn(async (q: string) => (q === "zzzz" || q === "c++(" ? [] : hits));
  return { api: { ...demoApi(), search }, search };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  mockCanGoBack = true;
  mockStackIndex = 0;
  await AsyncStorage.clear();
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

async function type(q: string) {
  await fireEvent.changeText(screen.getByPlaceholderText(PLACEHOLDER), q);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}

test("the best match comes first with the reasons it matched, the rest under Also from your saves", async () => {
  const { api } = apiWith([BEST, SECOND, THIRD]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("dumpling");
  expect(await screen.findByText("Best match")).toBeTruthy();
  expect(screen.getByText("Dumpling spot in Chinatown")).toBeTruthy();
  // At most three reasons, the place as a plain name (no pin emoji) and the note in curly quotes.
  expect(screen.getByText("Chinatown")).toBeTruthy();
  expect(screen.getByText("Your note: “to try”")).toBeTruthy();
  expect(screen.getByText("#dumplings")).toBeTruthy();
  expect(screen.queryByText("Caption: dumpling")).toBeNull();
  expect(screen.queryByText(/📍/)).toBeNull();
  // The category shows as a pill, the creator and age as meta.
  expect(screen.getAllByText("Food & Places").length).toBeGreaterThan(0);
  expect(screen.getAllByText(`@foodie · ${relativeShort(BEST.save.created_at, NOW)}`).length).toBeGreaterThan(0);

  expect(screen.getByText("Also from your saves")).toBeTruthy();
  expect(screen.getByText("Soup dumplings at home")).toBeTruthy();
  expect(screen.getByText("Chili oil recipe")).toBeTruthy();
  expect(screen.getByText("#soup")).toBeTruthy();
});

test("how many saves came back is a live region, so a screen reader says it", async () => {
  const { api } = apiWith([BEST, SECOND, THIRD]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("dumpling");
  const count = await screen.findByText("3 saves found");
  expect(count.props.accessibilityLiveRegion).toBe("polite");
});

test("a single result has no Also from your saves", async () => {
  const { api } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("dumpling");
  expect(await screen.findByText("Best match")).toBeTruthy();
  expect(screen.getByText("1 save found")).toBeTruthy();
  expect(screen.queryByText("Also from your saves")).toBeNull();
});

test("typing against the demo library finds a card and explains why", async () => {
  const api = demoApi();
  const seed = await api.listSaves({ limit: 50 });
  const target = seed.find((s) => s.note);
  await renderWithProviders(<SearchScreen />, { api });
  await type(target!.note!);
  expect((await screen.findAllByText(/^Your note:/)).length).toBeGreaterThan(0);
});

test("an empty query shows example searches, and tapping one fills the field", async () => {
  const { api, search } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  expect(screen.getByText("Find a reel by what you remember")).toBeTruthy();
  expect(screen.queryByText("Recent")).toBeNull();
  expect(screen.getByText("Try searching for")).toBeTruthy();
  const example = SEARCH_EXAMPLES[0];
  await fireEvent.press(screen.getAllByText(example)[0]);
  expect(screen.getByDisplayValue(example)).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(search).toHaveBeenCalledWith(example);
});

test("a submitted search shows up under Recent and can be re-run", async () => {
  const { api } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("momo");
  await fireEvent(screen.getByPlaceholderText(PLACEHOLDER), "submitEditing");
  await type("");
  expect(await screen.findByText("Recent")).toBeTruthy();
  expect(await screen.findByText("momo")).toBeTruthy();
  await fireEvent.press(screen.getByText("momo"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(await screen.findByText("Dumpling spot in Chinatown")).toBeTruthy();
});

test("Clear forgets the recent searches", async () => {
  const { api } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("momo");
  await fireEvent(screen.getByPlaceholderText(PLACEHOLDER), "submitEditing");
  await type("");
  await fireEvent.press(await screen.findByLabelText("Clear recent searches"));
  expect(await screen.findByText("Find a reel by what you remember")).toBeTruthy();
  expect(screen.queryByText("momo")).toBeNull();
});

test("no results says what was searched and how to widen it", async () => {
  const { api } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("zzzz");
  const nothing = await screen.findByText("Nothing matched “zzzz”");
  // Announced when the results turn out to be none.
  expect(nothing.props.accessibilityLiveRegion).toBe("polite");
  expect(screen.getByText("Try fewer words, or a place, dish or topic.")).toBeTruthy();
  // It offers a few searches that do work.
  expect(screen.getAllByText(SEARCH_EXAMPLES[0]).length).toBeGreaterThan(0);
});

test("regex characters do not break search", async () => {
  const { api } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("c++(");
  expect(await screen.findByText("Nothing matched “c++(”")).toBeTruthy();
});

test("result rows open the card and remember the search", async () => {
  const { api } = apiWith([BEST, SECOND]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("dumpling");
  await fireEvent.press(await screen.findByText("Dumpling spot in Chinatown"));
  expect(mockRouter.push).toHaveBeenCalledWith("/reel/best");
  await fireEvent.press(screen.getByText("Soup dumplings at home"));
  expect(mockRouter.push).toHaveBeenCalledWith("/reel/second");
  await waitFor(async () =>
    expect(JSON.parse((await AsyncStorage.getItem(RECENT_KEY)) ?? "[]")).toEqual(["dumpling"]),
  );
});

test("as the tab root there is no Back button", async () => {
  await renderWithProviders(<SearchScreen />);
  expect(screen.queryByLabelText("Back")).toBeNull();
});

test("pushed over another screen it has a Back button", async () => {
  mockStackIndex = 1;
  await renderWithProviders(<SearchScreen />);
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
});

test("Back with no history goes Home", async () => {
  mockStackIndex = 1;
  mockCanGoBack = false;
  await renderWithProviders(<SearchScreen />);
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("a q param runs on open", async () => {
  mockParams = { q: "dumpling" };
  const { api, search } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(await screen.findByText("Dumpling spot in Chinatown")).toBeTruthy();
  expect(screen.getByDisplayValue("dumpling")).toBeTruthy();
  expect(search).toHaveBeenCalledWith("dumpling");
});

test("a new q param on the mounted tab replaces the query", async () => {
  mockParams = { q: "dumpling" };
  const { api } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  expect(screen.getByDisplayValue("dumpling")).toBeTruthy();
  // The router hands the screen a new q (the next render picks it up; typing causes one).
  mockParams = { q: "zzzz" };
  await fireEvent.changeText(screen.getByPlaceholderText(PLACEHOLDER), "dump");
  expect(screen.getByDisplayValue("zzzz")).toBeTruthy();
});

test("the search box takes at most 200 characters", async () => {
  await renderWithProviders(<SearchScreen />);
  expect(screen.getByPlaceholderText(PLACEHOLDER).props.maxLength).toBe(200);
});

test("clearing the field returns to the empty state", async () => {
  const { api } = apiWith([BEST]);
  await renderWithProviders(<SearchScreen />, { api });
  await type("dumpling");
  await screen.findByText("Best match");
  await fireEvent.press(screen.getByLabelText("Clear"));
  expect(screen.getByText("Find a reel by what you remember")).toBeTruthy();
  expect(screen.getByDisplayValue("")).toBeTruthy();
});

test("a failed search says so with a retry that asks again", async () => {
  mockParams = { q: "cafe" };
  const search = jest.fn(async () => Promise.reject(new Error("down")));
  const api = { ...demoApi(), search };
  await renderWithProviders(<SearchScreen />, { api });
  expect(await screen.findByText("Couldn't search right now")).toBeTruthy();
  // Not "check your connection": the phone is online, it is Lately's search that did not answer.
  expect(screen.getByText("Lately's search isn't responding. Try again in a minute.")).toBeTruthy();
  expect(screen.queryByText("Check your connection and try again.")).toBeNull();
  const calls = search.mock.calls.length;
  await fireEvent.press(screen.getByText("Try again"));
  await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(calls));
});

test("offline says so instead of blaming the search", async () => {
  mockParams = { q: "cafe" };
  const api = { ...demoApi(), search: jest.fn(async () => Promise.reject(new ApiError("NETWORK", 0))) };
  await renderWithProviders(<SearchScreen />, { api });
  expect(await screen.findByText("You're offline")).toBeTruthy();
  expect(screen.getByText("Search needs a connection. Try again when you're back online.")).toBeTruthy();
  expect(screen.getByText("Try again")).toBeTruthy();
});
