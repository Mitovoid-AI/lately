// Instagram URL helpers, shared by the bot and the web app.

// Extracts the Instagram shortcode from a shared URL.
// Handles /reel/, /reels/, /p/, /tv/ paths. Returns null for /share/ shortlinks
// that carry no shortcode until resolved.
export function parseShortcode(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const keyed = ["reel", "reels", "p", "tv"];
  const idx = segments.findIndex((s) => keyed.includes(s.toLowerCase()));
  return idx !== -1 && segments[idx + 1] ? segments[idx + 1] : null;
}

// Pulls the first Instagram URL out of arbitrary text (Telegram messages often
// arrive as "some caption https://instagram.com/reel/xxx").
export function extractInstagramUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:www\.)?instagram\.com\/\S+/i);
  return match ? match[0] : null;
}

// True when the text contains any Instagram link we recognise.
export function looksLikeInstagram(text: string): boolean {
  return extractInstagramUrl(text) !== null;
}
