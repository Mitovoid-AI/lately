// Web build: there is no store here, and keeping react-native-purchases out of the web bundle
// keeps RevenueCat's browser SDK out of it too. BillingProvider never picks the store on web.
import type { BillingClient } from "./types";

export type PurchasesSdk = never;

export function createStoreBilling(_o: { apiKey: string }): BillingClient {
  throw new Error("Store billing is not available on web.");
}
