// Loads Supabase config from Expo public env vars.
// Set these in a .env file (see .env.example) — never commit real keys.
import Constants from "expo-constants";

type Extra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? "";
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? "";

// Phase 1: single hardcoded user until magic-link auth lands in Phase 3.
export const DEV_USER_ID =
  process.env.EXPO_PUBLIC_DEV_USER_ID ??
  "00000000-0000-0000-0000-000000000001";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
