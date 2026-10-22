import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { ApiError, type LatelyApi, type Me } from "../../api/contract";
import { buildDemoSeed } from "../../api/demo-data";
import { sentence } from "../../components/home/BackForYou";
import { countOf } from "../../lib/counts";
import { SEARCH_EXAMPLES } from "../../lib/searchExamples";
import { enqueueSave, queueKey } from "../../lib/saveQueue";
import { NOW } from "../../test/fixtures";
import { createMemoryStore } from "../../test/memoryStore";
import { demoApi, renderWithProviders } from "../../test/render";
import { HomeScreen } from "../HomeScreen";
import { LibraryScreen } from "../LibraryScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Link: require("../../test/expoRouterMock").mockLink(() => mockRouter),
}));

// Titles come from the demo data itself, so rewording the demo content never breaks these.
const seed = buildDemoSeed(NOW).saves;
const titleOf = (id: string) => seed.find((s) => s.id === id)!.title!;
const MOMO = titleOf("s-momo");
const GITHUB = titleOf("s-github");
const TOTAL = countOf(seed.length, "save");

/** The demo API with no "Back for you" picks, so a card's title shows once (in the grid). */
function quiet(api: LatelyApi = demoApi()): LatelyApi {
  return { ...api, getCurated: () => Promise.reject(new Error("no picks")) };
}

