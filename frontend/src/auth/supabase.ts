import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { config } from "../config";

let client: SupabaseClient | null = null;

/** Supabase is only used in live mode, so it is created lazily. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error("Live mode needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
    }
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        // PKCE: redirects carry a one-time ?code= that only this app (holding the verifier)
        // can exchange, instead of tokens any app registered for lately:// could read.
        flowType: "pkce",
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web",
      },
    });
  }
  return client;
}
