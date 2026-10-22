import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Keyboard, Platform } from "react-native";

import { TabBar } from "../TabBar";

type BarProps = Parameters<typeof TabBar>[0];

const ROUTES = [
  { key: "index-1", name: "index" },
  { key: "search-1", name: "search" },
  { key: "save-1", name: "save" },
  { key: "stacks-1", name: "stacks" },
];
const TITLES: Record<string, string> = { index: "Home", search: "Search", save: "Save", stacks: "Stacks" };

/** The props expo-router hands the tab bar, reduced to what it reads. */
function barProps(index = 0, defaultPrevented = false) {
  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented })),
    navigate: jest.fn(),
  };
  const props = {
    state: { index, routes: ROUTES },
    descriptors: Object.fromEntries(ROUTES.map((r) => [r.key, { options: { title: TITLES[r.name] } }])),
    navigation,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  } as unknown as BarProps;
  return { props, navigation };
}

test("shows Home, Search, Save and Stacks, and no Curated", async () => {
  await render(<TabBar {...barProps().props} />);
  for (const label of ["Home", "Search", "Save", "Stacks"]) expect(screen.getByLabelText(label)).toBeTruthy();
  expect(screen.queryByText("Curated")).toBeNull();
  expect(screen.queryByText("Library")).toBeNull();
});

test("the labels stop growing with the text size at 1.2x, so the fourth tab stays in the bar", async () => {
  await render(<TabBar {...barProps().props} />);
  for (const label of ["Home", "Search", "Save", "Stacks"]) {
    expect(screen.getByText(label).props.maxFontSizeMultiplier).toBe(1.2);
  }
});

test("the current place is selected; Save is an action, never selected", async () => {
  await render(<TabBar {...barProps(1).props} />);
  expect(screen.getByRole("tab", { name: "Search" })).toBeSelected();
  expect(screen.getByRole("tab", { name: "Home" })).not.toBeSelected();
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "Save" })).toBeNull();
});

test("tapping another tab announces the press and switches to it", async () => {
  const { props, navigation } = barProps(0);
  await render(<TabBar {...props} />);
  await fireEvent.press(screen.getByRole("tab", { name: "Search" }));
  expect(navigation.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "tabPress", target: "search-1" }));
  expect(navigation.navigate).toHaveBeenCalledWith("search");
});

test("tapping the tab you are on does nothing more", async () => {
  const { props, navigation } = barProps(0);
  await render(<TabBar {...props} />);
  await fireEvent.press(screen.getByRole("tab", { name: "Home" }));
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test("a prevented press (Save opens the sheet) does not switch tabs", async () => {
  const { props, navigation } = barProps(0, true);
  await render(<TabBar {...props} />);
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(navigation.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "tabPress", target: "save-1" }));
  expect(navigation.navigate).not.toHaveBeenCalled();
});

describe("on Android the keyboard owns the bottom of the screen", () => {
  let handlers: Record<string, () => void>;
  let os: ReturnType<typeof jest.replaceProperty>;
  let addListener: jest.SpyInstance;
  beforeEach(() => {
    handlers = {};
    os = jest.replaceProperty(Platform, "OS", "android");
    addListener = jest.spyOn(Keyboard, "addListener").mockImplementation(((event: string, listener: () => void) => {
      handlers[event] = listener;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
  });
  afterEach(() => {
    addListener.mockRestore();
    os.restore();
  });

  test("the bar steps aside while it is up and returns when it closes", async () => {
    await render(<TabBar {...barProps().props} />);
    expect(screen.getByLabelText("Home")).toBeTruthy();
    await act(async () => handlers.keyboardDidShow());
    expect(screen.queryByLabelText("Home")).toBeNull();
    await act(async () => handlers.keyboardDidHide());
    expect(screen.getByLabelText("Home")).toBeTruthy();
  });
});
