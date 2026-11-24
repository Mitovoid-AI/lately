// Finds the Instagram reel/post link in whatever text the share sheet hands us.
//
// The one rule for which links Lately saves, the same as the server's (backend/app/urls.py
// SAVEABLE_URL; change both together): a reel or post (/reel|reels|p|tv/<code>, or the permalink
// /<username>/reel|p|tv/<code>) or a /share/ short link, with or without https://. Any other
// Instagram page (a profile, story or audio page) is not a reel or post.

// An instagram.com link. The host must stand on its own: not part of a longer name
// (notinstagram.com, m.instagram.com) or of another URL's path (evil.com/instagram.com/...).
// Group 1 is everything after the host.
const INSTAGRAM = /(?:^|[^\w.@/-])(?:https?:\/\/)?(?:www\.)?instagram\.com(?![\w.-])([^\s"'<>]*)/gi;
// The path of a link Lately saves. Group 1 is the kind (with the username of a permalink), 2 the
// shortcode; 3 is the path of a /share/ link, which only the server can resolve to a reel.
const SAVEABLE =
  /^\/(?:(reel|reels|p|tv|(?!share\/)[A-Za-z0-9._]{1,30}\/(?:reel|p|tv))\/(?!audio(?:[^A-Za-z0-9_-]|$))([A-Za-z0-9_-]+)|share\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?))/i;

export type InstagramLink =
  /** A reel or post: its canonical link (tracking params dropped) and its shortcode. */
  | { kind: "reel"; url: string; shortcode: string }
  /** A /share/ short link: the server finds out which reel it is. */
  | { kind: "share"; url: string; shortcode: null }
  /** Any other Instagram page (profile, story, audio): not something Lately saves. */
  | { kind: "not_reel"; url: string; shortcode: null };

/**
 * What the text links to, the way the server reads it: the first reel, post or /share/ link wins;
 * with none, the first Instagram link is `not_reel`; with no Instagram link at all, null.
 */
export function readInstagramLink(text: string): InstagramLink | null {
  const re = new RegExp(INSTAGRAM.source, "gi");
  let other: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const path = m[1];
    const s = SAVEABLE.exec(path);
    if (s?.[3]) return { kind: "share", url: `https://www.instagram.com/share/${s[3]}`, shortcode: null };
    if (s) {
      const kind = s[1].split("/").pop()?.toLowerCase() === "p" ? "p" : "reel";
      return { kind: "reel", url: `https://www.instagram.com/${kind}/${s[2]}/`, shortcode: s[2] };
    }
    other ??= `https://www.instagram.com${path.split(/[?#]/)[0]}`;
  }
  return other === null ? null : { kind: "not_reel", url: other, shortcode: null };
}

/** The reel or post link in the text (by the rule above), with its shortcode; null for anything else, a /share/ link included. */
export function extractReelUrl(text: string): { url: string; shortcode: string } | null {
  const link = readInstagramLink(text);
  return link?.kind === "reel" ? { url: link.url, shortcode: link.shortcode } : null;
}

/** "https://www.instagram.com/reel/C8xYz12/" → "instagram.com/reel/C8xYz12" */
export function displayLink(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}
