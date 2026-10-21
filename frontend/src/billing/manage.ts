import { Linking } from "react-native";

import { PLAY_SUBSCRIPTIONS_URL, type BillingClient } from "./types";

/**
 * Opens the page where the subscription is managed: the store's own link when it has one,
 * Google Play's subscription list otherwise. Rejects when the phone can't open it.
 */
export async function openManageSubscription(client: BillingClient): Promise<void> {
  const url = (await client.managementUrl().catch(() => null)) ?? PLAY_SUBSCRIPTIONS_URL;
  await Linking.openURL(url);
}
