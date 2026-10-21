import type { PurchasesPackage } from "react-native-purchases";

import { createStoreBilling, toOffer, type PurchasesSdk } from "../store";
import { BillingError, ENTITLEMENT_PENDING } from "../types";

const CONNECTION = "Couldn't reach Google Play. Check your connection and try again.";

// The manual mock in frontend/__mocks__ supplies these constants (LOG_LEVEL, error codes).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LOG_LEVEL, PURCHASES_ERROR_CODE } = require("react-native-purchases") as typeof import("react-native-purchases");

const PRO = { entitlements: { active: { pro: { identifier: "pro" } }, all: {} }, managementURL: "https://play.google.com/manage/xyz" };
const FREE = { entitlements: { active: {}, all: {} }, managementURL: null };

type FreePhase = { unit: string; value: number } | null;

function pkg(o: {
  id: string;
  price: number;
  priceString: string;
  period: string;
  perMonth?: string | null;
  perMonthNumber?: number | null;
  free?: FreePhase;
}): PurchasesPackage {
  return {
    identifier: o.id,
    product: {
      identifier: `lately_pro:${o.period}`,
      price: o.price,
      priceString: o.priceString,
      currencyCode: "USD",
      subscriptionPeriod: o.period,
      pricePerMonth: o.perMonthNumber ?? null,
      pricePerMonthString: o.perMonth ?? null,
      defaultOption: o.free ? { freePhase: { billingPeriod: o.free } } : { freePhase: null },
    },
  } as unknown as PurchasesPackage;
}

const ANNUAL = pkg({ id: "$rc_annual", price: 29.99, priceString: "$29.99", period: "P1Y", perMonth: "$2.50", free: { unit: "DAY", value: 7 } });
const MONTHLY = pkg({ id: "$rc_monthly", price: 3.99, priceString: "$3.99", period: "P1M" });

function setup(
  over: Record<string, unknown> = {},
  offering: Record<string, unknown> | null = { annual: ANNUAL, monthly: MONTHLY, availablePackages: [ANNUAL, MONTHLY] },
) {
  const sdk = {
    configure: jest.fn(),
    isConfigured: jest.fn(async () => false),
    logIn: jest.fn(async () => ({ customerInfo: FREE, created: false })),
    logOut: jest.fn(async () => FREE),
    getOfferings: jest.fn(async () => ({ all: {}, current: offering })),
    purchasePackage: jest.fn(async () => ({ customerInfo: PRO })),
    restorePurchases: jest.fn(async () => PRO),
    getCustomerInfo: jest.fn(async () => PRO),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(() => true),
    setLogLevel: jest.fn(async () => {}),
    ...over,
  };
  return { sdk, client: createStoreBilling({ apiKey: "goog_test", sdk: sdk as unknown as PurchasesSdk }) };
}

async function rejection(p: Promise<unknown>): Promise<BillingError> {
  try {
    await p;
  } catch (e) {
    return e as BillingError;
  }
  throw new Error("expected a rejection");
}

test("react-native-purchases is mocked under Jest (frontend/__mocks__), so no test reaches the native SDK", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = (require("react-native-purchases") as typeof import("react-native-purchases")).default;
  expect(jest.isMockFunction(sdk.configure)).toBe(true);
  expect(jest.isMockFunction(sdk.purchasePackage)).toBe(true);
});

