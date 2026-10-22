import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, Linking } from "react-native";

import { ApiError } from "../../api/contract";
import type { DemoApi } from "../../api/demo";
import { createDemoBilling } from "../../billing/demo";
import { FALLBACK_PLANS, PRO_CONFIRMING } from "../../billing/plans";
import {
  BillingError,
  ENTITLEMENT_PENDING,
  PLAY_SUBSCRIPTIONS_URL,
  type PlanId,
  type PlanOffer,
  type PurchaseResult,
} from "../../billing/types";
import { createUnavailableBilling } from "../../billing/unavailable";
import { fakeBilling } from "../../test/fakeBilling";
import { demoApi, renderWithProviders } from "../../test/render";
import { PaywallScreen } from "../PaywallScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));

const YEARLY_DISCLOSURE =
  "Free for 7 days, then $29.99 a year. Renews automatically until you cancel. Cancel anytime in Google Play > Subscriptions.";
const MONTHLY_DISCLOSURE = "$3.99 a month. Renews automatically until you cancel. Cancel anytime in Google Play > Subscriptions.";

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockParams = {};
});

/** The paywall in demo mode, with a demo store that doesn't make you wait for the pretend sheet. */
async function openDemo() {
  const api = demoApi();
  const billing = createDemoBilling(api, { delayMs: 0 });
  const view = await renderWithProviders(<PaywallScreen />, { api, billing });
  await screen.findByRole("radio", { name: /Yearly/ });
  return { ...view, api, billing };
}

async function openWith(fake: ReturnType<typeof fakeBilling>, api = demoApi()) {
  const view = await renderWithProviders(<PaywallScreen />, { api, billing: fake.client });
  return { ...view, api };
}

/** A store whose purchase and restore leave the server on Pro, as the backend's sync does in production. */
function storeThatTurnsProOn(api: DemoApi, overrides: Parameters<typeof fakeBilling>[0] = {}) {
  return fakeBilling({
    purchase: jest.fn(async (_id: PlanId): Promise<PurchaseResult> => {
      api.setPlan("pro");
      return "purchased";
    }),
    restore: jest.fn(async () => {
      api.setPlan("pro");
      return true;
    }),
    ...overrides,
  });
}

