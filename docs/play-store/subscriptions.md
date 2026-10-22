# Subscriptions in Play Console

The exact Play Console setup for Lately Pro lives in **`docs/billing-setup.md`** (Part 1 for
the payments profile and license testers, Part 4 for the subscription, Part 5 for RevenueCat's
access). This page does not repeat it; it lists the values to check against and the policy
points a reviewer looks at.

## Values (from `docs/billing-setup.md`, "The names to copy exactly")

| Item | Value |
|---|---|
| Subscription product ID | `lately_pro` (can never be changed or reused) |
| Name | `Lately Pro` |
| Base plans | `monthly`: auto-renewing, 1 month, $3.99 · `yearly`: auto-renewing, 1 year, $29.99 |
| Offer | `trial-7d` on `yearly`: 7-day free trial, new customers who never had this subscription |
| Benefit text (optional) | `Unlimited saves every month` |
| RevenueCat entitlement / offering | `pro` / `default` with `$rc_monthly` and `$rc_annual` |

If any of these change, change `docs/billing-setup.md`, the full description in `listing.md`
("Free and Pro"), and `frontend/legal/terms.md` together.

## Policy check

Google's [Subscriptions policy](https://support.google.com/googleplay/android-developer/answer/9900533)
asks for the terms to be clear before purchase, a trial that says how long it lasts, what it
costs after, and that it converts automatically, an easy way to cancel, and nothing that
hides the charge. What Lately has, and what to check by hand on the release build:

| Requirement | Where Lately covers it | Check by hand |
|---|---|---|
| Price, billing period, auto-renewal on the plan screen | `disclosure()` in `frontend/src/billing/plans.ts`: "<price> a <period>. Renews automatically until you cancel. Cancel anytime in Google Play > Subscriptions." Prices come from Google Play, so they are local. | The line is visible next to the subscribe button without scrolling or extra taps. |
| Trial: length, price after, conversion, how to cancel | Same function with a trial: "Free for 7 days, then <price> a year." plus the renewal and cancel sentence. Trial days come from Google Play's offer and show only when the account is eligible (`trialDaysOf` in `frontend/src/billing/store.ts`). | On a license-tester account that never had Pro, the yearly plan shows the trial line. |
| Annual plan not shown mainly as a monthly price | The yearly card shows the yearly price first, then "· <per month>/month" (`PaywallScreen.tsx`). | The yearly price reads as the main price. |
| Dismiss without subscribing | Close button in the paywall's top bar; the free plan keeps working. | |
| Cancel and manage in the app | Manage subscription opens Google Play (`frontend/src/billing/manage.ts`). | Opens the Play subscriptions page. |
| Terms in writing | `frontend/legal/terms.md` "Lately Pro subscriptions"; the paywall links to Terms. | |
| SKU name not misleading | Product name `Lately Pro`, no "free" in the name. | |

The paywall and Account screen were being edited by another workstream on 2026-10-22; the
"Check by hand" column is for the founder or a tester on the closed-test build.

## Data safety link

Buying Pro is why Data safety declares **Financial info → Purchase history**
(`data-safety.md`). Google Play keeps the payment details; Lately never sees them.
