import { render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import TabsLayout from "../(tabs)/_layout";
import type { InstagramGate } from "../../components/settings/useInstagramGate";

let mockGate: InstagramGate = "open";
jest.mock("../../components/settings/useInstagramGate", () => ({ useInstagramGate: () => mockGate }));
jest.mock("../../theme/ThemeProvider", () => ({ useTheme: () => ({ colors: { ink2: "#555" } }) }));

interface ScreenProps {
  name: string;
  options?: { title?: string };
  listeners?: { tabPress?: (e: { preventDefault: () => void }) => void };
}

// A stand-in for expo-router's Tabs that records the screens the layout declares.
const mockScreens: ScreenProps[] = [];
const mockRouter = { push: jest.fn() };
const mockRedirects: string[] = [];
jest.mock("expo-router", () => {
  function Tabs({ children }: { children: ReactNode }) {
    return children;
  }
  Tabs.Screen = function Screen(props: ScreenProps) {
    mockScreens.push(props);
    return null;
  };
  function Redirect({ href }: { href: string }) {
    mockRedirects.push(href);
    return null;
  }
  return { Tabs, Redirect, useRouter: () => mockRouter };
});

beforeEach(() => {
  mockScreens.length = 0;
  mockRedirects.length = 0;
  mockGate = "open";
  jest.clearAllMocks();
});

test("an account that hasn't connected Instagram is sent to connect it first, with no tabs", async () => {
  mockGate = "connect";
  await render(<TabsLayout />);
  expect(mockRedirects).toEqual(["/connect-instagram"]);
  expect(mockScreens).toEqual([]);
});

test("while the Instagram check runs, a named spinner shows instead of the tabs", async () => {
  mockGate = "checking";
  await render(<TabsLayout />);
  expect(screen.getByLabelText("Loading Lately")).toBeTruthy();
  expect(mockScreens).toEqual([]);
  expect(mockRedirects).toEqual([]);
});

test("a connected account (or one the check let through) gets the tabs and no redirect", async () => {
  await render(<TabsLayout />);
  expect(mockRedirects).toEqual([]);
  expect(mockScreens.map((s) => s.name)).toEqual(["index", "search", "save", "stacks"]);
});

test("the bar is Home, Search, Save, Stacks, in that order", async () => {
  await render(<TabsLayout />);
  expect(mockScreens.map((s) => [s.name, s.options?.title])).toEqual([
    ["index", "Home"],
    ["search", "Search"],
    ["save", "Save"],
    ["stacks", "Stacks"],
  ]);
});

test("Curated is not a tab any more", async () => {
  await render(<TabsLayout />);
  expect(mockScreens.map((s) => s.name)).not.toContain("curated");
});

test("pressing Save opens the save sheet over the current tab instead of switching to it", async () => {
  await render(<TabsLayout />);
  const save = mockScreens.find((s) => s.name === "save")!;
  const event = { preventDefault: jest.fn() };
  save.listeners!.tabPress!(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith("/save-sheet");
});

test("the other tabs switch normally", async () => {
  await render(<TabsLayout />);
  for (const name of ["index", "search", "stacks"]) {
    expect(mockScreens.find((s) => s.name === name)!.listeners).toBeUndefined();
  }
});
