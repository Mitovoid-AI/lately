// Gemini Flash structurer (server side) — the "understand the content" step.
// Takes caption + transcript, returns validated JSON: title, summary, category,
// tags, steps, and category-specific entities.
//
// Category-specific extraction is the actual product (PLAN.md §3): generic
// summaries are a commodity, a tappable repo link or a Maps query is not.
import { z } from "zod";
import { GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_MODEL } from "./config";

export const CATEGORIES = [
  "Dev & Tools",
  "Career & Jobs",
  "Food & Places",
  "Fitness",
  "Style & Vibes",
  "Watch Later",
] as const;

export const StructuredReel = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string()).max(8),
  steps: z.array(z.string()).max(10),
  entities: z.record(z.string(), z.unknown()),
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

function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

async function callGemini(caption: string, transcript: string): Promise<string> {
  const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

// Retries once on malformed JSON (PLAN.md §1 step 5).
export async function structureReel(
  caption: string,
  transcript: string,
): Promise<StructuredReel> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callGemini(caption, transcript);
      return StructuredReel.parse(JSON.parse(stripFences(raw)));
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
