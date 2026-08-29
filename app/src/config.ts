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

// --- Enrichment providers ---------------------------------------------------
// All model names live here so a provider migration is a one-line change
// (PLAN.md §4: "put every model name in one config file").
export const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? "";
export const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "";

// Groq Whisper: free tier ~25MB cap; reel audio is 1–5MB.
export const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

// Gemini Flash: free AI Studio tier for structuring caption+transcript → JSON.
export const GEMINI_MODEL = "gemini-2.0-flash";
export const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

export const isGroqConfigured = Boolean(GROQ_API_KEY);
export const isGeminiConfigured = Boolean(GEMINI_API_KEY);
