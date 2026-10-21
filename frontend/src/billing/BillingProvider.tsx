import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NativeModules, Platform } from "react-native";

import type { PlanSync } from "../api/contract";
import type { DemoApi } from "../api/demo";
import { useApi } from "../api/index";
import { useAuth } from "../auth/AuthProvider";
import { config } from "../config";
import { createDemoBilling } from "./demo";
import { createStoreBilling } from "./store";
import type { BillingClient } from "./types";
import { createUnavailableBilling } from "./unavailable";

export interface BillingValue {
  client: BillingClient;
  /** The store says Pro is on. The server may still be catching up: GET /me has the final word on limits. */
  proActive: boolean;
  /**
   * Asks the server to re-read the plan (POST /billing/sync) and refreshes /me. Calls made
   * while one is running share it. Resolves to the server's answer, or null when it failed.
   */
  syncPlan(): Promise<PlanSync | null>;
}

const BillingContext = createContext<BillingValue | null>(null);

export function useBilling(): BillingValue {
  const value = useContext(BillingContext);
  if (!value) throw new Error("useBilling must be used inside <BillingProvider>");
  return value;
}

/** Expo Go has no RevenueCat native module (the SDK would fall back to a browser mode that rejects our key). */
function inExpoGo(): boolean {
  return !!(globalThis as { expo?: { modules?: { ExpoGo?: unknown } } }).expo?.modules?.ExpoGo;
}

/** react-native-purchases is linked only in builds made after it was added (an older dev APK has no RNPurchases module). */
const hasPurchasesModule = () => !!NativeModules.RNPurchases;

const isDemoApi = (api: object): api is DemoApi => "setPlan" in api && "currentPlan" in api;

/**
 * Demo mode: the demo store. Live mode: Google Play through RevenueCat when this build has
 * the public Android key and runs as a real Android app that has the RevenueCat native module;
 * otherwise a store-less stand-in (web, Expo Go, a build without the key or the module) that
 * shows the prices but sells nothing.
 * Keys: goog_ is the production Google Play key, test_ is RevenueCat's Test Store key for
 * development builds. Anything else (a secret sk_ key pasted by mistake) is ignored.
 */
export function chooseClient(o: {
  mode: "demo" | "live";
  demo?: DemoApi | null;
  platform?: string;
  androidKey?: string;
  expoGo?: boolean;
  /** Whether the RevenueCat native module is linked into this build. */
  nativeModule?: boolean;
}): BillingClient {
  if (o.mode === "demo") return o.demo ? createDemoBilling(o.demo) : createUnavailableBilling();
  const key = o.androidKey ?? config.revenuecatAndroidKey;
  const platform = o.platform ?? Platform.OS;
  const expoGo = o.expoGo ?? inExpoGo();
  const linked = o.nativeModule ?? hasPurchasesModule();
  if (platform === "android" && !expoGo && linked && /^(goog|test)_/.test(key)) return createStoreBilling({ apiKey: key });
  return createUnavailableBilling();
}

/**
 * Lately Pro billing for the signed-in user. It ties the store account to the Lately user id
 * (and forgets it on sign-out), tracks whether Pro is active, and, when the store reports a
 * change, asks the server to re-read the plan so the save limit follows.
 */
export function BillingProvider({ client: injected, children }: { client?: BillingClient; children: ReactNode }) {
  const api = useApi();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userId = auth.status === "signed-in" ? (auth.user?.id ?? null) : null;
  const demo = auth.mode === "demo" && isDemoApi(api) ? api : null;
  const client = useMemo(
    () => injected ?? chooseClient({ mode: auth.mode, demo }),
    [injected, auth.mode, demo],
  );

  // Whether the store says Pro, kept with the user it was read for (a later sign-in starts blank).
  const [seen, setSeen] = useState<{ userId: string; active: boolean } | null>(null);

  useEffect(() => {
    if (!userId) {
      void client.reset().catch(() => {});
      return;
    }
    let current = true;
    client
      .identify(userId)
      .then(() => client.isProActive())
      .then((active) => {
        if (current) setSeen({ userId, active });
      })
      .catch((e) => {
        if (__DEV__) console.warn("Billing could not identify the user:", e);
      });
    return () => {
      current = false;
    };
  }, [client, userId]);

  const inflight = useRef<Promise<PlanSync | null> | null>(null);
  const syncPlan = useCallback(() => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        const synced = await api.syncPlan();
        await queryClient.invalidateQueries({ queryKey: ["me"] });
        return synced;
      } catch {
        return null;
      }
    })().finally(() => {
      inflight.current = null;
    });
    inflight.current = run;
    return run;
  }, [api, queryClient]);

  useEffect(() => {
    if (!userId) return;
    return client.onChange((active) => {
      setSeen({ userId, active });
      // Pro turned on: the server must hear it before the next save. Pro lapsed: it already has.
      if (active) void syncPlan();
      else void queryClient.invalidateQueries({ queryKey: ["me"] });
    });
  }, [client, userId, syncPlan, queryClient]);

  const proActive = userId !== null && seen?.userId === userId && seen.active;
  const value = useMemo<BillingValue>(() => ({ client, proActive, syncPlan }), [client, proActive, syncPlan]);
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}