describe("the picker", () => {
  test("shows the pitch and both plans, yearly first and preselected", async () => {
    await openDemo();
    expect(screen.getByText("Save without limits")).toBeTruthy();
    expect(screen.getByText("Free covers 20 saves a month. Pro removes the cap.")).toBeTruthy();
    // One pitch line; the filler benefit rows are gone (cancelling is in the disclosure under the plans).
    expect(screen.queryByText("Unlimited saves, every month")).toBeNull();
    expect(screen.queryByText("Cancel anytime in Google Play")).toBeNull();
    expect(screen.queryByText("Search, cards and stacks stay the same")).toBeNull();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /Yearly/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Monthly/ })).not.toBeChecked();
    expect(screen.getByText("$29.99/year · $2.50/month")).toBeTruthy();
    expect(screen.getByText("7 days free")).toBeTruthy();
    expect(screen.getByText("Save 37%")).toBeTruthy();
    expect(screen.getByText("$3.99/month")).toBeTruthy();
    // The one line above the button; the full disclosure is in the scroll under the plans.
    expect(screen.getByText("7 days free, then $29.99 a year")).toBeTruthy();
    expect(screen.getByText(YEARLY_DISCLOSURE)).toBeTruthy();
  });

  test("the pitch uses the server's real free limit", async () => {
    const api = demoApi();
    jest.spyOn(api, "getMe").mockResolvedValue({ ...(await api.getMe()), saves_limit: 25 });
    await renderWithProviders(<PaywallScreen />, { api, billing: createDemoBilling(api, { delayMs: 0 }) });
    expect(await screen.findByText("Free covers 25 saves a month. Pro removes the cap.")).toBeTruthy();
  });

  test("the button and the disclosure follow the selected plan", async () => {
    await openDemo();
    expect(screen.getByRole("button", { name: "Try 7 days free" })).toBeTruthy();
    expect(screen.getByText(YEARLY_DISCLOSURE)).toBeTruthy();
    expect(screen.getByText("7 days free, then $29.99 a year")).toBeTruthy();

    await fireEvent.press(screen.getByRole("radio", { name: /Monthly/ }));
    expect(screen.getByRole("radio", { name: /Monthly/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Yearly/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Subscribe for $3.99/month" })).toBeTruthy();
    expect(screen.getByText(MONTHLY_DISCLOSURE)).toBeTruthy();
    expect(screen.getByText("Billed $3.99 a month")).toBeTruthy();
    expect(screen.queryByText(YEARLY_DISCLOSURE)).toBeNull();
    expect(screen.queryByText("7 days free, then $29.99 a year")).toBeNull();

    await fireEvent.press(screen.getByRole("radio", { name: /Yearly/ }));
    expect(screen.getByRole("button", { name: "Try 7 days free" })).toBeTruthy();
    expect(screen.getByText(YEARLY_DISCLOSURE)).toBeTruthy();
    expect(screen.getByText("7 days free, then $29.99 a year")).toBeTruthy();
  });

  test("a yearly plan without a trial (not eligible) reads as a plain subscription", async () => {
    const plans: PlanOffer[] = [{ ...FALLBACK_PLANS[0], trialDays: null }, FALLBACK_PLANS[1]];
    await openWith(fakeBilling({ getPlans: jest.fn(async () => plans) }));
    await screen.findByRole("radio", { name: /Yearly/ });
    expect(screen.getByRole("button", { name: "Subscribe for $29.99/year" })).toBeTruthy();
    expect(screen.queryByText("7 days free")).toBeNull();
    expect(
      screen.getByText("$29.99 a year. Renews automatically until you cancel. Cancel anytime in Google Play > Subscriptions."),
    ).toBeTruthy();
    expect(screen.getByText("Billed $29.99 a year")).toBeTruthy();
  });

  test("no savings pill when the two prices are in different currencies", async () => {
    const plans: PlanOffer[] = [{ ...FALLBACK_PLANS[0], currency: "EUR" }, FALLBACK_PLANS[1]];
    await openWith(fakeBilling({ getPlans: jest.fn(async () => plans) }));
    await screen.findByRole("radio", { name: /Yearly/ });
    expect(screen.queryByText(/^Save \d+%$/)).toBeNull();
  });

  test("only one plan on offer is still selectable and purchasable", async () => {
    const fake = fakeBilling({ getPlans: jest.fn(async () => [FALLBACK_PLANS[1]]) });
    await openWith(fake);
    expect(await screen.findByRole("radio", { name: /Monthly/ })).toBeChecked();
    await fireEvent.press(screen.getByRole("button", { name: "Subscribe for $3.99/month" }));
    await waitFor(() => expect(fake.client.purchase).toHaveBeenCalledWith("monthly"));
  });

  test("while the plans load there are placeholders and a disabled button, not a spinner wall", async () => {
    await openWith(fakeBilling({ getPlans: jest.fn(() => new Promise<PlanOffer[]>(() => {})) }));
    expect(screen.getByText("Save without limits")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  test("plans that fail to load say so and can be retried", async () => {
    const getPlans = jest
      .fn<Promise<PlanOffer[]>, []>()
      .mockRejectedValueOnce(new BillingError("Plans aren't available right now. Try again in a moment."))
      .mockResolvedValue(FALLBACK_PLANS);
    await openWith(fakeBilling({ getPlans }));
    expect(await screen.findByText("Couldn't load the plans")).toBeTruthy();
    expect(screen.getByText("Plans aren't available right now. Try again in a moment.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("radio", { name: /Yearly/ })).toBeChecked();
  });

  test("Terms and Privacy open the legal screens", async () => {
    await openDemo();
    await fireEvent.press(screen.getByRole("link", { name: "Terms" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/legal/terms");
    await fireEvent.press(screen.getByRole("link", { name: "Privacy" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/legal/privacy");
  });

  test("close goes back, or to the Library when there is nothing to go back to", async () => {
    await openDemo();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(mockRouter.back).toHaveBeenCalled();
    mockCanGoBack = false;
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });
});

describe("buying", () => {
  test("a purchase turns Pro on, syncs the server and confirms", async () => {
    const { api } = await openDemo();
    const syncPlan = jest.spyOn(api, "syncPlan");
    await fireEvent.press(screen.getByRole("button", { name: "Try 7 days free" }));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    expect(screen.getByText("Unlimited saves are on.")).toBeTruthy();
    expect(syncPlan).toHaveBeenCalledTimes(1);
    expect((await api.getMe()).plan).toBe("pro");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test("it buys the plan that is selected", async () => {
    const fake = fakeBilling();
    await openWith(fake);
    await fireEvent.press(await screen.findByRole("radio", { name: /Monthly/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Subscribe for $3.99/month" }));
    await waitFor(() => expect(fake.client.purchase).toHaveBeenCalledWith("monthly"));
  });

  test("while the store sheet is open the button shows progress and a second tap does nothing", async () => {
    let finish: (r: "purchased") => void = () => {};
    const api = demoApi();
    const fake = fakeBilling({ purchase: jest.fn(() => new Promise((resolve) => (finish = resolve))) });
    await openWith(fake, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    // Busy: the label gives way to a spinner and the button stops taking presses.
    const busy = await screen.findByRole("button", { busy: true });
    expect(busy).toBeDisabled();
    await fireEvent.press(busy);
    expect(fake.client.purchase).toHaveBeenCalledTimes(1);
    api.setPlan("pro");
    finish("purchased");
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
  });

  test("the store reporting Pro a beat before the purchase finishes stays on the picker, then confirms without Manage subscription", async () => {
    let finish: (r: "purchased") => void = () => {};
    const api = demoApi();
    const fake = fakeBilling({ purchase: jest.fn(() => new Promise((resolve) => (finish = resolve))) });
    await openWith(fake, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    await waitFor(() => expect(fake.listeners.size).toBe(1));
    await act(async () => fake.emit(true));
    // The purchase is still running and the server hasn't said Pro: neither "on" nor "turning on" yet.
    expect(screen.queryByText("You're on Pro")).toBeNull();
    expect(screen.queryByText("Turning Pro on")).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
    api.setPlan("pro");
    await act(async () => finish("purchased"));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
  });

  test("closing the store sheet leaves you on the picker", async () => {
    const fake = fakeBilling({ purchase: jest.fn(async () => "cancelled" as const) });
    const { api } = await openWith(fake);
    const syncPlan = jest.spyOn(api, "syncPlan");
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    await waitFor(() => expect(fake.client.purchase).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Try 7 days free" })).toBeEnabled());
    expect(screen.queryByText("You're on Pro")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(syncPlan).not.toHaveBeenCalled();
  });

  test("a payment that settles later says so and doesn't claim Pro", async () => {
    const fake = fakeBilling({ purchase: jest.fn(async () => "pending" as const) });
    await openWith(fake);
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    expect(await screen.findByText("Your payment is pending. Pro turns on when Google Play confirms it.")).toBeTruthy();
    expect(screen.queryByText("You're on Pro")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try 7 days free" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test("a failed purchase shows why, inline, and can be retried", async () => {
    const api = demoApi();
    const purchase = jest
      .fn<Promise<"purchased">, [string]>()
      .mockRejectedValueOnce(new BillingError("Couldn't reach Google Play. Check your connection and try again."))
      .mockImplementation(async () => {
        api.setPlan("pro");
        return "purchased";
      });
    await openWith(fakeBilling({ purchase }), api);
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    expect(await screen.findByText("Couldn't reach Google Play. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    expect(purchase).toHaveBeenCalledTimes(2);
  });

  test("an unexpected error reads as a generic sentence, never its own text", async () => {
    await openWith(fakeBilling({ purchase: jest.fn(async () => Promise.reject(new Error("BillingResponse 6"))) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(screen.queryByText(/BillingResponse/)).toBeNull();
  });

  test("a purchase the server hasn't heard about says Pro is turning on, and Check again asks the server again", async () => {
    const api = demoApi();
    // The first sync fails (502); the server stays on free until the test flips it, like a late webhook.
    jest.spyOn(api, "syncPlan").mockRejectedValueOnce(new ApiError("BILLING_UNAVAILABLE", 502));
    await openWith(fakeBilling(), api);
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    expect(await screen.findByText("Turning Pro on")).toBeTruthy();
    expect(screen.getByText(PRO_CONFIRMING)).toBeTruthy();
    expect(screen.queryByText("You're on Pro")).toBeNull();
    expect(screen.queryByText("Unlimited saves are on.")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);

    // Still free on the server: say so, stay put.
    await fireEvent.press(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Not on yet. Try again in a minute.")).toBeTruthy();
    expect(screen.queryByText("You're on Pro")).toBeNull();

    // The server catches up.
    api.setPlan("pro");
    await fireEvent.press(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    expect(screen.getByText("Unlimited saves are on.")).toBeTruthy();
    expect(screen.queryByText("Not on yet. Try again in a minute.")).toBeNull();
  });

  test("while Pro is turning on, Done just closes", async () => {
    await openWith(fakeBilling());
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    await screen.findByText("Turning Pro on");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test("a payment Google Play took while Pro isn't on yet is a note, and Try again restores instead of buying again", async () => {
    const api = demoApi();
    const syncPlan = jest.spyOn(api, "syncPlan");
    const buzz = jest.spyOn(Haptics, "notificationAsync");
    const purchase = jest.fn(async (_id: PlanId): Promise<PurchaseResult> => {
      throw new BillingError("Your purchase went through, but Pro isn't on yet. Tap Restore in a minute.", ENTITLEMENT_PENDING);
    });
    const fake = storeThatTurnsProOn(api, { purchase });
    await openWith(fake, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    expect(await screen.findByText("Your purchase went through, but Pro isn't on yet. Tap Restore in a minute.")).toBeTruthy();
    await waitFor(() => expect(syncPlan).toHaveBeenCalledTimes(1));
    // Not a failure: no error buzz.
    expect(buzz).not.toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    expect(fake.client.restore).toHaveBeenCalledTimes(1);
    expect(purchase).toHaveBeenCalledTimes(1);
    buzz.mockRestore();
  });

  test("a failed purchase does buzz as an error", async () => {
    const buzz = jest.spyOn(Haptics, "notificationAsync");
    await openWith(fakeBilling({ purchase: jest.fn(async () => Promise.reject(new Error("boom"))) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    await screen.findByText("Something went wrong. Try again.");
    expect(buzz).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
    buzz.mockRestore();
  });
});

describe("what a screen reader hears", () => {
  test("a restore that finds nothing, a failed purchase and a payment that is pending are announced", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const purchase = jest
      .fn<Promise<PurchaseResult>, [string]>()
      .mockRejectedValueOnce(new BillingError("Couldn't reach Google Play. Check your connection and try again."))
      .mockResolvedValue("pending");
    await openWith(fakeBilling({ purchase }));
    await fireEvent.press(await screen.findByRole("button", { name: "Restore" }));
    await screen.findByText("We couldn't find a Pro subscription to restore.");
    expect(announce).toHaveBeenLastCalledWith("We couldn't find a Pro subscription to restore.");
    await fireEvent.press(screen.getByRole("button", { name: "Try 7 days free" }));
    await screen.findByText("Couldn't reach Google Play. Check your connection and try again.");
    expect(announce).toHaveBeenLastCalledWith("Couldn't reach Google Play. Check your connection and try again.");
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Your payment is pending. Pro turns on when Google Play confirms it.");
    expect(announce).toHaveBeenLastCalledWith("Your payment is pending. Pro turns on when Google Play confirms it.");
    announce.mockRestore();
  });

  test("a Manage subscription that can't open is announced", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const open = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));
    const api = demoApi();
    api.setPlan("pro");
    await renderWithProviders(<PaywallScreen />, { api, billing: createDemoBilling(api, { delayMs: 0 }) });
    await fireEvent.press(await screen.findByRole("button", { name: "Manage subscription" }));
    await screen.findByText("Couldn't open Google Play. Open it and go to Subscriptions.");
    expect(announce).toHaveBeenCalledWith("Couldn't open Google Play. Open it and go to Subscriptions.");
    open.mockRestore();
    announce.mockRestore();
  });

  test("Still waiting on the server after Check again is announced", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await openWith(fakeBilling({ isProActive: jest.fn(async () => true) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Check again" }));
    await screen.findByText("Not on yet. Try again in a minute.");
    expect(announce).toHaveBeenCalledWith("Not on yet. Try again in a minute.");
    announce.mockRestore();
  });
});

describe("a reel that was waiting on Pro", () => {
  const reel = "https://www.instagram.com/reel/QUOTA/";

  test("once Pro is on, the reel can be saved straight from the confirmation", async () => {
    mockParams = { text: reel };
    const api = demoApi();
    await openWith(storeThatTurnsProOn(api), api);
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save that reel" }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/save-sheet", params: { text: reel } });
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test("Done still just closes, and without a reel there is no save button", async () => {
    mockParams = { text: reel };
    const api = demoApi();
    await openWith(storeThatTurnsProOn(api), api);
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    await screen.findByText("You're on Pro");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test("a paywall opened without a reel has no save button", async () => {
    const api = demoApi();
    api.setPlan("pro");
    await renderWithProviders(<PaywallScreen />, { api, billing: createDemoBilling(api, { delayMs: 0 }) });
    await screen.findByText("You're on Pro");
    expect(screen.queryByRole("button", { name: "Save that reel" })).toBeNull();
  });

  test("while Pro is still turning on there is no save button (it would hit the limit again)", async () => {
    mockParams = { text: reel };
    await openWith(fakeBilling());
    await fireEvent.press(await screen.findByRole("button", { name: "Try 7 days free" }));
    await screen.findByText("Turning Pro on");
    expect(screen.queryByRole("button", { name: "Save that reel" })).toBeNull();
  });
});

describe("restore", () => {
  test("restoring a subscription confirms Pro", async () => {
    const api = demoApi();
    const fake = storeThatTurnsProOn(api);
    await openWith(fake, api);
    const syncPlan = jest.spyOn(api, "syncPlan");
    await fireEvent.press(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    expect(syncPlan).toHaveBeenCalledTimes(1);
  });

  test("a restore the server hasn't heard about says Pro is turning on, not that it is on", async () => {
    await openWith(fakeBilling({ restore: jest.fn(async () => true) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Turning Pro on")).toBeTruthy();
    expect(screen.queryByText("You're on Pro")).toBeNull();
  });

  test("nothing to restore says so and stays on the picker", async () => {
    await openWith(fakeBilling({ restore: jest.fn(async () => false) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByText("We couldn't find a Pro subscription to restore.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Yearly/ })).toBeChecked();
  });

  test("a failed restore says why and can be retried", async () => {
    const api = demoApi();
    const restore = jest
      .fn<Promise<boolean>, []>()
      .mockRejectedValueOnce(new BillingError("Couldn't reach Google Play. Check your connection and try again."))
      .mockImplementation(async () => {
        api.setPlan("pro");
        return true;
      });
    await openWith(fakeBilling({ restore }), api);
    await fireEvent.press(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Couldn't reach Google Play. Check your connection and try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
  });
});

describe("a build without a store", () => {
  test("the prices show, the button is off and says why, and there is nothing to restore", async () => {
    const billing = createUnavailableBilling();
    const purchase = jest.spyOn(billing, "purchase");
    await renderWithProviders(<PaywallScreen />, { billing });
    expect(await screen.findByRole("radio", { name: /Yearly/ })).toBeChecked();
    expect(screen.getByText("$29.99/year · $2.50/month")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try 7 days free" })).toBeDisabled();
    expect(screen.getByText("Purchases aren't available in this build.")).toBeTruthy();
    // Nothing to charge for, so no summary line and no renewal terms.
    expect(screen.queryByText("7 days free, then $29.99 a year")).toBeNull();
    expect(screen.queryByText(YEARLY_DISCLOSURE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Try 7 days free" }));
    expect(purchase).not.toHaveBeenCalled();
    expect(screen.queryByText("You're on Pro")).toBeNull();
  });
});

describe("already on Pro", () => {
  test("a subscriber sees the confirmation with a way to manage it, not the picker", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const api = demoApi();
    api.setPlan("pro", "2027-01-01T00:00:00.000Z");
    await renderWithProviders(<PaywallScreen />, { api, billing: createDemoBilling(api, { delayMs: 0 }) });
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    expect(screen.getByText("Unlimited saves are on.")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Manage subscription" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(PLAY_SUBSCRIPTIONS_URL));
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(mockRouter.back).toHaveBeenCalled();
    open.mockRestore();
  });

  test("Manage subscription opens the store's own link when it has one", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const api = demoApi();
    api.setPlan("pro");
    const fake = fakeBilling({ managementUrl: jest.fn(async () => "https://play.google.com/store/account/subscriptions?sku=lately_pro") });
    await renderWithProviders(<PaywallScreen />, { api, billing: fake.client });
    await fireEvent.press(await screen.findByRole("button", { name: "Manage subscription" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://play.google.com/store/account/subscriptions?sku=lately_pro"));
    open.mockRestore();
  });

  test("a phone that can't open the link says so", async () => {
    const open = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));
    const api = demoApi();
    api.setPlan("pro");
    await renderWithProviders(<PaywallScreen />, { api, billing: createDemoBilling(api, { delayMs: 0 }) });
    await fireEvent.press(await screen.findByRole("button", { name: "Manage subscription" }));
    expect(await screen.findByText("Couldn't open Google Play. Open it and go to Subscriptions.")).toBeTruthy();
    expect(screen.getByText("You're on Pro")).toBeTruthy();
    open.mockRestore();
  });

  test("a lifetime member has nothing to manage", async () => {
    const api = demoApi();
    api.setPlan("lifetime");
    await renderWithProviders(<PaywallScreen />, { api, billing: createDemoBilling(api, { delayMs: 0 }) });
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
    expect(screen.getByText("Lifetime plan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
  });

  test("the store says Pro while the server still says free: Pro is turning on, and the server is told once", async () => {
    const api = demoApi();
    const syncPlan = jest.spyOn(api, "syncPlan");
    await openWith(fakeBilling({ isProActive: jest.fn(async () => true) }), api);
    expect(await screen.findByText("Turning Pro on")).toBeTruthy();
    expect(screen.queryByText("You're on Pro")).toBeNull();
    await waitFor(() => expect(syncPlan).toHaveBeenCalledTimes(1));
  });

  test("the server agreeing after that tells the person Pro is on", async () => {
    const api = demoApi();
    await openWith(fakeBilling({ isProActive: jest.fn(async () => true) }), api);
    await screen.findByText("Turning Pro on");
    api.setPlan("pro");
    await fireEvent.press(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("You're on Pro")).toBeTruthy();
  });
});
