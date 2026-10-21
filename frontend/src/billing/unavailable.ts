// Live mode with no store to ask: no RevenueCat key in this build, the web, or Expo Go. The
// paywall still shows the prices; there is no fake purchase here, the button explains why.
import { FALLBACK_PLANS } from "./plans";
import { BillingError, UNAVAILABLE_MESSAGE, type BillingClient } from "./types";

export function createUnavailableBilling(): BillingClient {
  return {
    kind: "unavailable",
    identify: async () => {},
    reset: async () => {},
    getPlans: async () => FALLBACK_PLANS,
    purchase: async () => {
      throw new BillingError(UNAVAILABLE_MESSAGE);
    },
    restore: async () => false,
    isProActive: async () => false,
    managementUrl: async () => null,
    onChange: () => () => {},
  };
}
