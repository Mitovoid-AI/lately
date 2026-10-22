import type { SaveDetail, SearchHit } from "../api/contract";

// Weights per field: the user's own note is the strongest signal.
const WEIGHT = { note: 3, title: 2, place: 2, tag: 1, caption: 1, creator: 1, link: 1 };

function has(text: string | null | undefined, term: string): boolean {
  return !!text && text.toLowerCase().includes(term);
}

// Words that carry no meaning in a "what do I remember" query ("that cafe reel").
const STOP_WORDS = new Set([
  "a", "an", "and", "about", "at", "by", "for", "from", "i", "in", "is", "it", "me", "my", "of", "on", "or",
  "saved", "some", "that", "the", "this", "those", "to", "was", "with", "reel", "reels", "video", "one",
]);

/** Query → search terms: lower-cased words minus stop words (all of them if nothing else is left). */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));
  return meaningful.length ? meaningful : words;
}

export type WhyKind = "place" | "note" | "meaning" | "title" | "tag" | "caption" | "creator" | "text";

/** One "why it matched" chip, ready to draw: the kind picks the icon, `text` is the label. */
export interface WhyChip {
  kind: WhyKind;
  text: string;
}

/** The longest a chip label gets; longer ones end in an ellipsis. */
const WHY_MAX = 36;

function clip(text: string, max = WHY_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * One `why` string from the API or the local matcher, as a chip. Both sources share a format
 * (the server's starts a place with a pin and a note with `your note:`), so the screen never
 * shows an emoji or a raw prefix: the pin becomes a place icon, the prefixes become words.
 */
export function parseWhy(raw: string): WhyChip | null {
  const s = raw.trim();
  if (!s) return null;
  const place = /^\u{1F4CD}\s*/u.exec(s);
  if (place) {
    const name = s.slice(place[0].length).trim();
    return name ? { kind: "place", text: clip(name) } : null;
  }
  const note = /^your note:\s*/i.exec(s);
  if (note) {
    const inner = s.slice(note[0].length).replace(/^["“”]+|["“”]+$/g, "").trim();
    return inner ? { kind: "note", text: `Your note: “${clip(inner, WHY_MAX - 12)}”` } : null;
  }
  if (/^similar meaning$/i.test(s)) return { kind: "meaning", text: "Similar meaning" };
  const title = /^title:\s*/i.exec(s);
  if (title) return { kind: "title", text: clip(`Title: ${s.slice(title[0].length)}`) };
  const caption = /^caption:\s*/i.exec(s);
  if (caption) return { kind: "caption", text: clip(`Caption: ${s.slice(caption[0].length)}`) };
  if (s.startsWith("#")) return { kind: "tag", text: clip(s) };
  if (s.startsWith("@")) return { kind: "creator", text: clip(s) };
  return { kind: "text", text: clip(s) };
}

/** The first `max` distinct reasons, in the order the matcher found them (strongest first). */
export function whyChips(why: readonly string[], max = 3): WhyChip[] {
  const out: WhyChip[] = [];
  for (const raw of why) {
    const chip = parseWhy(raw);
    if (chip && !out.some((c) => c.text === chip.text)) out.push(chip);
    if (out.length === max) break;
  }
  return out;
}

/**
 * Local search: a card matches when any term appears in some field (plain substring match,
 * no RegExp built from input). Cards matching more of the query rank first (the whole query
 * as a phrase beats every term separately), then by field weight, newest first on ties. Each
 * hit carries human-readable "why it matched" chips.
 */
export function matchSaves(saves: SaveDetail[], query: string): SearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const phrase = query.toLowerCase().trim().replace(/\s+/g, " ");

  const scored: { hit: SearchHit; score: number; at: number }[] = [];
  for (const s of saves) {
    const placeText = (p: SaveDetail["places"][number]) => `${p.name} ${p.address}`;
    const hitsTerm = (t: string) =>
      has(s.note, t) ||
      has(s.title, t) ||
      s.places.some((p) => has(placeText(p), t)) ||
      (s.tags ?? []).some((tag) => has(tag, t)) ||
      has(s.caption, t) ||
      has(s.creator, t) ||
      has(s.source_url, t);
    const matched = terms.filter(hitsTerm).length;
    if (matched === 0) continue;
    const asPhrase = [s.note, s.title, s.caption].some((f) => has(f, phrase));

    const why: string[] = [];
    let score = (matched + (asPhrase ? terms.length : 0)) * 100;
    if (terms.some((t) => has(s.note, t))) {
      score += WEIGHT.note;
      why.push(`your note: “${s.note}”`);
    }
    const titleTerm = terms.find((t) => has(s.title, t));
    if (titleTerm) {
      score += WEIGHT.title;
      why.push(`title: ${titleTerm}`);
    }
    const place = s.places.find((p) => terms.some((t) => has(placeText(p), t)));
    if (place) {
      score += WEIGHT.place;
      why.push(`📍 ${place.name}`);
    }
    const tag = (s.tags ?? []).find((g) => terms.some((t) => has(g, t)));
    if (tag) {
      score += WEIGHT.tag;
      why.push(`#${tag}`);
    }
    const captionTerm = terms.find((t) => has(s.caption, t));
    if (captionTerm) {
      score += WEIGHT.caption;
      why.push(`caption: ${captionTerm}`);
    }
    if (terms.some((t) => has(s.creator, t))) {
      score += WEIGHT.creator;
      why.push(`@${s.creator}`);
    }
    if (terms.some((t) => has(s.source_url, t))) score += WEIGHT.link;

    scored.push({ hit: { save: s, why }, score, at: Date.parse(s.created_at) });
  }
  scored.sort((a, b) => b.score - a.score || b.at - a.at);
  return scored.map((x) => x.hit);
}
