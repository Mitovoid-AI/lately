// Read EXPO_PUBLIC_* once. Expo inlines these at build time, so each one must be
// referenced by its full name.
export const config = {
  apiMode: process.env.EXPO_PUBLIC_API_MODE === "live" ? ("live" as const) : ("demo" as const),
  // A localhost URL is swapped for the dev machine when the app runs on a phone (lib/apiUrl.ts).
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8001",
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
};
