// On-device Instagram fetch (PLAN.md §0: "fetch on the phone, think in the cloud").
//
// Instagram blocks server-side fetching, so this MUST run on the device where
// the user has a residential IP. We pull the reel's public page HTML and parse
// the caption / thumbnail / video URL out of the embedded JSON.
//
// The parser is deliberately defensive: Instagram changes its HTML without
// notice, so every extractor is best-effort and we ALWAYS degrade to
// caption-only (or nothing) rather than throwing. Versioned parser rules can
// later be shipped as Supabase remote config instead of hardcoding here.

export type FetchedReel = {
  caption: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
};

const PARSER_VERSION = 1;

// Pull the page HTML using the device's own session/IP.
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // A real UA reduces the chance of an interstitial login wall.
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`IG fetch ${res.status}`);
  return await res.text();
}

// Best-effort extractors. Each returns null on miss; caller degrades gracefully.
function extractCaption(html: string): string {
  // og:description usually carries the caption text.
  const og = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
  );
  if (og?.[1]) return decodeEntities(og[1]);

  // Fallback: embedded JSON "caption" / "edge_media_to_caption".
  const cap = html.match(/"caption"\s*:\s*"([^"]{0,4000})"/);
  if (cap?.[1]) return decodeEntities(cap[1]);
  return "";
}

function extractThumbnail(html: string): string | null {
  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i,
  );
  return og?.[1] ? decodeEntities(og[1]) : null;
}

function extractVideoUrl(html: string): string | null {
  const og = html.match(
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']*)["']/i,
  );
  if (og?.[1]) return decodeEntities(og[1]);
  const vj = html.match(/"video_url"\s*:\s*"([^"]+)"/);
  return vj?.[1] ? decodeEntities(vj[1].replace(/\\u0026/g, "&")) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\n/g, "\n");
}

// Fetches and parses a reel. Never throws for a parse miss — returns whatever
// it could get. Only a hard network failure propagates, so the caller can mark
// the reel `partial` and offer a retry.
export async function fetchReel(url: string): Promise<FetchedReel> {
  const html = await fetchHtml(url);
  return {
    caption: extractCaption(html),
    thumbnailUrl: extractThumbnail(html),
    videoUrl: extractVideoUrl(html),
  };
}

export { PARSER_VERSION };
