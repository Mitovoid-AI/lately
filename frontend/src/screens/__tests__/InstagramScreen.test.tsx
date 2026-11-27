import { act, fireEvent, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, Linking } from "react-native";

import { ApiError, type InstagramLink } from "../../api/contract";
import { INSTAGRAM_CODE_MS } from "../../api/demo";
import { NOW } from "../../test/fixtures";
import { demoApi, renderWithProviders } from "../../test/render";
import { InstagramScreen, LINK_POLL_MS } from "../InstagramScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
// useFocusEffect as the router runs it: the effect while the screen is in front, its cleanup on leaving.
const mockFocus = { focused: true, listeners: new Set<() => void>() };
jest.mock("expo-router", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require("react") as typeof import("react");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => {
      const [focused, setFocused] = React.useState(mockFocus.focused);
      React.useEffect(() => {
        const l = () => setFocused(mockFocus.focused);
        mockFocus.listeners.add(l);
        return () => {
          mockFocus.listeners.delete(l);
        };
      }, []);
      React.useEffect(() => (focused ? effect() : undefined), [focused, effect]);
    },
  };
});
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

const setFocus = (focused: boolean) =>
  act(async () => {
    mockFocus.focused = focused;
    mockFocus.listeners.forEach((l) => l());
  });

/** Moves the fake clock; a check that falls due goes out before this returns (findBy waits for what it changes). */
const tick = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus.focused = true;
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => jest.useRealTimers());

/** The demo API on the fake clock. Its second look after a code was made finds the code sent. */
function open(api = demoApi(() => Date.now())) {
  const getInstagramLink = jest.spyOn(api, "getInstagramLink");
  return renderWithProviders(<InstagramScreen />, { api }).then((view) => ({ ...view, getInstagramLink }));
}

/** A demo API whose codes are never sent: the code waits until it expires. */
function neverLinked() {
  const api = demoApi(() => Date.now());
  let link: InstagramLink = { enabled: true, handle: "lately.app", linked: false, linked_at: null, code: null, code_expires_at: null };
  const create = api.createInstagramCode.bind(api);
  const createInstagramCode = jest.spyOn(api, "createInstagramCode").mockImplementation(async () => (link = await create()));
  jest.spyOn(api, "getInstagramLink").mockImplementation(async () => link);
  return { api, createInstagramCode };
}

test("not linked: says how it works, then Connect shows the code to send, with Copy and Open Instagram", async () => {
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await open();
  expect(
    await screen.findByText(
      "Send any reel to @lately.app on Instagram and it's saved to your Lately library. First, connect your account once.",
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Connect Instagram" }));
  await tick(0);
  const code = screen.getByText(/^LATELY-[A-Z0-9]{6}$/);
  expect(screen.getByText("Send this code to @lately.app as a message.")).toBeTruthy();
  expect(screen.getByText("Expires in 15 minutes")).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: "Copy" }));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(code.props.children);
  expect(await screen.findByText("Code copied")).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: "Open Instagram" }));
  expect(openUrl).toHaveBeenCalledWith("https://ig.me/m/lately.app");
  openUrl.mockRestore();
});

test("while the code shows it checks every 3 s; once it arrives: Connected, a success haptic and an announcement", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  const buzz = jest.spyOn(Haptics, "notificationAsync");
  const { getInstagramLink } = await open();
  await fireEvent.press(await screen.findByRole("button", { name: "Connect Instagram" }));
  await tick(0);
  const before = getInstagramLink.mock.calls.length;
  await tick(LINK_POLL_MS - 1);
  expect(getInstagramLink).toHaveBeenCalledTimes(before);
  await tick(1);
  expect(getInstagramLink).toHaveBeenCalledTimes(before + 1);
  expect(screen.queryByText("Connected")).toBeNull();
  await tick(LINK_POLL_MS);
  expect(getInstagramLink).toHaveBeenCalledTimes(before + 2);
  expect(await screen.findByText("Connected")).toBeTruthy();
  expect(announce).toHaveBeenCalledWith("Instagram connected");
  expect(buzz).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  expect(screen.getByText("In Instagram, tap Share on a reel, then send it to @lately.app.")).toBeTruthy();

  // Linked: no more checks.
  const linkedAt = getInstagramLink.mock.calls.length;
  await tick(LINK_POLL_MS * 5);
  expect(getInstagramLink).toHaveBeenCalledTimes(linkedAt);
  announce.mockRestore();
  buzz.mockRestore();
});

