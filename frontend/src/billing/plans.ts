// The plans as people read them: stand-in prices, the savings pill, and the button and
// disclosure copy. Pure functions over PlanOffer, so the paywall and its tests share them.
import { countOf } from "../lib/counts";
import type { PlanOffer } from "./types";

/**
 * The launch prices (US) with the 7-day yearly trial. Demo mode and builds without a store
 * show these: they can't ask Google Play, and nothing here ever charges anyone.
 */
export const FALLBACK_PLANS: PlanOffer[] = [
  { id: "yearly", price: "$29.99", amount: 29.99, currency: "USD", period: "year", perMonth: "$2.50", trialDays: 7 },
  { id: "monthly", price: "$3.99", amount: 3.99, currency: "USD", period: "month", perMonth: null, trialDays: null },
];

/** "Save 37%": what a year costs against twelve months, rounded down; null when it can't be worked out honestly. */
export function savingsPercent(yearly: PlanOffer, monthly: PlanOffer): number | null {
  if (yearly.currency !== monthly.currency || yearly.amount <= 0 || monthly.amount <= 0) return null;
  const pct = Math.floor((1 - yearly.amount / (monthly.amount * 12)) * 100 + 1e-9);
  return pct > 0 ? pct : null;
}

/** "$29.99" for an amount the store gave only as a number. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export const planName = (plan: PlanOffer) => (plan.id === "yearly" ? "Yearly" : "Monthly");

/** "$29.99/year" */
export const priceLine = (plan: PlanOffer) => `${plan.price}/${plan.period}`;

/** "7 days free" */
export const trialLabel = (days: number) => `${countOf(days, "day")} free`;

/** The button under the picker. */
export function ctaLabel(plan: PlanOffer): string {
  return plan.trialDays ? `Try ${trialLabel(plan.trialDays)}` : `Subscribe for ${priceLine(plan)}`;
}

/** Google Play has the payment but the server (which enforces the limit) still reads the account as free. */
export const PRO_CONFIRMING = "Google Play confirmed your purchase. Lately is turning Pro on. This can take a minute.";

/** The auto-renewal disclosure Google Play's subscription policy wants beside the button. */
export function disclosure(plan: PlanOffer): string {
  const cost = `${plan.price} a ${plan.period}`;
  const terms = "Renews automatically until you cancel. Cancel anytime in Google Play > Subscriptions.";
  return plan.trialDays ? `Free for ${countOf(plan.trialDays, "day")}, then ${cost}. ${terms}` : `${cost}. ${terms}`;
}
