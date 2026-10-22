import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking, Text } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { LatelyApi, Me } from "../../api/contract";
import { createDemoBilling } from "../../billing/demo";
import { PRO_CONFIRMING } from "../../billing/plans";
import { PLAY_SUBSCRIPTIONS_URL } from "../../billing/types";
import { createUnavailableBilling } from "../../billing/unavailable";
import { queueKey } from "../../lib/saveQueue";
import { fakeBilling } from "../../test/fakeBilling";
import { PENDING_SHARE_KEY } from "../../share/ShareRouter";
import { THEME_KEY } from "../../theme/preference";
import { useTheme } from "../../theme/ThemeProvider";
import { ThemeSync } from "../../theme/ThemeSync";
import { demoApi, renderWithProviders } from "../../test/render";
import { AccountScreen } from "../AccountScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
const mockShare = jest.fn(async (_name: string, _json: string) => {});
jest.mock("../../lib/exportFile", () => ({ shareExportFile: (n: string, j: string) => mockShare(n, j) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
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
  await open();
  expect(screen.getByText("@samcarter · sam.carter@example.com")).toBeTruthy();
  expect(screen.getByText("13 saved reels")).toBeTruthy();
  expect(screen.getByText("6 stacks")).toBeTruthy();
  expect(screen.getByText("Member since Oct 2023")).toBeTruthy();
  expect(screen.getByText("Google (sam.carter@example.com)")).toBeTruthy();
  // Lately never connects an Instagram account, so the profile never says it did.
  expect(screen.queryByText(/Connected to/)).toBeNull();
  expect(screen.queryByText(/Instagram \(/)).toBeNull();
});

test("reading font and text size are saved", async () => {
  const { updatePreferences, client } = await open();
  await fireEvent.press(screen.getByText("Lora"));
  expect(updatePreferences).toHaveBeenCalledWith({ reading_font: "lora" });
  expect(screen.getByText("Default (16px)")).toBeTruthy();
  await fireEvent.press(screen.getByText("20px"));
  expect(updatePreferences).toHaveBeenCalledWith({ text_size: 20 });
  expect(await screen.findByText("Extra large (20px)")).toBeTruthy();
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
  expect(screen.getByText("Export your reels, notes and stacks as a JSON file")).toBeTruthy();
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
});

test("no placeholder password row (Lately has no passwords)", async () => {
  await open();
  expect(screen.queryByText("Password & Security")).toBeNull();
  expect(screen.queryByText("Last changed 3 months ago")).toBeNull();
  expect(screen.queryByText("Reset")).toBeNull();
});

test("digests and offline reading are marked coming soon and can't be toggled", async () => {
  const { updatePreferences } = await open();
  expect(screen.getAllByText("Coming soon")).toHaveLength(2);
  await fireEvent.press(screen.getByText("Weekly digest"));
  await fireEvent.press(screen.getByText("Offline reading"));
  expect(updatePreferences).not.toHaveBeenCalled();
  const digests = screen.getByRole("switch", { name: "Weekly digest" });
  expect(digests.props.accessibilityState).toEqual({ checked: false, disabled: true });
  expect(screen.getByRole("switch", { name: "Offline reading" })).toBeTruthy();
});

test("log out and back", async () => {
  const { auth } = await open();
  await fireEvent.press(screen.getByText("Log out"));
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

test("logging out forgets recent searches, the offline queue and a pending share", async () => {
  await seedDeviceData();
  const { auth } = await open();
  await fireEvent.press(screen.getByText("Log out"));
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
