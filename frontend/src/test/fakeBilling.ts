import { FALLBACK_PLANS } from "../billing/plans";
import type { BillingClient, PlanId, PlanOffer, PurchaseResult } from "../billing/types";

/**
 * A BillingClient whose every call is a jest.fn (override any of them), plus `emit` to play a
 * store-side change ("Pro just turned on") to whoever called onChange.
 */
export function fakeBilling(overrides: Partial<BillingClient> = {}) {
  const listeners = new Set<(proActive: boolean) => void>();
  const client = {
    kind: "store" as BillingClient["kind"],
    identify: jest.fn(async (_userId: string) => {}),
    reset: jest.fn(async () => {}),
    getPlans: jest.fn(async (): Promise<PlanOffer[]> => FALLBACK_PLANS),
    purchase: jest.fn(async (_id: PlanId): Promise<PurchaseResult> => "purchased"),
    restore: jest.fn(async () => false),
    isProActive: jest.fn(async () => false),
    managementUrl: jest.fn(async (): Promise<string | null> => null),
    onChange: jest.fn((cb: (proActive: boolean) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
    ...overrides,
  } satisfies BillingClient;
  return { client, emit: (proActive: boolean) => listeners.forEach((cb) => cb(proActive)), listeners };
}
