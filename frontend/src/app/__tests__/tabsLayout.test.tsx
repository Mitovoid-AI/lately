import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import TabsLayout from "../(tabs)/_layout";

interface ScreenProps {
  name: string;
  options?: { title?: string };
  listeners?: { tabPress?: (e: { preventDefault: () => void }) => void };
}

// A stand-in for expo-router's Tabs that records the screens the layout declares.
const mockScreens: ScreenProps[] = [];
const mockRouter = { push: jest.fn() };
jest.mock("expo-router", () => {
  function Tabs({ children }: { children: ReactNode }) {
    return children;
  }
  Tabs.Screen = function Screen(props: ScreenProps) {
    mockScreens.push(props);
    return null;
  };
  return { Tabs, useRouter: () => mockRouter };
});

beforeEach(() => {
  mockScreens.length = 0;
  jest.clearAllMocks();
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