test("behind another screen it stops checking, and picks up again in front", async () => {
  const { getInstagramLink } = await open(neverLinked().api);
  await fireEvent.press(await screen.findByRole("button", { name: "Connect Instagram" }));
  await tick(0);
  await setFocus(false);
  const calls = getInstagramLink.mock.calls.length;
  await tick(LINK_POLL_MS * 4);
  expect(getInstagramLink).toHaveBeenCalledTimes(calls);
  await setFocus(true);
  await tick(LINK_POLL_MS);
  expect(getInstagramLink.mock.calls.length).toBeGreaterThan(calls);
});

test("a code that expires says so, stops checking, and Get a new code makes another", async () => {
  const { api, createInstagramCode: createSpy } = neverLinked();
  const { getInstagramLink } = await open(api);
  await fireEvent.press(await screen.findByRole("button", { name: "Connect Instagram" }));
  await tick(0);
  await tick(INSTAGRAM_CODE_MS + 10_000);
  expect(screen.getByText("That code expired")).toBeTruthy();
  const calls = getInstagramLink.mock.calls.length;
  await tick(LINK_POLL_MS * 4);
  expect(getInstagramLink).toHaveBeenCalledTimes(calls);

  await fireEvent.press(screen.getByRole("button", { name: "Get a new code" }));
  await tick(0);
  expect(createSpy).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Expires in 15 minutes")).toBeTruthy();
});

test("linked: Disconnect asks first, then disconnects", async () => {
  const api = demoApi(() => Date.now());
  const linked: InstagramLink = {
    enabled: true,
    handle: "lately.app",
    linked: true,
    linked_at: "2026-11-01T12:00:00.000Z",
    code: null,
    code_expires_at: null,
  };
  jest.spyOn(api, "getInstagramLink").mockResolvedValue(linked);
  const unlink = jest.spyOn(api, "unlinkInstagram");
  await renderWithProviders(<InstagramScreen />, { api });
  await tick(0);
  expect(screen.getByText("Since Nov 1, 2026")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Disconnect" }));
  expect(screen.getByText("Disconnect Instagram?")).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "Disconnect" });
  await fireEvent.press(buttons[buttons.length - 1]);
  await tick(0);
  expect(unlink).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Instagram disconnected")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Connect Instagram" })).toBeTruthy();
});

test("a failed load shows Try again; a failed code says so", async () => {
  const api = demoApi(() => Date.now());
  const get = jest.spyOn(api, "getInstagramLink").mockRejectedValueOnce(new ApiError("SERVER", 500));
  jest.spyOn(api, "createInstagramCode").mockRejectedValueOnce(new ApiError("NETWORK", 0));
  await renderWithProviders(<InstagramScreen />, { api });
  await tick(0);
  expect(screen.getByText("Couldn't load your Instagram connection")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  await tick(0);
  expect(get).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole("button", { name: "Connect Instagram" }));
  await tick(0);
  expect(screen.getByText("Couldn't get a code. Try again.")).toBeTruthy();
});

// Required: a new account's first screen (/connect-instagram).
test("required: no back button, a 'Connect your Instagram' title, and Sign out instead of a skip", async () => {
  await renderWithProviders(<InstagramScreen required />, { api: demoApi(() => Date.now()) });
  expect(await screen.findByRole("button", { name: "Connect Instagram" })).toBeTruthy();
  expect(screen.getByText("Connect your Instagram")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.queryByText(/skip/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
});

test("required: once the code arrives, Home opens (replace, so Back can't return here)", async () => {
  await renderWithProviders(<InstagramScreen required />, { api: demoApi(() => Date.now()) });
  await fireEvent.press(await screen.findByRole("button", { name: "Connect Instagram" }));
  await tick(0);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  // The demo's second check after the code finds it sent (as in the Connected test above).
  await tick(LINK_POLL_MS);
  await tick(LINK_POLL_MS);
  expect(await screen.findByText("Connected")).toBeTruthy();
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("required: with the feature switched off there is nothing to connect, so Home opens", async () => {
  const api = demoApi(() => Date.now());
  jest.spyOn(api, "getInstagramLink").mockResolvedValue({
    enabled: false, handle: null, linked: false, linked_at: null, code: null, code_expires_at: null,
  });
  await renderWithProviders(<InstagramScreen required />, { api });
  await tick(0);
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("required: Sign out signs out (the only way out besides connecting)", async () => {
  const signOut = jest.fn(async () => {});
  await renderWithProviders(<InstagramScreen required />, { api: neverLinked().api, auth: { signOut } });
  await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
  await tick(0);
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test("not required: the Account page keeps its back button and has no Sign out", async () => {
  await open();
  expect(await screen.findByRole("button", { name: "Back" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});
