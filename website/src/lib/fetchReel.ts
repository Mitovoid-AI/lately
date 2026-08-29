// Fetches an Instagram reel's public page and extracts caption / thumbnail /
// video URL.
//
// IMPORTANT CAVEAT (PLAN.md §0): Instagram blocks datacenter IPs. Running this
// from a laptop on a home connection usually works, which is exactly why we are
// testing locally first. It will NOT reliably work from a cloud host, and the
// production path remains on-device fetching from the mobile app.
//
// Every extractor is best-effort: Instagram changes its HTML without notice, so
// we degrade to caption-only (or empty) rather than throwing.

export type FetchedReel = {
  caption: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
};

export const PARSER_VERSION = 1;

const UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

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

function metaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re);
  return m?.[1] ? decodeEntities(m[1]) : null;
}

function extractCaption(html: string): string {
  const og = metaContent(html, "og:description");
  if (og) return og;
  const cap = html.match(/"caption"\s*:\s*"([^"]{0,4000})"/);
  return cap?.[1] ? decodeEntities(cap[1]) : "";
}

function extractVideoUrl(html: string): string | null {
  const og = metaContent(html, "og:video");
  if (og) return og;
  const vj = html.match(/"video_url"\s*:\s*"([^"]+)"/);
  return vj?.[1] ? decodeEntities(vj[1]) : null;
}

export async function fetchReel(url: string): Promise<FetchedReel> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`Instagram fetch ${res.status}`);
  const html = await res.text();
  return {
    caption: extractCaption(html),
    thumbnailUrl: metaContent(html, "og:image"),
    videoUrl: extractVideoUrl(html),
  };
}
