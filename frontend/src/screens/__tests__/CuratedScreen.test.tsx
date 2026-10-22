import { fireEvent, screen } from "@testing-library/react-native";

import type { CuratedFeed } from "../../api/contract";
import { sentence } from "../../components/home/BackForYou";
import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { CuratedScreen } from "../CuratedScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Link: require("../../test/expoRouterMock").mockLink(() => mockRouter),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

// The words come from the demo feed itself, so rewording the demo content never breaks these.
const demoFeed = () => demoApi().getCurated();

test("is named Back for you, like the row on Home that opens it, and says what the picks are", async () => {
  const feed = await demoFeed();
  await renderWithProviders(<CuratedScreen />);
  const title = await screen.findByText("Back for you");
  expect(title.props.accessibilityRole).toBe("header");
  expect(screen.queryByText("Curated for you")).toBeNull();
  expect(await screen.findByText(`${feed.date_label} · picked from your saves`)).toBeTruthy();
});

test("shows the hero pick, with its label read as a sentence, and every section", async () => {
  const feed = await demoFeed();
  await renderWithProviders(<CuratedScreen />);
  // The feed shouts its label ("THIS WEEK"); the screen reads it like the tiles on Home do.
  expect(await screen.findByText(sentence(feed.hero.label))).toBeTruthy();
  expect(screen.queryByText(feed.hero.label)).toBeNull();
  expect(screen.getByText(feed.hero.title)).toBeTruthy();
  for (const section of feed.sections) {
    if (section.saves.length > 0) expect(screen.getByText(section.title)).toBeTruthy();
  }
});

test("the hero picture is a button named for the pick", async () => {
  const feed = await demoFeed();
  await renderWithProviders(<CuratedScreen />);
  await screen.findByText(feed.hero.title);
  await fireEvent.press(screen.getByRole("button", { name: feed.hero.title }));
  expect(mockRouter.push).toHaveBeenCalledWith(`/reel/${feed.hero.save_ids[0]}`);
});

test("See all searches the hero's topic; cards open", async () => {
  const feed = await demoFeed();
  await renderWithProviders(<CuratedScreen />);
  await fireEvent.press(await screen.findByText(`See all ${feed.hero.save_ids.length}`));
  expect(mockRouter.push).toHaveBeenCalledWith(`/search?q=${encodeURIComponent(feed.hero.query)}`);
  const first = feed.sections.flatMap((s) => s.saves).find((s) => s.status === "enriched" && s.title);
  await fireEvent.press(screen.getAllByText(first!.title!)[0]);
  expect(mockRouter.push).toHaveBeenCalledWith(`/reel/${first!.id}`);
});

test("a feed with nothing in it says what will fill it, without a sparkle", async () => {
  const base = demoApi();
  const real = await base.getCurated();
  const empty: CuratedFeed = { ...real, sections: [], hero: { ...real.hero, save_ids: [], image_url: null } };
  await renderWithProviders(<CuratedScreen />, { api: { ...base, getCurated: async () => empty } });
  expect(await screen.findByText("Nothing to resurface yet")).toBeTruthy();
  expect(screen.getByText("Save a few reels and Lately will bring back ones you haven't looked at in a while.")).toBeTruthy();
});

test("a failed curated load shows an error with retry", async () => {
  const api = { ...demoApi(), getCurated: async () => Promise.reject(new Error("down")) };
  await renderWithProviders(<CuratedScreen />, { api });
  expect(await screen.findByText("Couldn't load your picks")).toBeTruthy();
  expect(screen.getByText("Try again")).toBeTruthy();
});