beforeEach(() => {
  jest.clearAllMocks();
  // A fixed clock: the demo's pending save is 60 s old.
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

test("the Library name still points at Home", () => {
  expect(LibraryScreen).toBe(HomeScreen);
});

test("shows the saved reels and the total count", async () => {
  await renderWithProviders(<HomeScreen />, { api: quiet() });
  expect(await screen.findByText(MOMO)).toBeTruthy();
  expect(screen.getByText(GITHUB)).toBeTruthy();
  expect(await screen.findByText(TOTAL)).toBeTruthy();
  expect(screen.getByText("Recently saved")).toBeTruthy();
});

test("category chips filter the grid", async () => {
  await renderWithProviders(<HomeScreen />, { api: quiet() });
  await screen.findByText(MOMO);
  expect(screen.getByRole("button", { name: "All" })).toBeSelected();
  expect(screen.getByText("Watch Later")).toBeTruthy();
  await fireEvent.press(screen.getByText("Food & Places"));
  expect(await screen.findByText(MOMO)).toBeTruthy();
  await waitFor(() => expect(screen.queryByText(GITHUB)).toBeNull());
  // The section heading names the category and drops the library-wide count.
  expect(screen.queryByText(TOTAL)).toBeNull();
  await fireEvent.press(screen.getByText("All"));
  expect(await screen.findByText(GITHUB)).toBeTruthy();
});

test("switching category shows the matching cached cards at once, not a skeleton", async () => {
  const api = demoApi();
  const listSaves = jest.spyOn(api, "listSaves");
  await renderWithProviders(<HomeScreen />, { api: quiet(api) });
  await screen.findByText(MOMO);
  // The category request never answers: whatever shows comes from the "all" cache.
  listSaves.mockImplementation(() => new Promise(() => {}));
  await fireEvent.press(screen.getByText("Food & Places"));
  expect(screen.getByText(MOMO)).toBeTruthy();
  expect(screen.queryByText(GITHUB)).toBeNull();
});

test("only categories present in the saves get a chip", async () => {
  const api = demoApi();
  const all = await api.listSaves({ limit: 100 });
  const twoKinds: LatelyApi = {
    ...quiet(api),
    listSaves: async () => all.filter((s) => s.category === "Food & Places" || s.category === "Dev & Tools"),
  };
  await renderWithProviders(<HomeScreen />, { api: twoKinds });
  await screen.findByText(MOMO);
  expect(screen.getByRole("button", { name: "Food & Places" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Dev & Tools" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Fitness" })).toBeNull();
});

test("with one category there is nothing to filter, so no chips at all", async () => {
  const api = demoApi();
  const all = await api.listSaves({ limit: 100 });
  const onlyFood: LatelyApi = {
    ...quiet(api),
    listSaves: async () => all.filter((s) => s.category === "Food & Places"),
  };
  await renderWithProviders(<HomeScreen />, { api: onlyFood });
  await screen.findByText(MOMO);
  expect(screen.queryByRole("button", { name: "All" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Food & Places" })).toBeNull();
  // The grid and its heading are still there.
  expect(screen.getByText("Recently saved")).toBeTruthy();
});

test("a category chip asks the API for that category", async () => {
  const api = demoApi();
  const listSaves = jest.spyOn(api, "listSaves");
  await renderWithProviders(<HomeScreen />, { api: quiet(api) });
  await screen.findByText(MOMO);
  // The chip, by role: a Fitness card carries a "Fitness" pill of its own on its tile.
  await fireEvent.press(screen.getByRole("button", { name: "Fitness" }));
  expect(listSaves).toHaveBeenCalledWith(expect.objectContaining({ category: "Fitness" }));
});

describe("the top of Home", () => {
  test("the search field, a card and the avatar navigate", async () => {
    await renderWithProviders(<HomeScreen />, { api: quiet() });
    await fireEvent.press(await screen.findByText(MOMO));
    expect(mockRouter.push).toHaveBeenCalledWith("/reel/s-momo");
    await fireEvent.press(screen.getByRole("button", { name: "Search your saves" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/search");
    await fireEvent.press(screen.getByLabelText("Account"));
    expect(mockRouter.push).toHaveBeenCalledWith("/account");
  });

  test("the search field shows an example query from the shared list", async () => {
    await renderWithProviders(<HomeScreen />, { api: quiet() });
    expect(await screen.findByText(`“${SEARCH_EXAMPLES[0]}”`)).toBeTruthy();
  });

  test("there is no Stacks shortcut in the header and no floating Paste link button", async () => {
    await renderWithProviders(<HomeScreen />, { api: quiet() });
    await screen.findByText(MOMO);
    expect(screen.queryByLabelText("Stacks")).toBeNull();
    expect(screen.queryByText("Paste link")).toBeNull();
  });
});

describe("cards being written", () => {
  test("a pending save is a tile in the grid that opens its card, with no bar of its own above it", async () => {
    await renderWithProviders(<HomeScreen />, { api: quiet() });
    await screen.findByText(MOMO);
    // The tile says which step it is on (the words are saveOutcome's, shared with the save sheet).
    await fireEvent.press(screen.getByLabelText(/Getting|Listening|Finding/));
    expect(mockRouter.push).toHaveBeenCalledWith("/reel/s-pending");
    // The old live bar's time estimate is gone for good.
    expect(screen.queryByText(/about 30 s/)).toBeNull();
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
  });

  test("with nothing pending no tile is waiting", async () => {
    const api = demoApi();
    const ready = (await api.listSaves({ limit: 100 })).filter((s) => s.status !== "pending");
    await renderWithProviders(<HomeScreen />, { api: { ...quiet(api), listSaves: async () => ready } });
    await screen.findByText(MOMO);
    expect(screen.queryByLabelText(/Getting|Listening|Finding/)).toBeNull();
  });
});

describe("Back for you", () => {
  test("shows picture tiles from the curated feed; See all opens Curated", async () => {
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Back for you")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "See all" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/curated");
    // The hero pick is a group of saves, so it opens the search that lists them.
    const { hero } = await demoApi().getCurated();
    await fireEvent.press(screen.getByLabelText(new RegExp(`, ${sentence(hero.label)}$`)));
    expect(mockRouter.push).toHaveBeenCalledWith(`/search?q=${encodeURIComponent(hero.query)}`);
  });

  test("a feed that fails leaves no box behind and the grid untouched", async () => {
    const api = quiet();
    await renderWithProviders(<HomeScreen />, { api });
    expect(await screen.findByText(MOMO)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Back for you")).toBeNull());
    expect(screen.queryByText("Try again")).toBeNull();
  });
});

describe("the first run", () => {
  const empty = (): LatelyApi => ({ ...demoApi(), listSaves: async () => [] });

  test("shows the idea as a picture, not three numbered steps", async () => {
    await renderWithProviders(<HomeScreen />, { api: empty() });
    expect(await screen.findByText("Every reel you save, findable in one search.")).toBeTruthy();
    expect(screen.getByText("Example")).toBeTruthy();
    expect(screen.getByText(/^In Instagram, tap Share/)).toBeTruthy();
    expect(screen.queryByText("Nothing saved yet")).toBeNull();
    expect(screen.queryByText("Open a reel in Instagram")).toBeNull();
    // Nothing saved means nothing to search or to bring back.
    expect(screen.queryByRole("button", { name: "Search your saves" })).toBeNull();
    expect(screen.queryByText("Back for you")).toBeNull();
  });

  test("Paste a link instead opens the save sheet", async () => {
    await renderWithProviders(<HomeScreen />, { api: empty() });
    await fireEvent.press(await screen.findByText("Paste a link instead"));
    expect(mockRouter.push).toHaveBeenCalledWith("/save-sheet");
  });

  test("Open Instagram tries the app first", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await renderWithProviders(<HomeScreen />, { api: empty() });
    await fireEvent.press(await screen.findByText("Open Instagram"));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith("instagram://"));
    expect(openURL).toHaveBeenCalledTimes(1);
    openURL.mockRestore();
  });

  test("and falls back to instagram.com when the app is not installed", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockRejectedValueOnce(new Error("no app"))
      .mockResolvedValue(true);
    await renderWithProviders(<HomeScreen />, { api: empty() });
    await fireEvent.press(await screen.findByText("Open Instagram"));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith("https://instagram.com"));
    expect(openURL).toHaveBeenNthCalledWith(1, "instagram://");
    openURL.mockRestore();
  });
});

test("a failed load says so instead of showing an empty library", async () => {
  const api: LatelyApi = { ...demoApi(), listSaves: async () => Promise.reject(new ApiError("NETWORK", 0)) };
  await renderWithProviders(<HomeScreen />, { api });
  expect(await screen.findByText("Couldn't load your saves")).toBeTruthy();
  expect(screen.queryByText("Every reel you save, findable in one search.")).toBeNull();
  expect(screen.getByText("Try again")).toBeTruthy();
});

test("saves waiting offline show as queued and can be retried", async () => {
  const queueStore = createMemoryStore();
  await enqueueSave(queueStore, queueKey("demo-user"), "https://www.instagram.com/reel/OFF1/");
  const api = demoApi();
  const createSave = jest.spyOn(api, "createSave").mockRejectedValue(new ApiError("NETWORK", 0));
  await renderWithProviders(<HomeScreen />, { api: quiet(api), queueStore });
  expect(await screen.findByText("1 reel waiting to save")).toBeTruthy();
  await waitFor(() => expect(createSave).toHaveBeenCalledTimes(1));
  createSave.mockResolvedValueOnce({ reel_id: "s-new", deduped: false, status: "pending" });
  await fireEvent.press(screen.getByText("Retry"));
  await waitFor(() => expect(screen.queryByText("1 reel waiting to save")).toBeNull());
  expect(createSave).toHaveBeenCalledTimes(2);
});

test("several queued saves read as plural", async () => {
  const queueStore = createMemoryStore();
  await enqueueSave(queueStore, queueKey("demo-user"), "https://www.instagram.com/reel/OFF1/");
  await enqueueSave(queueStore, queueKey("demo-user"), "https://www.instagram.com/reel/OFF2/");
  const api = demoApi();
  jest.spyOn(api, "createSave").mockRejectedValue(new ApiError("NETWORK", 0));
  await renderWithProviders(<HomeScreen />, { api: quiet(api), queueStore });
  expect(await screen.findByText("2 reels waiting to save")).toBeTruthy();
  expect(screen.getByText("Lately will send them as soon as it can.")).toBeTruthy();
});

/** Every string in the rendered tree, in reading order. */
function renderedTexts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(renderedTexts);
  if (node && typeof node === "object" && "children" in node) return renderedTexts((node as { children: unknown }).children);
  return [];
}

describe("the free-saves banner", () => {
  /** The demo API, with GET /me reporting this much of the free limit used. */
  function withUsage(over: Partial<Me>): LatelyApi {
    const base = demoApi();
    return { ...base, getMe: async () => ({ ...(await base.getMe()), saves_limit: 20, ...over }) };
  }

  test("nothing shows while more than 3 saves are left", async () => {
    await renderWithProviders(<HomeScreen />, { api: withUsage({ plan: "free", saves_this_month: 16 }) });
    await screen.findByText(TOTAL);
    expect(screen.queryByText(/free saves? left this month/)).toBeNull();
    expect(screen.queryByText("Upgrade to Pro")).toBeNull();
  });

  test("with 3 left it counts them and offers Pro", async () => {
    await renderWithProviders(<HomeScreen />, { api: withUsage({ plan: "free", saves_this_month: 17 }) });
    expect(await screen.findByText("3 free saves left this month")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/pro");
  });

  test("with 1 left it reads in the singular", async () => {
    await renderWithProviders(<HomeScreen />, { api: withUsage({ plan: "free", saves_this_month: 19 }) });
    expect(await screen.findByText("1 free save left this month")).toBeTruthy();
  });

  test("with none left it says the month's free saves are used", async () => {
    await renderWithProviders(<HomeScreen />, { api: withUsage({ plan: "free", saves_this_month: 20 }) });
    expect(await screen.findByText("You've used this month's free saves")).toBeTruthy();
    expect(screen.queryByText(/free saves? left/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/pro");
  });

  test("going over (a lowered limit) reads as none left, never a negative count", async () => {
    await renderWithProviders(<HomeScreen />, { api: withUsage({ plan: "free", saves_this_month: 24 }) });
    expect(await screen.findByText("You've used this month's free saves")).toBeTruthy();
  });

  test("never for Pro or Lifetime, however many saves were made", async () => {
    for (const plan of ["pro", "lifetime"] as const) {
      const view = await renderWithProviders(<HomeScreen />, { api: withUsage({ plan, saves_this_month: 50 }) });
      await screen.findByText(TOTAL);
      expect(screen.queryByText("Upgrade to Pro")).toBeNull();
      expect(screen.queryByText(/free saves?/)).toBeNull();
      await view.unmount();
    }
  });

  test("Home reads top to bottom: search, Pro banner, Back for you, then the grid", async () => {
    await renderWithProviders(<HomeScreen />, { api: withUsage({ plan: "free", saves_this_month: 18 }) });
    await screen.findByText("2 free saves left this month");
    await screen.findByText("Back for you");
    const texts = renderedTexts(screen.toJSON());
    const order = ["Search", "2 free saves left this month", "Back for you", "Recently saved"].map((t) =>
      texts.indexOf(t),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("the offline-queue banner sits with the Pro banner, above Back for you", async () => {
    const queueStore = createMemoryStore();
    await enqueueSave(queueStore, queueKey("demo-user"), "https://www.instagram.com/reel/OFF1/");
    const api = withUsage({ plan: "free", saves_this_month: 18 });
    jest.spyOn(api, "createSave").mockRejectedValue(new ApiError("NETWORK", 0));
    await renderWithProviders(<HomeScreen />, { api, queueStore });
    await screen.findByText("1 reel waiting to save");
    await screen.findByText("Back for you");
    const texts = renderedTexts(screen.toJSON());
    const [pro, queued, back] = ["2 free saves left this month", "1 reel waiting to save", "Back for you"].map((t) =>
      texts.indexOf(t),
    );
    expect(pro).toBeGreaterThan(-1);
    expect(pro).toBeLessThan(queued);
    expect(queued).toBeLessThan(back);
  });
});
