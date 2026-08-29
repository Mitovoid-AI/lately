// Extracts the Instagram shortcode from a shared URL.
// Handles /reel/, /reels/, /p/, /tv/ paths and the newer /share/ shortlinks.
// Returns null when no shortcode is present (e.g. a bare share redirect).
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
  if (idx !== -1 && segments[idx + 1]) {
    return segments[idx + 1];
  }
  return null;
}

// Pulls the first Instagram URL out of arbitrary shared text.
// The Android share sheet often hands over "caption text https://instagram.com/reel/xxx".
export function extractInstagramUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:www\.)?instagram\.com\/\S+/i);
  return match ? match[0] : null;
}
