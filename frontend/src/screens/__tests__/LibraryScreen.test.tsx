import { fireEvent, screen } from "@testing-library/react-native";

import type { LatelyApi } from "../../api/contract";
import { demoApi, renderWithProviders } from "../../test/render";
import { LibraryScreen } from "../LibraryScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

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
  expect(screen.queryByText(GITHUB)).toBeNull();
  expect(screen.getByText(MOMO)).toBeTruthy();
  await fireEvent.press(screen.getByText("All"));
  expect(screen.getByText(GITHUB)).toBeTruthy();
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
  await fireEvent.press(screen.getByText("Search what you remember..."));
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
  expect(await screen.findByText("Your Lately is empty — for now")).toBeTruthy();
  await fireEvent.press(screen.getByText("Paste a link instead"));
  expect(mockRouter.push).toHaveBeenCalledWith("/save-sheet");
});
