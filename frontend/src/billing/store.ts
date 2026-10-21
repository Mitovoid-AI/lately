// The real store: RevenueCat on top of Google Play Billing. Native only (store.web.ts is the
// web stand-in), and only built when the app has its public Android key and the native module
// (chooseClient in BillingProvider.tsx).
import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesOffering,
  type PurchasesPackage,
} from "react-native-purchases";

import { formatMoney } from "./plans";
import {
  BillingError,
  ENTITLEMENT_ID,
  ENTITLEMENT_PENDING,
  type BillingClient,
  type PlanId,
  type PlanOffer,
  type PurchaseResult,
} from "./types";

/** The slice of the RevenueCat SDK used here; tests hand in a fake. */
export type PurchasesSdk = Pick<
  typeof Purchases,
  | "configure"
  | "isConfigured"
  | "logIn"
  | "logOut"
  | "getOfferings"
  | "purchasePackage"
  | "restorePurchases"
  | "getCustomerInfo"
  | "addCustomerInfoUpdateListener"
  | "removeCustomerInfoUpdateListener"
  | "setLogLevel"
>;

/** ISO 8601 durations RevenueCat uses to name a plan's length. */
const ISO_PERIOD = { monthly: "P1M", yearly: "P1Y" } as const;

const DAYS_PER_UNIT: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

const CONNECTION_FAILURE = "Couldn't reach Google Play. Check your connection and try again.";

/** Short sentences for the store failures a person can act on; everything else gets the generic one. */
const FAILURE_TEXT: Partial<Record<PURCHASES_ERROR_CODE, string>> = {
  [PURCHASES_ERROR_CODE.NETWORK_ERROR]: CONNECTION_FAILURE,
  [PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR]: CONNECTION_FAILURE,
  [PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR]: "You already have this subscription. Tap Restore to turn Pro on.",
  [PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR]: "Purchases are turned off on this device.",
  [PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR]: "That Google Play purchase belongs to another Lately account.",
  [PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR]: "That Google Play purchase belongs to another Lately account.",
  [PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR]: "Google Play had a problem. Try again in a moment.",
  [PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR]: "This plan isn't available right now. Try again later.",
};
const GENERIC_FAILURE = "Something went wrong. Try again.";

function isPurchasesError(e: unknown): e is PurchasesError {
  return typeof e === "object" && e !== null && "code" in e;
}

/** An SDK failure as a BillingError with a short, readable message. */
function failure(e: unknown): BillingError {
  if (e instanceof BillingError) return e;
  const code = isPurchasesError(e) ? e.code : undefined;
  return new BillingError((code !== undefined && FAILURE_TEXT[code]) || GENERIC_FAILURE, code);
}

const proActiveIn = (info: CustomerInfo) => ENTITLEMENT_ID in info.entitlements.active;

/** Trial length in days from a package's default offer: only set while the person is eligible for it. */
function trialDaysOf(pkg: PurchasesPackage): number | null {
  const period = pkg.product.defaultOption?.freePhase?.billingPeriod;
  if (!period || period.value <= 0) return null;
  const perUnit = DAYS_PER_UNIT[period.unit] ?? 0;
  return perUnit ? period.value * perUnit : null;
}

export function toOffer(id: PlanId, pkg: PurchasesPackage): PlanOffer {
  const p = pkg.product;
  const yearly = id === "yearly";
  return {
    id,
    price: p.priceString,
    amount: p.price,
    currency: p.currencyCode,
    period: yearly ? "year" : "month",
    perMonth: yearly
      ? (p.pricePerMonthString ?? (p.pricePerMonth !== null ? formatMoney(p.pricePerMonth, p.currencyCode) : null))
      : null,
    trialDays: trialDaysOf(pkg),
  };
}

/** The monthly and annual packages of the current offering (falling back to any 1-month / 1-year plan). */
function packagesOf(offering: PurchasesOffering) {
  const byPeriod = (iso: string) => offering.availablePackages.find((p) => p.product.subscriptionPeriod === iso) ?? null;
  return {
    yearly: offering.annual ?? byPeriod(ISO_PERIOD.yearly),
    monthly: offering.monthly ?? byPeriod(ISO_PERIOD.monthly),
  };
}

