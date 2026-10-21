// Demo mode's stand-in for the store: the fixed US plans, and a purchase that waits a moment
// and then turns Pro on in the demo API (so GET /me and the save limit follow, like live).
import type { DemoApi } from "../api/demo";
import { FALLBACK_PLANS } from "./plans";
import type { BillingClient, PlanId } from "./types";

/** How long the pretend store sheet "takes". */
export const DEMO_PURCHASE_MS = 600;

const DAY = 24 * 60 * 60 * 1000;

export function createDemoBilling(
  demo: Pick<DemoApi, "currentPlan" | "setPlan">,
  o: { delayMs?: number; now?: () => number } = {},
): BillingClient {
  const delayMs = o.delayMs ?? DEMO_PURCHASE_MS;
  const now = o.now ?? Date.now;
  const listeners = new Set<(proActive: boolean) => void>();
  // A lifetime grant isn't a store subscription: the store has nothing to say about it.
  const proActive = () => demo.currentPlan() === "pro";
  const lasts = (id: PlanId) => (id === "yearly" ? 365 : 30) * DAY;

  return {
    kind: "demo",
    identify: async () => {},
    reset: async () => {},
    getPlans: async () => FALLBACK_PLANS,
    async purchase(id) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      demo.setPlan("pro", new Date(now() + lasts(id)).toISOString());
      listeners.forEach((cb) => cb(true));
      return "purchased";
    },
    restore: async () => proActive(),
    isProActive: async () => proActive(),
    managementUrl: async () => null,
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
