// Lately Pro billing: what the paywall and the rest of the app know about buying a plan.
// The store (RevenueCat on Google Play) hides behind BillingClient; demo mode and builds
// without a store use stand-ins, so every screen runs the same code in all three.

/** The RevenueCat entitlement that means "Pro" (the backend reads the same id). */
export const ENTITLEMENT_ID = "pro";

export type PlanId = "monthly" | "yearly";

export interface PlanOffer {
  id: PlanId;
  /** Localized, as the store shows it: "$29.99". */
  price: string;
  /** The same price as a number, for arithmetic only. */
  amount: number;
  /** ISO 4217 code: "USD". */
  currency: string;
  period: "month" | "year";
  /** The yearly price per month in the store's format ("$2.50"); null for the monthly plan. */
  perMonth: string | null;
  /** Free-trial length when this person gets one (new subscribers on yearly), else null. */
  trialDays: number | null;
}

/** "cancelled": the person closed the store sheet. "pending": paid later (cash, a slow card), Pro turns on once the store confirms. */
export type PurchaseResult = "purchased" | "cancelled" | "pending";

export interface BillingClient {
  /** store = RevenueCat on Google Play; demo = demo mode; unavailable = a build or place without a store. */
  readonly kind: "store" | "demo" | "unavailable";
  /** Ties the store account to the signed-in Lately user (the Supabase user id). */
  identify(userId: string): Promise<void>;
  /** Forgets that user on sign-out. */
  reset(): Promise<void>;
  /** The plans on offer, yearly first. */
  getPlans(): Promise<PlanOffer[]>;
  purchase(id: PlanId): Promise<PurchaseResult>;
  /** Re-reads purchases from the store; true when Pro is active afterwards. */
  restore(): Promise<boolean>;
  isProActive(): Promise<boolean>;
  /** Where this person manages the subscription, when the store says. */
  managementUrl(): Promise<string | null>;
  /** Calls back with whether Pro is active whenever the store's view changes; returns the unsubscribe. */
  onChange(cb: (proActive: boolean) => void): () => void;
}

/** BillingError.code of a purchase the store took but whose Pro entitlement isn't on yet: not a failure, and no reason to buy again. */
export const ENTITLEMENT_PENDING = "ENTITLEMENT_PENDING";

/** A billing step that failed, with a short sentence a person can read (never a raw SDK message). */
export class BillingError extends Error {
  constructor(
    message: string,
    /** The store's error code, for logs and tests. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

/** Where to manage a Google Play subscription when the store gives no link of its own. */
export const PLAY_SUBSCRIPTIONS_URL = "https://play.google.com/store/account/subscriptions?package=app.lately.android";

export const UNAVAILABLE_MESSAGE = "Purchases aren't available in this build.";
