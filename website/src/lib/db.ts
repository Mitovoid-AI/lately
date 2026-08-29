// Server-side Supabase client using the service_role key.
//
// ⚠️ This client bypasses RLS. Import only from server code. Every query must
// scope by user_id explicitly — RLS is not protecting us anymore, our own code
// is.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./config";
import type { Database } from "./types";

let cached: SupabaseClient<Database> | null = null;

export function db(): SupabaseClient<Database> {
  if (!cached) {
    cached = createClient<Database>(SUPABASE_URL(), SUPABASE_SERVICE_ROLE_KEY(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
