import { CATEGORIES, type Save } from "../api/contract";

/**
 * The demo's example searches, shown on Home's search field and in an empty Search. Each one
 * finds the card named in `searchExamples.test.ts` in demo mode, so trying one never comes back
 * empty. Lowercase, plain US English, 22 characters at most so a chip (and Home's field, after
 * "Search") never clips on a 375 pt phone.
 *
 * Only the demo and Home's rotating hint use this list as is. In the live app the chips come
 * from the person's own saves (`examplesFromSaves`): these strings would find nothing there.
 */
export const SEARCH_EXAMPLES: readonly string[] = [
  "momo place in queens",
  "reading room cafe",
  "pour over at home",
  "rainier itinerary",
  "desk back stretch",
  "github search tricks",
  "junior dev jobs",
  "linen outfits",
];

/** The longest example, in characters. */
export const MAX_EXAMPLE_LENGTH = 22;
/** Fewer examples than this is no row of chips. */
export const MIN_EXAMPLES = 3;
const MAX_EXAMPLES = 6;

/**
 * Example searches built from what this person saved, so every chip is a search that finds
 * something of theirs: their own short notes (the strongest thing search reads) and the
 * categories they have saves in, taken in turn. Three at the least, six at the most, none longer
 * than 22 characters; an empty list when the library is too small to suggest anything.
 * (Creators and places are not offered: search does not read a creator, and the list of saves
 * does not carry places.)
 */
export function examplesFromSaves(saves: readonly Save[]): string[] {
  const ready = saves.filter((s) => s.status !== "pending");
  const notes = [...ready]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((s) => s.note?.replace(/\s+/g, " ").trim() ?? "")
    .filter((n) => n.length >= 3 && n.length <= MAX_EXAMPLE_LENGTH);
  const present = new Set(ready.map((s) => s.category));
  const categories = CATEGORIES.filter((c) => present.has(c)).map((c) => c.toLowerCase());

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (q: string | undefined) => {
    if (!q || seen.has(q.toLowerCase())) return;
    seen.add(q.toLowerCase());
    out.push(q);
  };
  for (let i = 0; out.length < MAX_EXAMPLES && (i < notes.length || i < categories.length); i++) {
    add(notes[i]);
    if (out.length < MAX_EXAMPLES) add(categories[i]);
  }
  return out.length >= MIN_EXAMPLES ? out : [];
}
