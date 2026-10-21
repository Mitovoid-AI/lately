import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { ApiError, type LatelyApi, type Me } from "../../api/contract";
import { enqueueSave, queueKey } from "../../lib/saveQueue";
import { createMemoryStore } from "../../test/memoryStore";
import { demoApi, renderWithProviders } from "../../test/render";
import { LibraryScreen } from "../LibraryScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Link: require("../../test/expoRouterMock").mockLink(() => mockRouter),
}));

const MOMO = "Hole-in-the-wall momo spot in Koramangala";
const GITHUB = "5 GitHub search tricks to find great repos";

beforeEach(() => jest.clearAllMocks());

test("shows the saved reels and the total count", async () => {
  await renderWithProviders(<LibraryScreen />);
  expect(await screen.findByText(MOMO)).toBeTruthy();
  expect(screen.getByText(GITHUB)).toBeTruthy();
  expect(await screen.findByText("13 reels")).toBeTruthy();
  expect(screen.getByText("RECENTLY SAVED")).toBeTruthy();
});

test("category chips filter the grid", async () => {
  await renderWithProviders(<LibraryScreen />);
  await screen.findByText(MOMO);
  expect(screen.getByRole("button", { name: "All" })).toBeSelected();
  expect(screen.getByText("Watch Later")).toBeTruthy();
  await fireEvent.press(screen.getByText("Food & Places"));
  expect(await screen.findByText(MOMO)).toBeTruthy();
  await waitFor(() => expect(screen.queryByText(GITHUB)).toBeNull());
  await fireEvent.press(screen.getByText("All"));
  expect(await screen.findByText(GITHUB)).toBeTruthy();
});

test("switching category shows the matching cached cards at once, not a skeleton", async () => {
  const api = demoApi();
  const listSaves = jest.spyOn(api, "listSaves");
  await renderWithProviders(<LibraryScreen />, { api });
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
  const onlyFood: LatelyApi = {
    ...api,
    listSaves: async () => all.filter((s) => s.category === "Food & Places"),
  };
  await renderWithProviders(<LibraryScreen />, { api: onlyFood });
  await screen.findByText(MOMO);
  expect(screen.queryByText("Dev & Tools")).toBeNull();
  expect(screen.getByText("Food & Places")).toBeTruthy();
});

test("header, search, cards and the paste button navigate", async () => {
  await renderWithProviders(<LibraryScreen />);
  await fireEvent.press(await screen.findByText(MOMO));
  expect(mockRouter.push).toHaveBeenCalledWith("/reel/s-momo");
  await fireEvent.press(screen.getByText("Search what you remember…"));
  expect(mockRouter.push).toHaveBeenCalledWith("/search");
  await fireEvent.press(screen.getByLabelText("Account"));
  expect(mockRouter.push).toHaveBeenCalledWith("/account");
  await fireEvent.press(screen.getByLabelText("Stacks"));
  expect(mockRouter.push).toHaveBeenCalledWith("/stacks");
  await fireEvent.press(screen.getByText("Paste link"));
  expect(mockRouter.push).toHaveBeenCalledWith("/save-sheet");
});

test("an empty library shows the first-run state", async () => {
  const api: LatelyApi = { ...demoApi(), listSaves: async () => [] };
  await renderWithProviders(<LibraryScreen />, { api });
  expect(await screen.findByText("Nothing saved yet")).toBeTruthy();
  await fireEvent.press(screen.getByText("Paste a link instead"));
  expect(mockRouter.push).toHaveBeenCalledWith("/save-sheet");
});

test("a failed load says so instead of showing an empty library", async () => {
  const api: LatelyApi = { ...demoApi(), listSaves: async () => Promise.reject(new ApiError("NETWORK", 0)) };
  await renderWithProviders(<LibraryScreen />, { api });
  expect(await screen.findByText("Couldn't load your reels")).toBeTruthy();
  expect(screen.queryByText("Nothing saved yet")).toBeNull();
  expect(screen.getByText("Try again")).toBeTruthy();
});

test("a category chip asks the API for that category", async () => {
  const api = demoApi();
  const listSaves = jest.spyOn(api, "listSaves");
  await renderWithProviders(<LibraryScreen />, { api });
  await screen.findByText(MOMO);
  await fireEvent.press(screen.getByText("Fitness"));
  expect(listSaves).toHaveBeenCalledWith(expect.objectContaining({ category: "Fitness" }));
});

test("saves waiting offline show as queued and can be retried", async () => {
  const queueStore = createMemoryStore();
  await enqueueSave(queueStore, queueKey("demo-user"), "https://www.instagram.com/reel/OFF1/");
  const api = demoApi();
  const createSave = jest.spyOn(api, "createSave").mockRejectedValue(new ApiError("NETWORK", 0));
  await renderWithProviders(<LibraryScreen />, { api, queueStore });
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
  await renderWithProviders(<LibraryScreen />, { api, queueStore });
  expect(await screen.findByText("2 reels waiting to save")).toBeTruthy();
  expect(screen.getByText("Lately saves them when you're back online.")).toBeTruthy();
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
    await renderWithProviders(<LibraryScreen />, { api: withUsage({ plan: "free", saves_this_month: 16 }) });
    await screen.findByText("13 reels");
    expect(screen.queryByText(/free saves? left this month/)).toBeNull();
    expect(screen.queryByText("Go Pro")).toBeNull();
  });

  test("with 3 left it counts them and offers Pro", async () => {
    await renderWithProviders(<LibraryScreen />, { api: withUsage({ plan: "free", saves_this_month: 17 }) });
    expect(await screen.findByText("3 free saves left this month")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Go Pro" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/pro");
  });

  test("with 1 left it reads in the singular", async () => {
    await renderWithProviders(<LibraryScreen />, { api: withUsage({ plan: "free", saves_this_month: 19 }) });
    expect(await screen.findByText("1 free save left this month")).toBeTruthy();
  });

  test("with none left it says the month's free saves are used", async () => {
    await renderWithProviders(<LibraryScreen />, { api: withUsage({ plan: "free", saves_this_month: 20 }) });
    expect(await screen.findByText("You've used this month's free saves")).toBeTruthy();
    expect(screen.queryByText(/free saves? left/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Go Pro" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/pro");
  });

  test("going over (a lowered limit) reads as none left, never a negative count", async () => {
    await renderWithProviders(<LibraryScreen />, { api: withUsage({ plan: "free", saves_this_month: 24 }) });
    expect(await screen.findByText("You've used this month's free saves")).toBeTruthy();
  });

  test("never for Pro or Lifetime, however many saves were made", async () => {
    for (const plan of ["pro", "lifetime"] as const) {
      const view = await renderWithProviders(<LibraryScreen />, { api: withUsage({ plan, saves_this_month: 50 }) });
      await screen.findByText("13 reels");
      expect(screen.queryByText("Go Pro")).toBeNull();
      expect(screen.queryByText(/free saves?/)).toBeNull();
      await view.unmount();
    }
  });

  test("it sits right under the search field, above the list", async () => {
    await renderWithProviders(<LibraryScreen />, { api: withUsage({ plan: "free", saves_this_month: 18 }) });
    await screen.findByText("2 free saves left this month");
    const texts = renderedTexts(screen.toJSON());
    const [search, banner, list] = ["Search what you remember…", "2 free saves left this month", "RECENTLY SAVED"].map((t) => texts.indexOf(t));
    expect(search).toBeGreaterThan(-1);
    expect(search).toBeLessThan(banner);
    expect(banner).toBeLessThan(list);
  });
});
