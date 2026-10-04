// Read EXPO_PUBLIC_* once. Expo inlines these at build time, so each one must be
// referenced by its full name.
export const config = {
  apiMode: process.env.EXPO_PUBLIC_API_MODE === "live" ? ("live" as const) : ("demo" as const),
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000",
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
};
