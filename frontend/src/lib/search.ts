import type { SaveDetail, SearchHit } from "../api/contract";

// Weights per field: the user's own note is the strongest signal.
const WEIGHT = { note: 3, title: 2, place: 2, tag: 1, caption: 1, creator: 1, link: 1 };

function has(text: string | null | undefined, term: string): boolean {
  return !!text && text.toLowerCase().includes(term);
}

/**
 * Local search: every term must appear in some field (plain substring match,
 * no RegExp built from input). Returns hits ranked by field weight, newest first
 * on ties, each with human-readable "why it matched" chips.
 */
export function matchSaves(saves: SaveDetail[], query: string): SearchHit[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

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
    if (!terms.every(hitsTerm)) continue;

    const why: string[] = [];
    let score = 0;
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
