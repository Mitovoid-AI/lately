// Enrichment orchestrator (server side).
//
//   pending reel
//      │  1. fetchReel()        → caption + thumbnail + media URL
//      │  2. transcribeFromUrl()→ transcript (Groq Whisper)
//      │  3. structureReel()    → title/summary/category/tags/steps (Gemini)
//      ▼  4. write back          → status 'enriched', search_vector auto-fills
//   searchable card
//
// Rule (PLAN.md §2): the save already succeeded, so enrichment is allowed to
// fail. Any failure marks the reel `partial` with a reason instead of losing it.
import { db } from "./db";
import { fetchReel } from "./fetchReel";
import { transcribeFromUrl } from "./transcribe";
import { structureReel } from "./structure";
import { isGeminiConfigured, isGroqConfigured } from "./config";
import type { Reel } from "./types";

export type EnrichResult =
  | { ok: true; reel: Reel }
  | { ok: false; error: string };

async function markPartial(
  id: string,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<EnrichResult> {
  await db()
    .from("reels")
    .update({ status: "partial", failure_reason: reason, ...extra })
    .eq("id", id);
  return { ok: false, error: reason };
}

export async function enrichReel(id: string): Promise<EnrichResult> {
  const { data: row, error } = await db()
    .from("reels")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !row) {
    return { ok: false, error: error?.message ?? "Reel not found" };
  }
  const reel = row as unknown as Reel;

  // 1. Fetch the public page.
  let caption = "";
  let thumbnailUrl: string | null = null;
  let videoUrl: string | null = null;
  try {
    const fetched = await fetchReel(reel.source_url);
    caption = fetched.caption;
    thumbnailUrl = fetched.thumbnailUrl;
    videoUrl = fetched.videoUrl;
  } catch (e) {
    return markPartial(
      id,
      `Fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 2. Transcribe. Non-fatal — we can still structure from the caption alone.
  let transcript = "";
  if (videoUrl && isGroqConfigured()) {
    try {
      transcript = await transcribeFromUrl(videoUrl);
    } catch {
      transcript = "";
    }
  }

  if (!caption && !transcript) {
    return markPartial(id, "No caption or transcript could be extracted.", {
      thumbnail_path: thumbnailUrl,
    });
  }

  // 3. Structure. Without a Gemini key we keep the text we have as a partial.
  if (!isGeminiConfigured()) {
    return markPartial(id, "AI not configured — caption saved only.", {
      caption,
      transcript,
      thumbnail_path: thumbnailUrl,
    });
  }

  let structured;
  try {
    structured = await structureReel(caption, transcript);
  } catch (e) {
    return markPartial(
      id,
      `Structuring failed: ${e instanceof Error ? e.message : String(e)}`,
      { caption, transcript, thumbnail_path: thumbnailUrl },
    );
  }

  // 4. Write back. search_vector regenerates automatically.
  const { data, error: upErr } = await db()
    .from("reels")
    .update({
      status: "enriched",
      caption,
      transcript,
      thumbnail_path: thumbnailUrl,
      title: structured.title,
      summary: structured.summary,
      category: structured.category,
      tags: structured.tags,
      steps: structured.steps,
      entities: structured.entities,
      enriched_at: new Date().toISOString(),
      failure_reason: null,
    })
    .eq("id", id)
    .select()
    .single();

  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, reel: data as unknown as Reel };
}
