// Data access for reels. Phase 1 keeps this thin: capture must never fail,
// so saveReel writes a `pending` row immediately (PLAN.md §2).
import { supabase } from "./supabase";
import { DEV_USER_ID } from "./config";
import { extractInstagramUrl, parseShortcode } from "./lib/instagram";
import { enrichReel } from "./enrich";
import type { Reel } from "./types";

export type SaveResult =
  | { ok: true; reel: Reel }
  | { ok: false; error: string };

// Writes a shared reel as `pending`. Enrichment happens later and is allowed
// to fail — the capture itself is the promise we must keep.
export async function saveReel(
  sharedText: string,
  reason: string | null,
): Promise<SaveResult> {
  const sourceUrl = extractInstagramUrl(sharedText) ?? sharedText.trim();
  if (!sourceUrl) {
    return { ok: false, error: "No URL found in shared content." };
  }

  const shortcode = parseShortcode(sourceUrl);

  const { data, error } = await supabase
    .from("reels")
    .insert({
      user_id: DEV_USER_ID,
      source_url: sourceUrl,
      shortcode,
      status: "pending",
      reason: reason?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  // Kick off enrichment in the background. We deliberately DON'T await it — the
  // save is already durable, so the UI confirms instantly while the AI works.
  const saved = data as Reel;
  void enrichReel(saved.id);

  return { ok: true, reel: saved };
}

// Re-runs enrichment on a reel (used by the retry button on partial cards).
export async function retryReel(id: string): Promise<void> {
  await enrichReel(id);
}

// Lists saves newest-first. Search filters over the generated tsvector column
// via websearch when a query is present.
export async function listReels(query?: string): Promise<Reel[]> {
  let q = supabase
    .from("reels")
    .select("*")
    .eq("user_id", DEV_USER_ID)
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
  return (data ?? []) as Reel[];
}