describe("identify and reset", () => {
  test("the SDK is configured once, on the first identify, with the user's id as the app user id", async () => {
    const { sdk, client } = setup();
    await client.identify("user-1");
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: "goog_test", appUserID: "user-1" });
    expect(sdk.logIn).not.toHaveBeenCalled();
    await client.identify("user-1");
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.logIn).not.toHaveBeenCalled();
  });

  test("logs are verbose in development builds only", async () => {
    const { sdk, client } = setup();
    await client.identify("user-1");
    expect(sdk.setLogLevel).toHaveBeenCalledWith(__DEV__ ? LOG_LEVEL.VERBOSE : LOG_LEVEL.WARN);
  });

  test("a different user is logged in on the configured SDK", async () => {
    const { sdk, client } = setup();
    await client.identify("user-1");
    await client.identify("user-2");
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.logIn).toHaveBeenCalledWith("user-2");
  });

  test("an SDK that is already configured (fast refresh) is pointed at the user instead of configured again", async () => {
    const { sdk, client } = setup({ isConfigured: jest.fn(async () => true) });
    await client.identify("user-1");
    expect(sdk.configure).not.toHaveBeenCalled();
    expect(sdk.logIn).toHaveBeenCalledWith("user-1");
  });

  test("reset logs out only when configured and identified", async () => {
    const { sdk, client } = setup();
    await client.reset();
    expect(sdk.logOut).not.toHaveBeenCalled();
    await client.identify("user-1");
    await client.reset();
    expect(sdk.logOut).toHaveBeenCalledTimes(1);
    await client.reset();
    expect(sdk.logOut).toHaveBeenCalledTimes(1);
    // The next sign-in logs in on the configured SDK.
    await client.identify("user-2");
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.logIn).toHaveBeenCalledWith("user-2");
  });

  test("a logOut the SDK refuses (already anonymous) is not an error", async () => {
    const { client } = setup({ logOut: jest.fn(async () => Promise.reject({ code: PURCHASES_ERROR_CODE.UNKNOWN_ERROR })) });
    await client.identify("user-1");
    await expect(client.reset()).resolves.toBeUndefined();
  });

  test("a quick sign-out and sign-in run in order", async () => {
    const calls: string[] = [];
    const { client } = setup({
      configure: jest.fn(() => calls.push("configure")),
      logOut: jest.fn(async () => calls.push("logOut")),
      logIn: jest.fn(async () => calls.push("logIn")),
    });
    await Promise.all([client.identify("a"), client.reset(), client.identify("b")]);
    expect(calls).toEqual(["configure", "logOut", "logIn"]);
  });
});

describe("a sign-in that fails", () => {
  const offline = () => Promise.reject({ code: PURCHASES_ERROR_CODE.NETWORK_ERROR });

  test("switching users: a failed logIn leaves nobody identified, and a purchase never goes out under the old user", async () => {
    const logIn = jest.fn<Promise<unknown>, [string]>().mockImplementation(offline);
    const { sdk, client } = setup({ logIn });
    await client.identify("user-a");
    await expect(client.identify("user-b")).rejects.toBeDefined();
    const e = await rejection(client.purchase("yearly"));
    // It tried to sign in as user-b again (still offline), and bought nothing for user-a.
    expect([e.message, logIn.mock.calls.map((c) => c[0])]).toEqual([CONNECTION, ["user-b", "user-b"]]);
    expect(sdk.purchasePackage).not.toHaveBeenCalled();
    expect((await rejection(client.restore())).message).toBe(CONNECTION);
    expect(sdk.restorePurchases).not.toHaveBeenCalled();
  });

  test("a purchase or restore signs in again first, and then goes to the right user", async () => {
    const logIn = jest.fn<Promise<unknown>, [string]>().mockImplementationOnce(offline).mockResolvedValue({ customerInfo: FREE, created: false });
    const { sdk, client } = setup({ logIn });
    await client.identify("user-a");
    await expect(client.identify("user-b")).rejects.toBeDefined();
    expect(await client.purchase("yearly")).toBe("purchased");
    expect(logIn).toHaveBeenCalledTimes(2);
    expect(sdk.purchasePackage).toHaveBeenCalledTimes(1);
    expect(await client.restore()).toBe(true);
    expect(logIn).toHaveBeenCalledTimes(2);
  });

  test("a first identify that fails doesn't leave billing broken for the session", async () => {
    const isConfigured = jest.fn<Promise<boolean>, []>().mockRejectedValueOnce(new Error("bridge hiccup")).mockResolvedValue(false);
    const { sdk, client } = setup({ isConfigured });
    await expect(client.identify("user-1")).rejects.toBeDefined();
    expect(sdk.configure).not.toHaveBeenCalled();
    expect(await client.purchase("monthly")).toBe("purchased");
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: "goog_test", appUserID: "user-1" });
  });

  test("after a sign-out the message is about signing in, not about the connection", async () => {
    const { client } = setup();
    await client.identify("user-1");
    await client.reset();
    expect((await rejection(client.purchase("yearly"))).message).toBe("Sign in to Lately to subscribe.");
    expect((await rejection(client.restore())).message).toBe("Sign in to Lately to restore purchases.");
  });

  test("the plans wait for the sign-in that is starting, so the SDK is configured before it is asked", async () => {
    const calls: string[] = [];
    const { client } = setup({
      configure: jest.fn(() => calls.push("configure")),
      getOfferings: jest.fn(async () => {
        calls.push("getOfferings");
        return { all: {}, current: { annual: ANNUAL, monthly: MONTHLY, availablePackages: [ANNUAL, MONTHLY] } };
      }),
    });
    // The paywall asks for the plans in the same tick the provider starts the sign-in (effects run child first).
    const plans = client.getPlans();
    const signedIn = client.identify("user-1");
    expect((await plans).map((p) => p.id)).toEqual(["yearly", "monthly"]);
    await signedIn;
    expect(calls).toEqual(["configure", "getOfferings"]);
  });

  test("plans that can't be fetched because the sign-in keeps failing say so", async () => {
    const { client } = setup({ isConfigured: jest.fn(async () => Promise.reject(new Error("down"))) });
    void client.identify("user-1").catch(() => {});
    expect((await rejection(client.getPlans())).message).toBe(CONNECTION);
  });
});

