// Finds the Instagram reel/post link in whatever text the share sheet hands us.
const LINK = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:share\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)/i;

export function extractReelUrl(text: string): { url: string; shortcode: string } | null {
  const m = LINK.exec(text);
  if (!m) return null;
  const kind = m[1].toLowerCase() === "p" ? "p" : "reel";
  const shortcode = m[2];
  return { url: `https://www.instagram.com/${kind}/${shortcode}/`, shortcode };
}

/** "https://www.instagram.com/reel/C8xYz12/" → "instagram.com/reel/C8xYz12" */
export function displayLink(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}
