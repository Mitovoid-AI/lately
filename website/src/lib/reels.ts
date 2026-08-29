// Per-user data access. Every function takes an explicit userId — RLS is closed
// to the public roles, so this module is the only thing keeping users' data
// separate. Never write a query here without a user_id filter.
import { db } from "./db";
import { extractInstagramUrl, parseShortcode } from "./instagram";
import type { Reel, SourceChannel, User } from "./types";

// Finds or creates the user for a Telegram account, and refreshes last_seen.
export async function upsertTelegramUser(tg: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}): Promise<User> {
  const { data, error } = await db()
    .from("users")
    .upsert(
      {
        telegram_id: tg.id,
        username: tg.username ?? null,
        first_name: tg.first_name ?? null,
        last_name: tg.last_name ?? null,
        photo_url: tg.photo_url ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "telegram_id" },
    )
    .select()
    .single();
  if (error) throw new Error(`upsertTelegramUser: ${error.message}`);
  return data as unknown as User;
}

export type SaveResult =
  | { ok: true; reel: Reel }
  | { ok: false; error: string };

// Writes a shared link as `pending` for this user. Capture must never fail.
export async function saveReel(
  userId: string,
  sharedText: string,
  channel: SourceChannel,
  reason: string | null = null,
): Promise<SaveResult> {
  const sourceUrl = extractInstagramUrl(sharedText) ?? sharedText.trim();
  if (!sourceUrl.startsWith("http")) {
    return { ok: false, error: "That doesn't look like a link." };
  }

  const { data, error } = await db()
    .from("reels")
    .insert({
      user_id: userId,
      source_url: sourceUrl,
      shortcode: parseShortcode(sourceUrl),
      status: "pending",
      source_channel: channel,
      reason: reason?.trim() || null,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, reel: data as unknown as Reel };
}

// Lists this user's saves, newest first. When `query` is present, filters via
// the generated tsvector column so search covers caption, transcript, summary,
// tags and category together.
export async function listReels(
  userId: string,
  query?: string,
): Promise<Reel[]> {
  let q = db()
    .from("reels")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const trimmed = query?.trim();
  if (trimmed) {
    q = q.textSearch("search_vector", trimmed, {
      type: "websearch",
      config: "english",
    });
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Reel[];
}

// Fetches one reel, scoped to the owner so a guessed id leaks nothing.
export async function getReel(
  userId: string,
  reelId: string,
): Promise<Reel | null> {
  const { data } = await db()
    .from("reels")
    .select("*")
    .eq("user_id", userId)
    .eq("id", reelId)
    .maybeSingle();
  return (data as unknown as Reel) ?? null;
}
