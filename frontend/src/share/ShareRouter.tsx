import { useRootNavigationState, useRouter } from "expo-router";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthProvider";
import { deviceStore, type KeyValueStore } from "../lib/storage";

/** Where a shared link waits while the person signs in (it survives an app restart). */
export const PENDING_SHARE_KEY = "lately.pending-share";

export const PendingShareContext = createContext<string | null>(null);

/** The shared text still waiting for a signed-in session, if any (the sign-in screen mentions it). */
export function usePendingShare() {
  return useContext(PendingShareContext);
}

/**
 * Turns an incoming share (Instagram's share sheet → Lately) into the save sheet. Signed in, it
 * opens /save-sheet with the shared text at once; signed out, the text is kept until sign-in
 * completes and the save continues from there.
 */
export function ShareRouter({
  incoming,
  onConsumed,
  store = deviceStore,
  children,
}: {
  /** Text from the platform share intent; null when there is none. */
  incoming: string | null;
  /** Called once the incoming share has been taken (clears the native intent). */
  onConsumed: () => void;
  store?: KeyValueStore;
  children?: ReactNode;
}) {
  const { status } = useAuth();
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const [pending, setPending] = useState<string | null>(null);
  const routed = useRef<string | null>(null);

  // A share kept from before a restart (e.g. the OAuth round trip relaunched the app).
  useEffect(() => {
    let active = true;
    store
      .getItem(PENDING_SHARE_KEY)
      .then((saved) => {
        if (active && saved) setPending((p) => p ?? saved);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [store]);

  // Take each new share: keep it on the device first, then let the native intent go.
  // (`taken` stops a re-render that still carries the same intent from taking it twice.)
  const taken = useRef<string | null>(null);
  useEffect(() => {
    if (incoming === null) {
      taken.current = null;
      return;
    }
    if (taken.current === incoming) return;
    taken.current = incoming;
    const text = incoming.trim();
    onConsumed();
    if (!text) return;
    routed.current = null;
    store
      .setItem(PENDING_SHARE_KEY, text)
      .catch(() => {})
      .then(() => setPending(text));
  }, [incoming, onConsumed, store]);

  // Signed in and the navigator is up: open the save sheet once per share.
  useEffect(() => {
    if (!pending || status !== "signed-in" || !navReady || routed.current === pending) return;
    routed.current = pending;
    router.push({ pathname: "/save-sheet", params: { text: pending } });
    store
      .setItem(PENDING_SHARE_KEY, "")
      .catch(() => {})
      .then(() => setPending((p) => (p === pending ? null : p)));
  }, [pending, status, navReady, router, store]);

  return <PendingShareContext.Provider value={pending}>{children}</PendingShareContext.Provider>;
}
