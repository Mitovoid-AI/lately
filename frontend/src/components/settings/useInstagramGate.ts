import { useAuth } from "../../auth/AuthProvider";
import { useInstagramLink } from "./useInstagramLink";

/**
 * Whether the app may open, or must ask for Instagram first.
 * - "connect": a live account, the server offers saving from Instagram DMs, and this account
 *   hasn't connected yet. Connecting Instagram is the first thing a new account does.
 * - "checking": still asking the server.
 * - "open": connected, the feature is off, demo mode, or the check failed. A failed check opens
 *   the app, so a slow or unreachable server never locks anyone out.
 */
export type InstagramGate = "checking" | "connect" | "open";

export function useInstagramGate(): InstagramGate {
  const { mode } = useAuth();
  const query = useInstagramLink();
  if (mode !== "live") return "open";
  if (query.isPending) return "checking";
  const link = query.data;
  if (query.isError || !link) return "open";
  return link.enabled && link.handle && !link.linked ? "connect" : "open";
}