describe("plans", () => {
  test("the current offering's annual and monthly packages become the two plans, yearly first", async () => {
    const { client } = setup();
    expect(await client.getPlans()).toEqual([
      { id: "yearly", price: "$29.99", amount: 29.99, currency: "USD", period: "year", perMonth: "$2.50", trialDays: 7 },
      { id: "monthly", price: "$3.99", amount: 3.99, currency: "USD", period: "month", perMonth: null, trialDays: null },
    ]);
  });

  test("any 1-month and 1-year package stands in when the offering has no monthly or annual slot", async () => {
    const yearlyOnly = pkg({ id: "custom_y", price: 24, priceString: "$24.00", period: "P1Y", perMonth: "$2.00" });
    const monthlyOnly = pkg({ id: "custom_m", price: 4, priceString: "$4.00", period: "P1M" });
    const { client } = setup({}, { annual: null, monthly: null, availablePackages: [monthlyOnly, yearlyOnly] });
    expect((await client.getPlans()).map((p) => [p.id, p.price])).toEqual([
      ["yearly", "$24.00"],
      ["monthly", "$4.00"],
    ]);
  });

  test("a plan that is missing is left out, and no plans at all is an error", async () => {
    const only = setup({}, { annual: null, monthly: MONTHLY, availablePackages: [MONTHLY] });
    expect((await only.client.getPlans()).map((p) => p.id)).toEqual(["monthly"]);
    const none = setup({}, { annual: null, monthly: null, availablePackages: [] });
    await expect(none.client.getPlans()).rejects.toBeInstanceOf(BillingError);
    const noOffering = setup({}, null);
    await expect(noOffering.client.getPlans()).rejects.toBeInstanceOf(BillingError);
  });

  test("the trial shows only when the store offers it to this person (a free phase on the default offer)", () => {
    const withTrial = (free: FreePhase) => pkg({ id: "a", price: 29.99, priceString: "$29.99", period: "P1Y", free });
    expect(toOffer("yearly", withTrial({ unit: "WEEK", value: 1 })).trialDays).toBe(7);
    expect(toOffer("yearly", withTrial(null)).trialDays).toBeNull();
    expect(toOffer("yearly", withTrial({ unit: "MONTH", value: 1 })).trialDays).toBe(30);
    expect(toOffer("yearly", withTrial({ unit: "UNKNOWN", value: 3 })).trialDays).toBeNull();
  });

  test("the per-month price falls back to the number the store gave", () => {
    const p = pkg({ id: "a", price: 29.99, priceString: "$29.99", period: "P1Y", perMonth: null, perMonthNumber: 2.4992 });
    expect(toOffer("yearly", p).perMonth).toBe("$2.50");
    const none = pkg({ id: "a", price: 29.99, priceString: "$29.99", period: "P1Y" });
    expect(toOffer("yearly", none).perMonth).toBeNull();
  });
});

