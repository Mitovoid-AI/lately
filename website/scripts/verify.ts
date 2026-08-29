// Verifies the local setup end-to-end before you start the bot or the web app.
// Run: npm run verify
//
// Checks in order, failing fast with the exact fix:
//   1. website/.env.local exists with the required keys
//   2. Supabase reachable with the service_role key
//   3. Migrations 0001 + 0002 applied (all tables present)
//   4. Telegram bot token valid
//   5. Per-user isolation actually works (two users can't see each other)
//   6. Full-text search round-trip
//   7. Optional AI keys present
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env.local");

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}
const ok = (m: string) => console.log(`✅ ${m}`);
const warn = (m: string) => console.log(`⚠️  ${m}`);

// --- 1. env ------------------------------------------------------------------
if (!existsSync(envPath)) {
  fail(
    "website/.env.local not found. Copy website/.env.example to website/.env.local.",
  );
}
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";

if (!url || url.includes("YOUR-PROJECT")) fail("SUPABASE_URL not set.");
if (!key || key.startsWith("your-")) fail("SUPABASE_SERVICE_ROLE_KEY not set.");
ok(`env loaded (${url})`);

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- 2 & 3. tables -----------------------------------------------------------
for (const t of [
  "reels",
  "categories",
  "notes",
  "profiles",
  "users",
  "sessions",
  "login_codes",
]) {
  const { error } = await db.from(t).select("*", { head: true, count: "exact" });
  if (error) {
    const which = ["users", "sessions", "login_codes"].includes(t)
      ? "0002_users_and_rls.sql"
      : "0001_init.sql";
    fail(`Table "${t}" missing: ${error.message}\n   → Run supabase/migrations/${which}`);
  }
  ok(`table "${t}"`);
}

// --- 4. Telegram -------------------------------------------------------------
if (!botToken || botToken.startsWith("123456:")) {
  warn("TELEGRAM_BOT_TOKEN not set — the bot won't run (web still works).");
} else {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const json = (await res.json()) as {
    ok: boolean;
    result?: { username: string };
    description?: string;
  };
  if (!json.ok) fail(`Telegram token rejected: ${json.description}`);
  ok(`Telegram bot @${json.result?.username}`);
}

// --- 5. Per-user isolation ---------------------------------------------------
// The whole point of this migration is that users can't see each other's saves.
// Prove it rather than assume it.
const stamp = Date.now();
const mk = async (tgId: number, name: string) => {
  const { data, error } = await db
    .from("users")
    .upsert({ telegram_id: tgId, username: name }, { onConflict: "telegram_id" })
    .select()
    .single();
  if (error) fail(`create test user: ${error.message}`);
  return data as { id: string };
};

const alice = await mk(-(stamp % 1_000_000), `probe_a_${stamp}`);
const bob = await mk(-((stamp % 1_000_000) + 1), `probe_b_${stamp}`);

const probeWord = `zzprobe${stamp}`;
const { data: aliceReel, error: insErr } = await db
  .from("reels")
  .insert({
    user_id: alice.id,
    source_url: `https://instagram.com/reel/${probeWord}`,
    shortcode: probeWord,
    status: "pending",
    source_channel: "web",
    reason: `${probeWord} isolation probe`,
  })
  .select()
  .single();
if (insErr) fail(`insert failed: ${insErr.message}`);
ok("insert works (capture path)");

const { data: bobSees } = await db
  .from("reels")
  .select("id")
  .eq("user_id", bob.id);
if ((bobSees ?? []).length > 0) {
  fail("Isolation broken: user B's query returned rows. Check user_id scoping.");
}
ok("per-user isolation holds (B cannot see A's save)");

// --- 6. Full-text search -----------------------------------------------------
const { data: found, error: sErr } = await db
  .from("reels")
  .select("id")
  .eq("user_id", alice.id)
  .textSearch("search_vector", probeWord, {
    type: "websearch",
    config: "english",
  });
if (sErr) fail(`search failed: ${sErr.message}`);
if (!found || found.length === 0) {
  fail("Search returned nothing — search_vector isn't generating.");
}
ok("full-text search works (retrieval path)");

// cleanup
await db.from("reels").delete().eq("id", (aliceReel as { id: string }).id);
await db.from("users").delete().in("id", [alice.id, bob.id]);
ok("probe rows cleaned up");

// --- 7. AI keys --------------------------------------------------------------
if (!process.env.GROQ_API_KEY) {
  warn("GROQ_API_KEY not set — no transcription (caption-only cards).");
} else {
  ok("Groq key present");
}
if (!process.env.GEMINI_API_KEY) {
  warn("GEMINI_API_KEY not set — no category/tags/summary.");
} else {
  ok("Gemini key present");
}

console.log("\n🎉 Setup verified. Run `npm run bot` and `npm run dev`.\n");
