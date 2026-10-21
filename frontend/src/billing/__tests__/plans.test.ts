import { ctaLabel, disclosure, FALLBACK_PLANS, formatMoney, planName, priceLine, savingsPercent, trialLabel } from "../plans";
import type { PlanOffer } from "../types";

const [yearly, monthly] = FALLBACK_PLANS;
const plan = (o: Partial<PlanOffer>): PlanOffer => ({ ...yearly, ...o });

test("the stand-in plans are the launch prices: $29.99 a year with a 7-day trial, $3.99 a month", () => {
  expect(FALLBACK_PLANS.map((p) => [p.id, p.price, p.trialDays])).toEqual([
    ["yearly", "$29.99", 7],
    ["monthly", "$3.99", null],
  ]);
  expect(yearly.perMonth).toBe("$2.50");
});

test("the savings pill is the real saving, rounded down", () => {
  expect(savingsPercent(yearly, monthly)).toBe(37); // 29.99 vs 12 x 3.99 = 47.88 -> 37.36%
  expect(savingsPercent(plan({ amount: 24, currency: "EUR" }), plan({ id: "monthly", amount: 4, currency: "EUR" }))).toBe(50);
});

test("no pill when the saving can't be worked out honestly", () => {
  expect(savingsPercent(plan({ currency: "EUR" }), monthly)).toBeNull(); // two currencies
  expect(savingsPercent(plan({ amount: 0 }), monthly)).toBeNull();
  expect(savingsPercent(yearly, plan({ id: "monthly", amount: 0 }))).toBeNull();
  expect(savingsPercent(plan({ amount: 60 }), monthly)).toBeNull(); // the year costs more
  expect(savingsPercent(plan({ amount: 47.87 }), monthly)).toBeNull(); // under 1%: not worth a pill
});

test("button and disclosure copy follow the plan", () => {
  expect(ctaLabel(yearly)).toBe("Try 7 days free");
  expect(ctaLabel(monthly)).toBe("Subscribe for $3.99/month");
  expect(ctaLabel(plan({ trialDays: null }))).toBe("Subscribe for $29.99/year");
  expect(ctaLabel(plan({ trialDays: 1 }))).toBe("Try 1 day free");
  expect(disclosure(yearly)).toBe(
    "Free for 7 days, then $29.99 a year. Renews automatically until you cancel. Cancel anytime in Google Play > Subscriptions.",
  );
  expect(disclosure(monthly)).toBe(
    "$3.99 a month. Renews automatically until you cancel. Cancel anytime in Google Play > Subscriptions.",
  );
  expect(disclosure(plan({ trialDays: null }))).toMatch(/^\$29\.99 a year\. Renews automatically/);
});

test("small helpers", () => {
  expect([planName(yearly), planName(monthly)]).toEqual(["Yearly", "Monthly"]);
  expect(priceLine(yearly)).toBe("$29.99/year");
  expect(trialLabel(7)).toBe("7 days free");
  expect(formatMoney(2.5, "USD")).toBe("$2.50");
  expect(formatMoney(2.5, "not-a-currency")).toBe("2.50 not-a-currency");
});
