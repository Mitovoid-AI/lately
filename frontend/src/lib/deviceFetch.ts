// Device-side fetch (PIPELINE.md §5 FETCH "on-device data", §8 trust rule).
//
// Instagram blocks data-centre IPs, so the cloud worker often can't read a reel. The phone can:
// right after a save, it reads the reel's public embed page itself, parses it (a port of
// backend/app/enrich/fetch.py `parse_embed_page`) and posts what it found to
// POST /saves/{id}/hint. The server validates it again and only trusts it for this user's save.
// Fire-and-forget: short timeout, never throws, never blocks the save sheet.
import type { DeviceHint, LatelyApi, SaveResult } from "../api/contract";
import { extractReelUrl } from "./instagram";

/** Same desktop-iframe navigation headers the backend's EmbedPageProvider sends. */
export const EMBED_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "iframe",
  "Sec-Fetch-Mode": "navigate",
};

export const HINT_TIMEOUT_MS = 6000;
const CAPTION_MAX = 5000;
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export const embedUrl = (shortcode: string) => `https://www.instagram.com/p/${shortcode}/embed/captioned/`;

// ------------------------------------------------------------------ parsing --

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);?/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? m;
  });
}

function attrsOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

const classes = (a: Record<string, string>) => new Set((a.class ?? "").split(/\s+/).filter(Boolean));

/** The embed page's caption (minus the username and comments link), handle and thumbnail. */
function parseMarkup(html: string) {
  let handle: string | null = null;
  let thumbnail: string | null = null;
  const caption: string[] = [];
  let divs = 0;
  let captionAt: number | null = null; // div depth of div.Caption; -1 once closed
  let skipAt: number | null = null; // div depth of div.CaptionComments
  let inCaptionUser = false;
  let inUsername = false;
  const capturing = () => captionAt !== null && captionAt > 0 && skipAt === null && !inCaptionUser;

  const token = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html))) {
    const [, closing, rawTag, rawAttrs, text] = m;
    if (text !== undefined) {
      const data = decodeEntities(text);
      if (inCaptionUser || inUsername) {
        handle = handle ?? (data.trim() || null);
      } else if (capturing()) {
        caption.push(data);
      }
      continue;
    }
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();
    if (closing) {
      if (tag === "div") {
        if (skipAt === divs) skipAt = null;
        if (captionAt === divs) captionAt = -1;
        divs -= 1;
      } else if (tag === "a") inCaptionUser = false;
      else if (tag === "span") inUsername = false;
      continue;
    }
    if (tag === "script" || tag === "style") {
      // Raw text: skip to the closing tag so "<" inside scripts is not markup.
      const end = html.toLowerCase().indexOf(`</${tag}`, token.lastIndex);
      token.lastIndex = end < 0 ? html.length : end;
      continue;
    }
    const a = attrsOf(rawAttrs ?? "");
    const cls = classes(a);
    if (tag === "div") {
      divs += 1;
      if (cls.has("Caption") && captionAt === null) captionAt = divs;
      else if (cls.has("CaptionComments") && captionAt !== null) skipAt = divs;
    } else if (tag === "a" && cls.has("CaptionUsername")) inCaptionUser = true;
    else if (tag === "span" && cls.has("UsernameText")) inUsername = true;
    else if (tag === "img" && cls.has("EmbeddedMediaImage") && !thumbnail) thumbnail = a.src || null;
    else if (tag === "br" && capturing()) caption.push("\n");
  }

  const lines = caption
    .join("")
    .split("\n")
    .map((l) => l.split(/\s+/).filter(Boolean).join(" "));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { caption: text || null, handle, thumbnail };
}

const VIDEO_URL = /video_url\\*"\s*:\s*\\*"(.*?)\\*"/;
const DURATION = /video_duration\\*"\s*:\s*([0-9.]+)/;

function unescapeJsonUrl(raw: string): string {
  return raw
    .replace(/\\+u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\+\//g, "/")
    .replace(/\\/g, "");
}

/** Hint fields from an embed page, or null if it carries none (login wall, error shell). Fields
 *  the server would refuse are left out (caption is cut to 5000 chars). */
export function parseEmbedPage(html: string): Omit<DeviceHint, "shortcode"> | null {
  const { caption, handle, thumbnail } = parseMarkup(html);
  const video = VIDEO_URL.exec(html);
  const videoUrl = video ? unescapeJsonUrl(video[1]) || null : null;
  const dur = DURATION.exec(html);
  const duration = dur ? Number(dur[1]) : NaN;

  const hint: Omit<DeviceHint, "shortcode"> = {};
  if (caption) hint.caption = caption.slice(0, CAPTION_MAX);
  if (handle && HANDLE.test(handle)) hint.creator_handle = handle;
  if (thumbnail) hint.thumbnail_url = thumbnail;
  if (videoUrl) hint.video_url = videoUrl;
  if (Number.isFinite(duration) && duration >= 0 && duration <= 3600) hint.duration_s = duration;
  return hint.caption || hint.thumbnail_url || hint.video_url ? hint : null;
}

// ------------------------------------------------------------------ fetching --

/** GET the embed page from the device; null on any failure or after `timeoutMs`. */
export async function fetchEmbedHint(
  shortcode: string,
  o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Omit<DeviceHint, "shortcode"> | null> {
  const doFetch = o.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, o.timeoutMs ?? HINT_TIMEOUT_MS);
  });
  const read = (async () => {
    try {
      const res = await doFetch(embedUrl(shortcode), { method: "GET", headers: EMBED_HEADERS, signal: controller.signal });
      if (!res.ok) return null;
      return parseEmbedPage(await res.text());
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type HintOutcome = "sent" | "skipped" | "failed";

/**
 * After a save: read the reel on the device and send it as a hint. Skipped in demo mode, on the
 * web build (no User-Agent control, CORS), for deduped saves, and when the shortcode is unknown
 * (/share/ links resolve on the server). Never rejects.
 */
export async function sendDeviceHint(o: {
  api: Pick<LatelyApi, "sendHint">;
  mode: "demo" | "live";
  platform: string;
  text: string;
  result: SaveResult;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<HintOutcome> {
  try {
    if (o.mode !== "live" || o.platform === "web" || o.result.deduped) return "skipped";
    if (/instagram\.com\/share\//i.test(o.text)) return "skipped";
    const link = extractReelUrl(o.text);
    if (!link) return "skipped";
    const hint = await fetchEmbedHint(link.shortcode, { fetchImpl: o.fetchImpl, timeoutMs: o.timeoutMs });
    if (!hint) return "failed";
    await o.api.sendHint(o.result.reel_id, { ...hint, shortcode: link.shortcode });
    return "sent";
  } catch {
    return "failed";
  }
}
