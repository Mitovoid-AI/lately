// Enrichment orchestrator — the pipeline that turns a raw saved reel into a
// searchable, categorised card. This is the full flow the product promises:
//
//   pending row
//      │  1. fetchReel()      → caption + thumbnail + video/audio (on device)
//      │  2. transcribeAudio()→ transcript from the reel's audio (Groq Whisper)
//      │  3. structureReel()  → title/summary/category/tags/steps (Gemini Flash)
//      ▼  4. write back        → status = 'enriched', search_vector auto-fills
//   enriched row  →  now searchable
//
// Design rule (PLAN.md §2): capture already succeeded. Enrichment is allowed to
// fail — on any failure we mark the reel `partial` (with a reason) instead of
// losing it, and the UI can offer a retry.
import { supabase } from "../supabase";
import { fetchReel } from "./fetchReel";
import { transcribeAudio } from "./transcribe";
import { structureReel } from "./structure";
import {
  isGeminiConfigured,
  isGroqConfigured,
} from "../config";
import type { Reel } from "../types";

export type EnrichResult =
  | { ok: true; reel: Reel }
  | { ok: false; error: string };

// Marks a reel partial with a reason so the user sees what failed and can retry.
async function markPartial(id: string, reason: string): Promise<EnrichResult> {
  const { data } = await supabase
    .from("reels")
    .update({ status: "partial", failure_reason: reason })
    .eq("id", id)
    .select()
    .single();
  return { ok: false, error: reason };
}

// Runs the full pipeline for one reel id. Safe to call again on a `partial`
// reel (retry) — it re-fetches from scratch.
export async function enrichReel(id: string): Promise<EnrichResult> {
  // Load the pending row.
  const { data: reel, error } = await supabase
    .from("reels")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !reel) {
    return { ok: false, error: error?.message ?? "Reel not found" };
  }

  // 1. Fetch the reel page on-device.
  let caption = "";
  let thumbnailUrl: string | null = null;
  let videoUrl: string | null = null;
  try {
    const fetched = await fetchReel((reel as Reel).source_url);
    caption = fetched.caption;
    thumbnailUrl = fetched.thumbnailUrl;
    videoUrl = fetched.videoUrl;
  } catch (e) {
    return markPartial(
      id,
      `Fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 2. Transcribe audio if we have a media URL and Groq is configured.
  //    Missing transcript is not fatal — we can still structure from caption.
  let transcript = "";
  if (videoUrl && isGroqConfigured) {
    try {
      transcript = await transcribeAudio({ uri: videoUrl });
    } catch {
      // Non-fatal: proceed caption-only.
      transcript = "";
    }
  }

  // Need at least some text to structure. Otherwise degrade to caption-only card.
  if (!caption && !transcript) {
    return markPartial(id, "No caption or transcript could be extracted.");
  }

  // 3. Structure with Gemini. If Gemini isn't configured, save a caption-only
  //    partial rather than failing hard.
  if (!isGeminiConfigured) {
    const { data } = await supabase
      .from("reels")
      .update({
        status: "partial",
        caption,
        transcript,
        thumbnail_path: thumbnailUrl,
        failure_reason: "AI not configured — caption saved only.",
      })
      .eq("id", id)
      .select()
      .single();
    return data
      ? { ok: true, reel: data as Reel }
      : { ok: false, error: "update failed" };
  }

  let structured;
  try {
    structured = await structureReel(caption, transcript);
  } catch (e) {
    // Keep the caption/transcript we got; mark partial so retry only redoes AI.
    await supabase
      .from("reels")
      .update({ caption, transcript, thumbnail_path: thumbnailUrl })
      .eq("id", id);
    return markPartial(
      id,
      `Structuring failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 4. Write the enriched row back. search_vector regenerates automatically.
  const { data, error: upErr } = await supabase
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
  return { ok: true, reel: data as Reel };
}