describe("purchase", () => {
  test("buys the chosen plan's package and reports it once Pro is active", async () => {
    const { sdk, client } = setup();
    await client.identify("user-1");
    expect(await client.purchase("yearly")).toBe("purchased");
    expect(sdk.purchasePackage).toHaveBeenCalledWith(ANNUAL);
    await client.purchase("monthly");
    expect(sdk.purchasePackage).toHaveBeenLastCalledWith(MONTHLY);
  });

  test("it needs a signed-in user first", async () => {
    const { sdk, client } = setup();
    const e = await rejection(client.purchase("yearly"));
    expect(e).toBeInstanceOf(BillingError);
    expect(sdk.purchasePackage).not.toHaveBeenCalled();
  });

  test("closing the store sheet is 'cancelled', not an error", async () => {
    const closed = [
      { userCancelled: true, code: PURCHASES_ERROR_CODE.UNKNOWN_ERROR },
      { userCancelled: false, code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR },
    ];
    for (const err of closed) {
      const { client } = setup({ purchasePackage: jest.fn(async () => Promise.reject(err)) });
      await client.identify("user-1");
      expect(await client.purchase("yearly")).toBe("cancelled");
    }
  });

  test("a payment that settles later is 'pending'", async () => {
    const { client } = setup({ purchasePackage: jest.fn(async () => Promise.reject({ code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR })) });
    await client.identify("user-1");
    expect(await client.purchase("yearly")).toBe("pending");
  });

  test("other failures become a BillingError with a short sentence, never the SDK's own text", async () => {
    const cases: [string, string][] = [
      [PURCHASES_ERROR_CODE.NETWORK_ERROR, "Couldn't reach Google Play. Check your connection and try again."],
      [PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR, "You already have this subscription. Tap Restore to turn Pro on."],
      [PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR, "That Google Play purchase belongs to another Lately account."],
      [PURCHASES_ERROR_CODE.UNKNOWN_ERROR, "Something went wrong. Try again."],
    ];
    for (const [code, text] of cases) {
      const failing = jest.fn(async () => Promise.reject({ code, message: "raw sdk text: BillingResponse 6" }));
      const { client } = setup({ purchasePackage: failing });
      await client.identify("user-1");
      const e = await rejection(client.purchase("yearly"));
      expect(e).toBeInstanceOf(BillingError);
      expect([e.message, e.code]).toEqual([text, code]);
    }
    const { client } = setup({ purchasePackage: jest.fn(async () => Promise.reject(new Error("boom"))) });
    await client.identify("user-1");
    expect((await rejection(client.purchase("yearly"))).message).toBe("Something went wrong. Try again.");
  });

  test("a purchase that leaves Pro off (product not on the entitlement) is not reported as bought", async () => {
    const { client } = setup({ purchasePackage: jest.fn(async () => ({ customerInfo: FREE })) });
    await client.identify("user-1");
    const e = await rejection(client.purchase("yearly"));
    expect(e.message).toMatch(/Pro isn't on yet/);
    // A code of its own, so the paywall can tell "paid, not on yet" from a failure.
    expect(e.code).toBe(ENTITLEMENT_PENDING);
  });

  test("a plan the offering doesn't have can't be bought", async () => {
    const { client } = setup({}, { annual: null, monthly: MONTHLY, availablePackages: [MONTHLY] });
    await client.identify("user-1");
    expect(await rejection(client.purchase("yearly"))).toBeInstanceOf(BillingError);
  });
});

describe("restore, status and changes", () => {
  test("restore says whether Pro is active afterwards", async () => {
    const found = setup();
    await found.client.identify("user-1");
    expect(await found.client.restore()).toBe(true);
    const none = setup({ restorePurchases: jest.fn(async () => FREE) });
    await none.client.identify("user-1");
    expect(await none.client.restore()).toBe(false);
    const failing = setup({ restorePurchases: jest.fn(async () => Promise.reject({ code: PURCHASES_ERROR_CODE.NETWORK_ERROR })) });
    await failing.client.identify("user-1");
    expect((await rejection(failing.client.restore())).message).toMatch(/Couldn't reach Google Play/);
    expect(await rejection(setup().client.restore())).toBeInstanceOf(BillingError);
  });

  test("status and the management link come from the customer info, and are empty before sign-in or on failure", async () => {
    const { sdk, client } = setup();
    expect(await client.isProActive()).toBe(false);
    expect(await client.managementUrl()).toBeNull();
    expect(sdk.getCustomerInfo).not.toHaveBeenCalled();
    await client.identify("user-1");
    expect(await client.isProActive()).toBe(true);
    expect(await client.managementUrl()).toBe("https://play.google.com/manage/xyz");
    sdk.getCustomerInfo.mockRejectedValue(new Error("offline"));
    expect(await client.isProActive()).toBe(false);
    expect(await client.managementUrl()).toBeNull();
  });

  test("onChange maps customer info updates to 'is Pro active' and unsubscribes the same listener", () => {
    const { sdk, client } = setup();
    const seen: boolean[] = [];
    const off = client.onChange((active) => seen.push(active));
    const listener = sdk.addCustomerInfoUpdateListener.mock.calls[0][0] as unknown as (info: unknown) => void;
    listener(PRO);
    listener(FREE);
    expect(seen).toEqual([true, false]);
    off();
    expect(sdk.removeCustomerInfoUpdateListener).toHaveBeenCalledWith(listener);
  });

  test("the client reports itself as the store", () => {
    expect(setup().client.kind).toBe("store");
  });
});
