// Supabase client configured for React Native.
// AsyncStorage persists the auth session; URL polyfill is required by supabase-js in RN.
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { Database } from "./types";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // RN has no URL to parse the session back from, so disable URL detection.
    detectSessionInUrl: false,
  },
});
