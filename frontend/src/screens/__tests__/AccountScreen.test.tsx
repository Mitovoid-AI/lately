import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking, Text } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError, type InstagramLink, type LatelyApi, type Me, type Preferences } from "../../api/contract";
import { createDemoBilling } from "../../billing/demo";
import { PRO_CONFIRMING } from "../../billing/plans";
import { PLAY_SUBSCRIPTIONS_URL } from "../../billing/types";
import { createUnavailableBilling } from "../../billing/unavailable";
import { ISSUES_URL } from "../../components/settings/about";
import { monthYear } from "../../lib/dates";
import { DEVICE_PREFS_KEY, devicePrefsSnapshot, setDevicePref } from "../../lib/devicePrefs";
import { queueKey } from "../../lib/saveQueue";
import { fakeBilling } from "../../test/fakeBilling";
import { createMemoryStore } from "../../test/memoryStore";
import { PENDING_SHARE_KEY } from "../../share/ShareRouter";
import { loadThemePreference, THEME_KEY } from "../../theme/preference";
import { useTheme } from "../../theme/ThemeProvider";
import { ThemeSync } from "../../theme/ThemeSync";
import { demoApi, renderWithProviders } from "../../test/render";
import { onUpdateOffer } from "../../updates/offer";
import type { UpdateCheck } from "../../updates/release";
import { AccountScreen } from "../AccountScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
const mockShare = jest.fn(async (_name: string, _json: string) => {});
const mockDeleteExports = jest.fn();
jest.mock("../../lib/exportFile", () => ({
  shareExportFile: (n: string, j: string) => mockShare(n, j),
  deleteExportFiles: () => mockDeleteExports(),
}));
// A Play or web build unless a test says it is a GitHub test APK; the GitHub check is scripted.
const mockUpdateSource = jest.fn<{ repo: string; installedBuild: number } | null, []>();
const mockCheck = jest.fn<Promise<UpdateCheck>, [string, number]>();
jest.mock("../../updates/release", () => ({
  ...jest.requireActual("../../updates/release"),
  updateSource: () => mockUpdateSource(),
  checkForUpdate: (repo: string, build: number) => mockCheck(repo, build),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockUpdateSource.mockReturnValue(null);
  await setDevicePref("afterShare", "ask");
  await setDevicePref("haptics", true);
});

/** Let preference mutations finish so their cache updates happen inside the test. */
const settled = (client: QueryClient) => waitFor(() => expect(client.isMutating()).toBe(0));

async function open() {
  const api = demoApi();
  const updatePreferences = jest.spyOn(api, "updatePreferences");
  const requestExport = jest.spyOn(api, "requestExport");
  const view = await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Sam Carter");
  return { ...view, updatePreferences, requestExport };
}

test("shows the profile from the API", async () => {
  const { api } = await open();
  expect(screen.getByText("@samcarter · sam.carter@example.com")).toBeTruthy();
  // A save is the person's item; a reel is the Instagram video.
  expect(screen.getByText("13 saves")).toBeTruthy();
  expect(screen.queryByText(/saved reels/)).toBeNull();
  expect(screen.getByText("6 stacks")).toBeTruthy();
  expect(screen.getByText(`Member since ${monthYear((await api.getMe()).member_since)}`)).toBeTruthy();
  expect(screen.getByText("Google (sam.carter@example.com)")).toBeTruthy();
  // Lately never connects an Instagram account, so the profile never says it did.
  expect(screen.queryByText(/Connected to/)).toBeNull();
  expect(screen.queryByText(/Instagram \(/)).toBeNull();
  // No status word nothing checks, and no dead camera badge over the avatar.
  expect(screen.queryByText("Verified")).toBeNull();
  expect(screen.queryByText("Active")).toBeNull();
  expect(screen.queryByLabelText("Change photo")).toBeNull();
});

describe("while the profile loads or fails", () => {
  test("a failure says so, with Try again, and the rest of the screen stays usable", async () => {
    const base = demoApi();
    const getMe = jest.fn<Promise<Me>, []>().mockRejectedValueOnce(new Error("down")).mockImplementation(() => base.getMe());
    await renderWithProviders(<AccountScreen />, { api: { ...base, getMe } });
    expect(await screen.findByText("Couldn't load your plan")).toBeTruthy();
    expect(screen.getByText("Sign out")).toBeTruthy();
    expect(screen.getByText("Privacy Policy")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Free plan")).toBeTruthy();
    expect(screen.queryByText("Couldn't load your plan")).toBeNull();
  });

  test("until it arrives there is a placeholder, not a blank gap or a wrong plan", async () => {
    const base = demoApi();
    await renderWithProviders(<AccountScreen />, { api: { ...base, getMe: () => new Promise<Me>(() => {}) } });
    expect(screen.getByText("Account and settings")).toBeTruthy();
    expect(screen.queryByText("Free plan")).toBeNull();
    expect(screen.queryByText("Couldn't load your plan")).toBeNull();
    expect(screen.queryByText("?")).toBeNull();
  });
});

test("reading font and text size are saved", async () => {
  const { updatePreferences, client } = await open();
  await fireEvent.press(screen.getByText("Lora"));
  expect(updatePreferences).toHaveBeenCalledWith({ reading_font: "lora" });
  // One adjustable control that says its value by name, not in pixels.
  const size = screen.getByRole("adjustable", { name: "Text size" });
  expect(size.props.accessibilityValue).toEqual({ text: "Default" });
  expect(screen.queryByText(/\d+px/)).toBeNull();
  await fireEvent.press(screen.getByTestId("text-size-20"));
  expect(updatePreferences).toHaveBeenCalledWith({ text_size: 20 });
  expect(await screen.findByText("Extra large")).toBeTruthy();
  expect(screen.getByRole("adjustable", { name: "Text size" }).props.accessibilityValue).toEqual({ text: "Extra large" });
  await settled(client);
});

test("the text size can be changed a step at a time with the screen reader's adjust gesture", async () => {
  const { updatePreferences, client } = await open();
  const size = screen.getByRole("adjustable", { name: "Text size" });
  await fireEvent(size, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
  expect(updatePreferences).toHaveBeenLastCalledWith({ text_size: 18 });
  expect(await screen.findByText("Large")).toBeTruthy();
  await settled(client);
  await fireEvent(screen.getByRole("adjustable", { name: "Text size" }), "accessibilityAction", {
    nativeEvent: { actionName: "decrement" },
  });
  expect(updatePreferences).toHaveBeenLastCalledWith({ text_size: 16 });
  await settled(client);
});

function SchemeProbe() {
  return <Text>{`scheme:${useTheme().scheme}`}</Text>;
}

test("picking Dark saves it, switches the app to Espresso and remembers it on the phone", async () => {
  const api = demoApi();
  const updatePreferences = jest.spyOn(api, "updatePreferences");
  const { client } = await renderWithProviders(
    <>
      <ThemeSync />
      <AccountScreen />
      <SchemeProbe />
    </>,
    { api },
  );
  await screen.findByText("Sam Carter");
  expect(screen.getByText("scheme:light")).toBeTruthy();

  await fireEvent.press(screen.getByText("Dark"));
  expect(updatePreferences).toHaveBeenCalledWith({ theme: "dark" });
  expect(await screen.findByText("scheme:dark")).toBeTruthy();
  expect(screen.queryByText(/coming soon\. Lately stays light/)).toBeNull();
  await waitFor(async () => expect(await AsyncStorage.getItem(THEME_KEY)).toBe("dark"));

  await fireEvent.press(screen.getByText("Light"));
  expect(await screen.findByText("scheme:light")).toBeTruthy();
  await settled(client);
});

test("download archive prepares a JSON export in the app, then offers Download", async () => {
  const api = demoApi();
  const requestExport = jest.spyOn(api, "requestExport");
  jest
    .spyOn(api, "downloadExport")
    .mockResolvedValueOnce({ status: "queued" })
    .mockResolvedValue({ status: "ready", filename: "lately-export-20261010.json", json: "{}" });
  await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Sam Carter");
  expect(screen.queryByText(/email your archive/i)).toBeNull();
  expect(screen.queryByText(/markdown/i)).toBeNull();
  expect(screen.getByText("Your saves, notes, cards and stacks as a JSON file (links and text, no videos)")).toBeTruthy();
  await fireEvent.press(screen.getByText("Download your archive"));
  await waitFor(() => expect(requestExport).toHaveBeenCalled());
  expect(screen.getByText("Preparing…")).toBeTruthy();
  await fireEvent.press(await screen.findByText("Download", {}, { timeout: 8000 }));
  await waitFor(() => expect(mockShare).toHaveBeenCalledWith("lately-export-20261010.json", "{}"));
});

test("the delete dialog offers the export first", async () => {
  const api = demoApi();
  const requestExport = jest.spyOn(api, "requestExport");
  const deleteAccount = jest.spyOn(api, "deleteAccount");
  await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Sam Carter");
  await fireEvent.press(screen.getByText("Delete account"));
  await fireEvent.press(screen.getByRole("button", { name: /Download my archive first/ }));
  await waitFor(() => expect(requestExport).toHaveBeenCalled());
  expect(deleteAccount).not.toHaveBeenCalled();
  expect(screen.queryByText("Delete your account?")).toBeNull();
  // The dialog closes and the archive row is usually off screen: a toast says it started.
  expect(screen.getByText("Preparing your archive…")).toBeTruthy();
  expect(screen.getByText("Preparing…")).toBeTruthy();
});

test("no placeholder password row (Lately has no passwords)", async () => {
  await open();
  expect(screen.queryByText("Password & Security")).toBeNull();
  expect(screen.queryByText("Last changed 3 months ago")).toBeNull();
  expect(screen.queryByText("Reset")).toBeNull();
});

test("settings that aren't built yet (weekly digest, offline reading) aren't listed at all", async () => {
  await open();
  expect(screen.queryByText("Coming soon")).toBeNull();
  expect(screen.queryByText("Notifications and offline")).toBeNull();
  expect(screen.queryByText("Weekly digest")).toBeNull();
  expect(screen.queryByText("Offline reading")).toBeNull();
  // The one switch is Vibration, which works (it is kept on the phone).
  expect(screen.getAllByRole("switch").map((s) => s.props.accessibilityLabel)).toEqual(["Vibration"]);
});

test("sign out and back", async () => {
  const { auth } = await open();
  expect(screen.queryByText("Log out")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  expect(auth.signOut).toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
});

async function seedDeviceData() {
  await AsyncStorage.setItem("lately.recent-searches", JSON.stringify(["momo"]));
  await AsyncStorage.setItem(queueKey("demo-user"), JSON.stringify([{ id: "q1", text: "x", queued_at: "t" }]));
  await AsyncStorage.setItem(PENDING_SHARE_KEY, "https://www.instagram.com/reel/abc/");
}

async function expectDeviceDataCleared() {
  expect(JSON.parse((await AsyncStorage.getItem("lately.recent-searches")) ?? "[]")).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem(queueKey("demo-user"))) ?? "[]")).toEqual([]);
  expect((await AsyncStorage.getItem(PENDING_SHARE_KEY)) ?? "").toBe("");
}

test("signing out forgets recent searches, the offline queue and a pending share", async () => {
  await seedDeviceData();
  const { auth } = await open();
  await fireEvent.press(screen.getByText("Sign out"));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  await expectDeviceDataCleared();
});

test("deleting the account forgets device data too", async () => {
  await seedDeviceData();
  const { auth } = await open();
  await fireEvent.press(screen.getByText("Delete account"));
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete forever" }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  await expectDeviceDataCleared();
});

test("back with no history goes to the Library", async () => {
  mockCanGoBack = false;
  await open();
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("deleting the account asks twice, deletes, then signs out", async () => {
  const api = demoApi();
  const deleteAccount = jest.spyOn(api, "deleteAccount");
  const { auth } = await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Sam Carter");
  await fireEvent.press(screen.getByText("Delete account"));
  expect(screen.getByText("Delete your account?")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("This can't be undone")).toBeTruthy();
  expect(deleteAccount).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Delete forever" }));
  await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
});

test("a failed account deletion keeps you signed in and says so", async () => {
  const api = { ...demoApi(), deleteAccount: jest.fn(async () => Promise.reject(new Error("down"))) };
  const { auth } = await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Sam Carter");
  await fireEvent.press(screen.getByText("Delete account"));
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete forever" }));
  expect(await screen.findByText("Couldn't delete your account. Try again.")).toBeTruthy();
  expect(auth.signOut).not.toHaveBeenCalled();
});

test("cancelling the first step deletes nothing", async () => {
  const api = demoApi();
  const deleteAccount = jest.spyOn(api, "deleteAccount");
  await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Sam Carter");
  await fireEvent.press(screen.getByText("Delete account"));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(deleteAccount).not.toHaveBeenCalled();
});

test("privacy policy and terms open from Account", async () => {
  await open();
  await fireEvent.press(screen.getByText("Privacy Policy"));
  expect(mockRouter.push).toHaveBeenCalledWith("/legal/privacy");
  await fireEvent.press(screen.getByText("Terms of Service"));
  expect(mockRouter.push).toHaveBeenCalledWith("/legal/terms");
});

describe("the plan block", () => {
  /** The demo API, with GET /me reporting these plan numbers. */
  function withMe(over: Partial<Me>): LatelyApi {
    const base = demoApi();
    return { ...base, getMe: async () => ({ ...(await base.getMe()), ...over }) };
  }

  test("free: usage so far, when it resets, and an upgrade button", async () => {
    const api = withMe({ plan: "free", saves_this_month: 12, saves_limit: 20, resets_on: "2026-11-01" });
    await renderWithProviders(<AccountScreen />, { api });
    expect(await screen.findByText("Free plan")).toBeTruthy();
    expect(screen.getByText("12 of 20 saves this month")).toBeTruthy();
    expect(screen.getByText("Resets on Nov 1")).toBeTruthy();
    expect(screen.getByRole("progressbar").props.accessibilityValue).toEqual({ min: 0, max: 20, now: 12 });
    expect(screen.queryByText("Manage subscription")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/pro");
  });

  test("free with one save allowed reads in the singular, and the bar never overflows", async () => {
    const api = withMe({ plan: "free", saves_this_month: 3, saves_limit: 1 });
    await renderWithProviders(<AccountScreen />, { api });
    expect(await screen.findByText("3 of 1 save this month")).toBeTruthy();
    expect(screen.getByRole("progressbar").props.accessibilityValue).toEqual({ min: 0, max: 1, now: 1 });
  });

  test("the plan block sits above the settings sections", async () => {
    await open();
    const titles = screen.getAllByText(/Free plan|Reading and appearance|Sign-in and data/).map((n) => n.props.children);
    expect(titles).toEqual(["Free plan", "Reading and appearance", "Sign-in and data"]);
  });

  test("pro: unlimited saves, with rows to manage the subscription and to restore purchases", async () => {
    const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const api = demoApi();
    api.setPlan("pro", "2027-01-01T00:00:00.000Z");
    await renderWithProviders(<AccountScreen />, { api, billing: createDemoBilling(api, { delayMs: 0 }) });
    expect(await screen.findByText("Lately Pro")).toBeTruthy();
    expect(screen.getByText("Unlimited saves")).toBeTruthy();
    expect(screen.queryByText("Upgrade to Pro")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    await fireEvent.press(screen.getByText("Manage subscription"));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(PLAY_SUBSCRIPTIONS_URL));
    openUrl.mockRestore();
  });

  test("pro: Restore purchases re-reads the store, syncs the server and says so", async () => {
    const api = demoApi();
    api.setPlan("pro");
    const syncPlan = jest.spyOn(api, "syncPlan");
    const fake = fakeBilling({ restore: jest.fn(async () => true) });
    await renderWithProviders(<AccountScreen />, { api, billing: fake.client });
    await fireEvent.press(await screen.findByText("Restore purchases"));
    expect(await screen.findByText("Pro restored")).toBeTruthy();
    expect(fake.client.restore).toHaveBeenCalledTimes(1);
    expect(syncPlan).toHaveBeenCalledTimes(1);
  });

  test("free: Restore purchases sits under Upgrade to Pro, for a Pro that the server lost", async () => {
    const api = demoApi();
    const syncPlan = jest.spyOn(api, "syncPlan");
    const fake = fakeBilling({
      restore: jest.fn(async () => {
        api.setPlan("pro");
        return true;
      }),
    });
    await renderWithProviders(<AccountScreen />, { api, billing: fake.client });
    expect(await screen.findByText("Free plan")).toBeTruthy();
    await fireEvent.press(screen.getByText("Restore purchases"));
    expect(await screen.findByText("Pro restored")).toBeTruthy();
    expect(fake.client.restore).toHaveBeenCalledTimes(1);
    expect(syncPlan).toHaveBeenCalledTimes(1);
  });

  test("a restore the server hasn't heard about doesn't claim Pro is on", async () => {
    const api = demoApi();
    const fake = fakeBilling({ restore: jest.fn(async () => true) });
    await renderWithProviders(<AccountScreen />, { api, billing: fake.client });
    await fireEvent.press(await screen.findByText("Restore purchases"));
    expect(await screen.findByText(PRO_CONFIRMING)).toBeTruthy();
    expect(screen.queryByText("Pro restored")).toBeNull();
  });

  test("a build with no store has nothing to restore, free or Pro", async () => {
    const free = await renderWithProviders(<AccountScreen />, { billing: createUnavailableBilling() });
    expect(await screen.findByText("Free plan")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upgrade to Pro" })).toBeTruthy();
    expect(screen.queryByText("Restore purchases")).toBeNull();
    await free.unmount();

    const api = demoApi();
    api.setPlan("pro");
    await renderWithProviders(<AccountScreen />, { api, billing: createUnavailableBilling() });
    expect(await screen.findByText("Lately Pro")).toBeTruthy();
    expect(screen.queryByText("Restore purchases")).toBeNull();
  });

  test("pro: Restore purchases with nothing to restore, or a store error, says so", async () => {
    const api = demoApi();
    api.setPlan("pro");
    const restore = jest.fn<Promise<boolean>, []>().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline"));
    await renderWithProviders(<AccountScreen />, { api, billing: fakeBilling({ restore }).client });
    await fireEvent.press(await screen.findByText("Restore purchases"));
    expect(await screen.findByText("We couldn't find a Pro subscription to restore.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Restore purchases"));
    expect(await screen.findByText("Couldn't restore purchases. Try again.")).toBeTruthy();
  });

  test("lifetime: unlimited saves and nothing to manage", async () => {
    const api = demoApi();
    api.setPlan("lifetime");
    await renderWithProviders(<AccountScreen />, { api });
    expect(await screen.findByText("Lifetime")).toBeTruthy();
    expect(screen.getByText("Unlimited saves")).toBeTruthy();
    expect(screen.queryByText("Manage subscription")).toBeNull();
    expect(screen.queryByText("Restore purchases")).toBeNull();
    expect(screen.queryByText("Upgrade to Pro")).toBeNull();
  });
});

describe("deleting an account that has a subscription", () => {
  const NOTE = "Deleting your account doesn't cancel your Google Play subscription. Cancel it in Google Play first.";

  test("a Pro member is told to cancel in Google Play first, at both steps", async () => {
    const api = demoApi();
    api.setPlan("pro");
    await renderWithProviders(<AccountScreen />, { api });
    await screen.findByText("Lately Pro");
    await fireEvent.press(screen.getByText("Delete account"));
    expect(screen.getByText(new RegExp(NOTE))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(new RegExp(NOTE))).toBeTruthy();
  });

  const IF_NOTE = "If you subscribed to Lately Pro, deleting your account doesn't cancel it. Cancel it in Google Play first.";

  test("the store says Pro but the server hasn't caught up: the plain note, at both steps", async () => {
    const api = demoApi();
    await renderWithProviders(<AccountScreen />, { api, billing: fakeBilling({ isProActive: jest.fn(async () => true) }).client });
    await screen.findByText("Free plan");
    await fireEvent.press(screen.getByText("Delete account"));
    // The store's answer may land a moment after the screen: the dialog follows it.
    expect(await screen.findByText(new RegExp(NOTE))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(new RegExp(NOTE))).toBeTruthy();
  });

  test("a free account on a build with a store gets the \"if you subscribed\" note, since a subscription on hold reads as free", async () => {
    await renderWithProviders(<AccountScreen />, { billing: fakeBilling().client });
    await screen.findByText("Free plan");
    await fireEvent.press(screen.getByText("Delete account"));
    expect(screen.getByText(new RegExp(IF_NOTE))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(new RegExp(IF_NOTE))).toBeTruthy();
  });

  test("no note where nothing can have been bought: lifetime, or a build with no store", async () => {
    const lifetime = demoApi();
    lifetime.setPlan("lifetime");
    const first = await renderWithProviders(<AccountScreen />, { api: lifetime, billing: fakeBilling().client });
    await screen.findByText("Lifetime");
    await fireEvent.press(screen.getByText("Delete account"));
    expect(screen.queryByText(/Google Play/)).toBeNull();
    await first.unmount();

    await renderWithProviders(<AccountScreen />, { billing: createUnavailableBilling() });
    await screen.findByText("Free plan");
    await fireEvent.press(screen.getByText("Delete account"));
    expect(screen.queryByText(/Google Play/)).toBeNull();
  });

  test("a free or lifetime account sees no such note", async () => {
    for (const plan of ["free", "lifetime"] as const) {
      const api = demoApi();
      api.setPlan(plan);
      const view = await renderWithProviders(<AccountScreen />, { api });
      await screen.findByText(plan === "free" ? "Free plan" : "Lifetime");
      await fireEvent.press(screen.getByText("Delete account"));
      expect(screen.getByText("Delete your account?")).toBeTruthy();
      expect(screen.queryByText(/Google Play subscription/)).toBeNull();
      await view.unmount();
    }
  });
});

describe("reading and appearance settings", () => {
  test("a change the server doesn't take is undone and said, theme included", async () => {
    const api = demoApi();
    jest.spyOn(api, "updatePreferences").mockRejectedValueOnce(new ApiError("NETWORK", 0));
    const { client } = await renderWithProviders(
      <>
        <ThemeSync />
        <AccountScreen />
        <SchemeProbe />
      </>,
      { api },
    );
    await screen.findByText("Sam Carter");
    await fireEvent.press(screen.getByText("Dark"));
    expect(await screen.findByText("Couldn't save that change. Try again.")).toBeTruthy();
    await settled(client);
    expect(client.getQueryData<Preferences>(["prefs"])?.theme).toBe("light");
    expect(await screen.findByText("scheme:light")).toBeTruthy();
    await waitFor(async () => expect(await AsyncStorage.getItem(THEME_KEY)).toBe("light"));
  });

  test("quick taps end on the last choice, sent in order, with no step back on screen", async () => {
    const api = demoApi();
    const real = api.updatePreferences.bind(api);
    const replies: (() => void)[] = [];
    const updatePreferences = jest
      .spyOn(api, "updatePreferences")
      .mockImplementation((p) => new Promise((resolve) => replies.push(() => resolve(real(p)))));
    const { client } = await renderWithProviders(
      <>
        <ThemeSync />
        <AccountScreen />
        <SchemeProbe />
      </>,
      { api },
    );
    await screen.findByText("Sam Carter");
    const theme = () => client.getQueryData<Preferences>(["prefs"])?.theme;
    await fireEvent.press(screen.getByText("Dark"));
    await fireEvent.press(screen.getByText("Light"));
    expect(theme()).toBe("light");
    // One at a time: the second waits for the first.
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    await act(async () => replies[0]());
    // The first reply (dark) lands while Light is still on its way: it stays light.
    expect(theme()).toBe("light");
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
    expect(updatePreferences.mock.calls.map((c) => c[0])).toEqual([{ theme: "dark" }, { theme: "light" }]);
    await act(async () => replies[1]());
    await settled(client);
    expect(theme()).toBe("light");
    expect(await screen.findByText("scheme:light")).toBeTruthy();
    expect((await api.getPreferences()).theme).toBe("light");
  });

  test("settings that didn't load: nothing shown as chosen, a retry, and the phone's theme left alone", async () => {
    await AsyncStorage.setItem(THEME_KEY, "dark");
    await loadThemePreference();
    const base = demoApi();
    const getPreferences = jest
      .fn<Promise<Preferences>, []>()
      .mockRejectedValueOnce(new ApiError("NETWORK", 0))
      .mockImplementation(() => base.getPreferences());
    const updatePreferences = jest.spyOn(base, "updatePreferences");
    await renderWithProviders(
      <>
        <ThemeSync />
        <AccountScreen />
        <SchemeProbe />
      </>,
      { api: { ...base, getPreferences } },
    );
    expect(await screen.findByText(/Couldn't load your reading and theme settings/)).toBeTruthy();
    // No font or theme cards to tap, so no default can be saved over the account's own.
    expect(screen.queryByText("Newsreader")).toBeNull();
    expect(screen.queryByText("Daylight")).toBeNull();
    expect(screen.getByText("scheme:dark")).toBeTruthy();
    expect(await AsyncStorage.getItem(THEME_KEY)).toBe("dark");
    expect(updatePreferences).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Reading font")).toBeTruthy();
    // Now the account's saved theme (light, in the demo) is the phone's.
    expect(await screen.findByText("scheme:light")).toBeTruthy();
  });

  test("while they load there is a placeholder, not the defaults", async () => {
    const base = demoApi();
    await renderWithProviders(<AccountScreen />, { api: { ...base, getPreferences: () => new Promise<Preferences>(() => {}) } });
    await screen.findByText("Sam Carter");
    expect(screen.getByLabelText("Loading your settings")).toBeTruthy();
    expect(screen.queryByText("Reading font")).toBeNull();
  });
});

describe("deleting and signing out", () => {
  test("an account that is already gone (an earlier reply was lost) counts as deleted", async () => {
    await seedDeviceData();
    const api = { ...demoApi(), deleteAccount: jest.fn(async () => Promise.reject(new ApiError("NOT_FOUND", 404))) };
    const { auth } = await renderWithProviders(<AccountScreen />, { api });
    await screen.findByText("Sam Carter");
    await fireEvent.press(screen.getByText("Delete account"));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await fireEvent.press(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    await expectDeviceDataCleared();
    expect(mockDeleteExports).toHaveBeenCalled();
    expect(screen.queryByText("Couldn't delete your account. Try again.")).toBeNull();
  });

  test("signing out deletes archive files left on the phone", async () => {
    const { auth } = await open();
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    expect(mockDeleteExports).toHaveBeenCalledTimes(1);
  });

  /** Links saved offline that can't be sent yet (the connection is still down). */
  function withUnsent(n: number) {
    const items = Array.from({ length: n }, (_, i) => ({ id: `q${i}`, text: `https://www.instagram.com/reel/abc${i}/`, queued_at: "t" }));
    return {
      api: { ...demoApi(), createSave: jest.fn(() => Promise.reject(new ApiError("NETWORK", 0))) },
      queueStore: createMemoryStore({ [queueKey("demo-user")]: JSON.stringify(items) }),
    };
  }

  test("links waiting to be sent: sign out asks first and says how many; Cancel keeps you signed in", async () => {
    const { auth } = await renderWithProviders(<AccountScreen />, withUnsent(2));
    await screen.findByText("Sam Carter");
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Sign out?")).toBeTruthy();
    expect(screen.getByText("2 links haven't been sent yet. Signing out deletes them.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(auth.signOut).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    const dialogButtons = screen.getAllByRole("button", { name: "Sign out" });
    await fireEvent.press(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  test("one waiting link reads in the singular", async () => {
    await renderWithProviders(<AccountScreen />, withUnsent(1));
    await screen.findByText("Sam Carter");
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("1 link hasn't been sent yet. Signing out deletes it.")).toBeTruthy();
  });

  test("signing out shows that it is busy until it is done", async () => {
    let finish = () => {};
    const { auth } = await renderWithProviders(<AccountScreen />, {
      auth: { signOut: jest.fn(() => new Promise<void>((resolve) => (finish = resolve))) },
    });
    await screen.findByText("Sam Carter");
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Sign out" }).props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Sign out" }).props.accessibilityState).toMatchObject({ busy: false });
  });
});

describe("rows that only show where they can work", () => {
  function withMe(over: Partial<Me>): LatelyApi {
    const base = demoApi();
    return { ...base, getMe: async () => ({ ...(await base.getMe()), ...over }) };
  }

  test("a test build explains that Pro is bought in the Play Store version, instead of Upgrade and Restore", async () => {
    mockUpdateSource.mockReturnValue({ repo: "Mitovoid-AI/lately", installedBuild: 9 });
    const view = await renderWithProviders(<AccountScreen />, { billing: fakeBilling().client });
    expect(await screen.findByText("Free plan")).toBeTruthy();
    expect(screen.getByText("This is a test build. Lately Pro is bought in the Play Store version.")).toBeTruthy();
    expect(screen.queryByText("Upgrade to Pro")).toBeNull();
    expect(screen.queryByText("Restore purchases")).toBeNull();
    await view.unmount();

    const api = demoApi();
    api.setPlan("pro");
    await renderWithProviders(<AccountScreen />, { api, billing: fakeBilling().client });
    expect(await screen.findByText("Lately Pro")).toBeTruthy();
    expect(screen.queryByText("Manage subscription")).toBeNull();
    expect(screen.queryByText("Restore purchases")).toBeNull();
    expect(screen.getByText("This is a test build. Lately Pro is bought in the Play Store version.")).toBeTruthy();
  });

  test("Pro on a build with no store: no Manage subscription row", async () => {
    const api = demoApi();
    api.setPlan("pro");
    await renderWithProviders(<AccountScreen />, { api, billing: createUnavailableBilling() });
    expect(await screen.findByText("Lately Pro")).toBeTruthy();
    expect(screen.queryByText("Manage subscription")).toBeNull();
  });

  test("Pro shows when it renews or ends", async () => {
    await renderWithProviders(<AccountScreen />, { api: withMe({ plan: "pro", plan_expires_at: "2026-12-12T12:00:00.000Z" }) });
    expect(await screen.findByText("Renews or ends on Dec 12, 2026")).toBeTruthy();
  });

  test("Sign-in methods: a placeholder while the profile loads, a word if it failed", async () => {
    const base = demoApi();
    const pending = await renderWithProviders(<AccountScreen />, { api: { ...base, getMe: () => new Promise<Me>(() => {}) } });
    expect(screen.getByText("Sign-in methods")).toBeTruthy();
    expect(screen.getByLabelText("Loading your sign-in methods")).toBeTruthy();
    await pending.unmount();

    await renderWithProviders(<AccountScreen />, { api: { ...base, getMe: () => Promise.reject(new Error("down")) } });
    expect(await screen.findByText("Couldn't load these")).toBeTruthy();
    expect(screen.getByText("Couldn't load your plan")).toBeTruthy();
  });

  test("an Instagram entry from an older server is not listed as a way to sign in", async () => {
    const api = withMe({
      connected_accounts: [
        { provider: "google", label: "sam.carter@example.com", status: "secured" },
        { provider: "instagram", label: "samcarter", status: "active" },
      ],
    });
    await renderWithProviders(<AccountScreen />, { api });
    expect(await screen.findByText("Google (sam.carter@example.com)")).toBeTruthy();
    expect(screen.queryByText(/Instagram \(/)).toBeNull();
  });
});

describe("saving from Instagram messages", () => {
  test("offered by the server: a row under Connected accounts opens the Instagram screen", async () => {
    await open();
    expect(await screen.findByText("Connected accounts")).toBeTruthy();
    expect(screen.getByText("Send reels to @lately.app on Instagram to save them")).toBeTruthy();
    await fireEvent.press(screen.getByText("Save from Instagram DMs"));
    expect(mockRouter.push).toHaveBeenCalledWith("/instagram");
  });

  test("linked: the row says so", async () => {
    const base = demoApi();
    const linked: InstagramLink = {
      enabled: true,
      handle: "lately.app",
      linked: true,
      linked_at: "2026-11-01T00:00:00Z",
      code: null,
      code_expires_at: null,
    };
    await renderWithProviders(<AccountScreen />, { api: { ...base, getInstagramLink: async () => linked } });
    expect(await screen.findByText("Connected. Send reels to @lately.app")).toBeTruthy();
  });

  test("not offered, or not answered: no row at all", async () => {
    const base = demoApi();
    const off: InstagramLink = { enabled: false, handle: null, linked: false, linked_at: null, code: null, code_expires_at: null };
    const first = await renderWithProviders(<AccountScreen />, { api: { ...base, getInstagramLink: async () => off } });
    await screen.findByText("Free plan");
    expect(screen.queryByText("Save from Instagram DMs")).toBeNull();
    expect(screen.queryByText("Connected accounts")).toBeNull();
    await first.unmount();

    await renderWithProviders(<AccountScreen />, {
      api: { ...base, getInstagramLink: () => Promise.reject(new ApiError("SERVER", 500)) },
    });
    await screen.findByText("Free plan");
    expect(screen.queryByText("Save from Instagram DMs")).toBeNull();
  });
});

describe("saving behaviour (kept on the phone)", () => {
  test("after sharing: ask for a note, or save and go back", async () => {
    await open();
    expect(screen.getByText("After sharing a reel")).toBeTruthy();
    await fireEvent.press(screen.getByText("Save and go back"));
    expect(devicePrefsSnapshot().afterShare).toBe("return");
    await waitFor(async () =>
      expect(JSON.parse((await AsyncStorage.getItem(DEVICE_PREFS_KEY)) ?? "{}").afterShare).toBe("return"),
    );
    await fireEvent.press(screen.getByText("Ask for a note"));
    expect(devicePrefsSnapshot().afterShare).toBe("ask");
  });

  test("vibration can be turned off and on", async () => {
    await open();
    const vibration = screen.getByRole("switch", { name: "Vibration" });
    expect(vibration.props.value).toBe(true);
    await fireEvent(vibration, "valueChange", false);
    expect(devicePrefsSnapshot().haptics).toBe(false);
    expect(screen.getByRole("switch", { name: "Vibration" }).props.value).toBe(false);
    await fireEvent(screen.getByRole("switch", { name: "Vibration" }), "valueChange", true);
    expect(devicePrefsSnapshot().haptics).toBe(true);
  });
});

describe("help, licences and about", () => {
  test("How to save from Instagram opens the Help screen", async () => {
    await open();
    await fireEvent.press(screen.getByText("How to save from Instagram"));
    expect(mockRouter.push).toHaveBeenCalledWith("/help");
  });

  test("Report a problem opens the project's issue page when there is no support address", async () => {
    const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await open();
    await fireEvent.press(screen.getByText("Report a problem"));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(ISSUES_URL));
    openUrl.mockRestore();
  });

  test("Open-source licenses sits under Legal", async () => {
    await open();
    await fireEvent.press(screen.getByText("Open-source licenses"));
    expect(mockRouter.push).toHaveBeenCalledWith("/licenses");
  });

  test("the footer names the version", async () => {
    await open();
    expect(screen.getByText(/^Lately \d+\.\d+\.\d+/)).toBeTruthy();
    expect(screen.queryByText(/^Lately v/)).toBeNull();
  });

  test("the Play build (and the web) has no Check for updates row", async () => {
    await open();
    expect(screen.queryByText("Check for updates")).toBeNull();
  });

  test("a test build checks for updates on demand: newest, failed, or the update dialog", async () => {
    mockUpdateSource.mockReturnValue({ repo: "Mitovoid-AI/lately", installedBuild: 9 });
    const offers: number[] = [];
    const off = onUpdateOffer((o) => offers.push(o.release.build));
    await open();
    expect(screen.getByText("You're on test build 9")).toBeTruthy();

    mockCheck.mockResolvedValueOnce({ status: "current" });
    await fireEvent.press(screen.getByText("Check for updates"));
    expect(await screen.findByText("You're on the newest build")).toBeTruthy();
    expect(mockCheck).toHaveBeenCalledWith("Mitovoid-AI/lately", 9);

    mockCheck.mockResolvedValueOnce({ status: "failed" });
    await fireEvent.press(screen.getByText("Check for updates"));
    expect(await screen.findByText("Couldn't check for updates. Try again.")).toBeTruthy();

    const release = { build: 12, tag: "apk-12", url: "https://example.test/lately.apk", bytes: 1, publishedAt: "" };
    mockCheck.mockResolvedValueOnce({ status: "newer", release });
    await fireEvent.press(screen.getByText("Check for updates"));
    await waitFor(() => expect(offers).toEqual([12]));
    off();
  });
});
