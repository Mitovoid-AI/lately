// Verifies your Supabase setup end-to-end. Run: node scripts/verify-supabase.mjs
//
// Checks, in order:
//   1. .env exists and has the required keys
//   2. Supabase URL is reachable with the anon key
//   3. All four tables exist
//   4. Seed data landed (dev profile + 6 categories)
//   5. Full-text search column works (insert → search → cleanup)
//
// Exits non-zero on the first hard failure so you know exactly what to fix.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}
function ok(msg) {
  console.log(`✅ ${msg}`);
}
function warn(msg) {
  console.log(`⚠️  ${msg}`);
}

// --- 1. .env -----------------------------------------------------------------
if (!existsSync(envPath)) {
  fail(".env not found. Copy .env.example to .env and fill in your keys.");
}

const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const url = env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const devUser =
  env.EXPO_PUBLIC_DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";

if (!url || url.includes("YOUR-PROJECT")) {
  fail("EXPO_PUBLIC_SUPABASE_URL is missing or still the placeholder.");
}
if (!anonKey || anonKey === "your-anon-key") {
  fail("EXPO_PUBLIC_SUPABASE_ANON_KEY is missing or still the placeholder.");
}
ok(`.env loaded (project: ${url})`);

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(url, anonKey);

// --- 2 & 3. Tables exist -----------------------------------------------------
for (const table of ["reels", "categories", "notes", "profiles"]) {
  const { error } = await db.from(table).select("*", { head: true, count: "exact" });
  if (error) {
    fail(
      `Table "${table}" not reachable: ${error.message}\n` +
        `   → Run supabase/migrations/0001_init.sql in the SQL editor first.`,
    );
  }
  ok(`table "${table}" exists`);
}

// --- 4. Seed data ------------------------------------------------------------
const { data: cats } = await db.from("categories").select("name");
if (!cats || cats.length === 0) {
  warn('No categories found — run supabase/seed.sql to get the 6 defaults.');
} else {
  ok(`seed categories: ${cats.map((c) => c.name).join(", ")}`);
}

const { data: profile } = await db
  .from("profiles")
  .select("id, plan")
  .eq("id", devUser)
  .maybeSingle();
if (!profile) {
  warn(`No profile row for dev user ${devUser} — run supabase/seed.sql.`);
} else {
  ok(`dev profile exists (plan: ${profile.plan})`);
}

// --- 5. Full-text search round-trip -----------------------------------------
const probe = `zzprobe${Date.now()}`;
const { data: inserted, error: insErr } = await db
  .from("reels")
  .insert({
    user_id: devUser,
    source_url: `https://instagram.com/reel/${probe}`,
    shortcode: probe,
    status: "pending",
    reason: `${probe} searchable probe`,
  })
  .select()
  .single();

if (insErr) {
  fail(`Insert failed: ${insErr.message}\n   → Check RLS policies in 0001_init.sql.`);
}
ok("insert works (capture path)");

const { data: found, error: searchErr } = await db
  .from("reels")
  .select("id")
  .textSearch("search_vector", probe, { type: "websearch", config: "english" });

if (searchErr) {
  fail(`Search failed: ${searchErr.message}\n   → Is search_vector column present?`);
}
if (!found || found.length === 0) {
  fail("Search returned nothing — the search_vector column is not generating.");
}
ok("full-text search works (retrieval path)");

// Cleanup the probe row so your real saves stay clean.
await db.from("reels").delete().eq("id", inserted.id);
ok("probe row cleaned up");

// --- Optional: AI keys -------------------------------------------------------
if (!env.EXPO_PUBLIC_GROQ_API_KEY || env.EXPO_PUBLIC_GROQ_API_KEY === "your-groq-key") {
  warn("GROQ key not set — transcription will be skipped (caption-only cards).");
} else {
  ok("Groq key present");
}
if (!env.EXPO_PUBLIC_GEMINI_API_KEY || env.EXPO_PUBLIC_GEMINI_API_KEY === "your-gemini-key") {
  warn("GEMINI key not set — no category/tags/summary until you add it.");
} else {
  ok("Gemini key present");
}

console.log("\n🎉 Supabase setup verified. Run: npm start\n");