export function createStoreBilling(o: { apiKey: string; sdk?: PurchasesSdk }): BillingClient {
  const sdk = o.sdk ?? Purchases;
  let configured = false;
  // Who the store is signed in as; set only once the SDK has accepted the user.
  let identified: string | null = null;
  // Who the app wants it signed in as (null: signed out). The two differ while a sign-in is
  // still running or after one failed.
  let wanted: string | null = null;
  // identify and reset run one after another, so a quick sign-out/sign-in can't interleave them.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = run.catch(() => {});
    return run;
  };

  /** Points the SDK at this user (configuring it first if needed). Runs inside serial. */
  async function connect(userId: string) {
    if (!configured) {
      // Verbose in development only: store logs carry the account id.
      void sdk.setLogLevel(__DEV__ ? LOG_LEVEL.VERBOSE : LOG_LEVEL.WARN).catch(() => {});
      if (await sdk.isConfigured()) {
        // Already set up in this process (fast refresh): just point it at this user.
        await sdk.logIn(userId);
      } else {
        sdk.configure({ apiKey: o.apiKey, appUserID: userId });
      }
      configured = true;
    } else if (identified !== userId) {
      // Forget the old user first: if this logIn fails, a purchase must not go out under them.
      identified = null;
      await sdk.logIn(userId);
    }
    identified = userId;
  }

  /** Resolves once every identify/reset queued so far has run, including one queued while waiting. */
  async function settled() {
    let seen: Promise<unknown>;
    do {
      seen = chain;
      await seen;
    } while (seen !== chain);
  }

  /**
   * Waits for the pending sign-in, and tries again when the store isn't signed in as the user
   * the app wants (an earlier identify failed). Store calls need this: configure comes first,
   * and the purchase must go to the right account.
   */
  async function ready() {
    await settled();
    if (wanted === null || identified === wanted) return;
    try {
      await serial(async () => {
        if (wanted !== null) await connect(wanted);
      });
    } catch {
      throw new BillingError(CONNECTION_FAILURE);
    }
  }

  /** `ready`, and then the store must be signed in as the app's user: nobody else gets the purchase. */
  async function requireUser(signedOutText: string) {
    await ready();
    if (wanted === null) throw new BillingError(signedOutText);
    if (identified !== wanted) throw new BillingError(CONNECTION_FAILURE);
  }

  async function packageFor(id: PlanId): Promise<PurchasesPackage> {
    const current = (await sdk.getOfferings()).current;
    const pkg = current ? packagesOf(current)[id] : null;
    if (!pkg) throw new BillingError("This plan isn't available right now. Try again later.");
    return pkg;
  }

  return {
    kind: "store",

    identify(userId) {
      wanted = userId;
      return serial(() => connect(userId));
    },

    reset() {
      wanted = null;
      return serial(async () => {
        if (!configured || identified === null) return;
        identified = null;
        // Already anonymous is fine: the point is that the next sign-in starts clean.
        await sdk.logOut().catch(() => {});
      });
    },

    async getPlans() {
      try {
        await ready();
        const current = (await sdk.getOfferings()).current;
        if (!current) throw new BillingError("Plans aren't available right now. Try again in a moment.");
        const { yearly, monthly } = packagesOf(current);
        const plans = [yearly && toOffer("yearly", yearly), monthly && toOffer("monthly", monthly)].filter(
          (p): p is PlanOffer => !!p,
        );
        if (plans.length === 0) throw new BillingError("Plans aren't available right now. Try again in a moment.");
        return plans;
      } catch (e) {
        throw failure(e);
      }
    },

    async purchase(id): Promise<PurchaseResult> {
      await requireUser("Sign in to Lately to subscribe.");
      try {
        const { customerInfo } = await sdk.purchasePackage(await packageFor(id));
        if (!proActiveIn(customerInfo)) {
          throw new BillingError("Your purchase went through, but Pro isn't on yet. Tap Restore in a minute.", ENTITLEMENT_PENDING);
        }
        return "purchased";
      } catch (e) {
        if (isPurchasesError(e)) {
          if (e.userCancelled || e.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return "cancelled";
          if (e.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return "pending";
        }
        throw failure(e);
      }
    },

    async restore() {
      await requireUser("Sign in to Lately to restore purchases.");
      try {
        return proActiveIn(await sdk.restorePurchases());
      } catch (e) {
        throw failure(e);
      }
    },

    async isProActive() {
      if (!configured) return false;
      try {
        return proActiveIn(await sdk.getCustomerInfo());
      } catch {
        return false;
      }
    },

    async managementUrl() {
      if (!configured) return null;
      try {
        return (await sdk.getCustomerInfo()).managementURL;
      } catch {
        return null;
      }
    },

    onChange(cb) {
      const listener = (info: CustomerInfo) => cb(proActiveIn(info));
      sdk.addCustomerInfoUpdateListener(listener);
      return () => {
        sdk.removeCustomerInfoUpdateListener(listener);
      };
    },
  };
}
