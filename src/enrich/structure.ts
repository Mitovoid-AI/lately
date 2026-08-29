// Gemini Flash structurer — the "understand the content" brain (PLAN.md §1, §3).
// Takes caption + transcript, returns typed JSON: title, summary, category,
// tags, steps, and category-specific entities. This is where the product value
// lives — generic summaries are a commodity; category-specific extraction is not.
import { z } from "zod";
import {
  GEMINI_API_KEY,
  GEMINI_BASE_URL,
  GEMINI_MODEL,
} from "../config";

// The categories the model must choose from. Keep in sync with seed.sql.
export const CATEGORIES = [
  "Dev & Tools",
  "Career & Jobs",
  "Food & Places",
  "Fitness",
  "Style & Vibes",
  "Watch Later",
] as const;

// Structured output we validate every response against.
export const StructuredReel = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string()).max(8),
  steps: z.array(z.string()).max(10),
  // Category-specific extraction; free-form because shape differs per category.
  entities: z.record(z.unknown()),
});
export type StructuredReel = z.infer<typeof StructuredReel>;

const SYSTEM_PROMPT = `You organise saved Instagram reels for fast retrieval.
Given a reel's caption and transcript, return ONLY valid JSON matching this shape:
{
  "title": short human title (<= 120 chars),
  "summary": 1-2 sentence summary of what the reel actually teaches or shows,
  "category": one of ${CATEGORIES.map((c) => `"${c}"`).join(", ")},
  "tags": up to 8 short lowercase search tags,
  "steps": the concrete actionable steps or key facts (empty array if none),
  "entities": category-specific structured data. Examples:
     Dev & Tools -> {"repo_urls": [], "tools": []}
     Food & Places -> {"place_names": [], "city": "", "maps_query": ""}
     Career & Jobs -> {"repo_urls": [], "companies": []}
     Fitness -> {"exercises": [], "duration": ""}
}
Pick the single best category. Do not invent facts not present in the text.
Return JSON only, no markdown fences, no commentary.`;

// Strips ```json fences some models add despite instructions.
function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

async function callGemini(caption: string, transcript: string): Promise<string> {
  const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `CAPTION:\n${caption || "(none)"}\n\nTRANSCRIPT:\n${
              transcript || "(none)"
            }`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const text: string | undefined =
    json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

// Structures a reel. Retries once on malformed JSON (PLAN.md §1 step 5).
export async function structureReel(
  caption: string,
  transcript: string,
): Promise<StructuredReel> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callGemini(caption, transcript);
      const parsed = JSON.parse(stripFences(raw));
      return StructuredReel.parse(parsed);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `structureReel failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
