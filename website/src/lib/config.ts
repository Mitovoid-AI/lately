// Server-side config. Everything here reads from process.env — see .env.example.
//
// ⚠️ SECURITY: SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security. It must
// never be exposed to the browser. Only import this module from server code
// (route handlers, the bot worker) — never from a client component.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string): string {
  return process.env[name] ?? "";
}

export const SUPABASE_URL = () => required("SUPABASE_URL");
export const SUPABASE_SERVICE_ROLE_KEY = () =>
  required("SUPABASE_SERVICE_ROLE_KEY");

export const TELEGRAM_BOT_TOKEN = () => required("TELEGRAM_BOT_TOKEN");

// AI providers are optional: without them saves still work, cards stay partial.
export const GROQ_API_KEY = () => optional("GROQ_API_KEY");
export const GEMINI_API_KEY = () => optional("GEMINI_API_KEY");

export const isGroqConfigured = () => Boolean(optional("GROQ_API_KEY"));
export const isGeminiConfigured = () => Boolean(optional("GEMINI_API_KEY"));

// All model names live here so a provider migration is a one-line change
// (PLAN.md §4: free tiers move — Gemini 2.5 sunsets Oct 2026).
export const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GEMINI_MODEL = "gemini-2.0-flash";
export const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

// Session lifetime for the website login.
export const SESSION_TTL_DAYS = 30;
// How long a bot-issued login code stays valid.
export const LOGIN_CODE_TTL_MINUTES = 10;
export const SESSION_COOKIE = "lately_session";
