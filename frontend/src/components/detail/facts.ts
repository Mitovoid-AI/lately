import type { Place, SaveDetail } from "../../api/contract";

export type FactKind = "place" | "price" | "tip";

/** One glanceable fact shown as a chip under a card's title. */
export interface Fact {
  kind: FactKind;
  text: string;
}

/** A currency symbol straight before a number: "$15 for two", "€12", "£8", "₹150". */
const PRICE = /[$€£₹]\s?\d/;
/** Chips stay one short line; longer text is clipped (the full step is still in the list below). */
const MAX_FACT = 30;

function clip(text: string, max = MAX_FACT): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The part of a long step that carries the price: "Tickets are $15 for two, cash only" → "$15 for two". */
function priceText(step: string): string {
  if (step.length <= MAX_FACT) return step;
  const at = PRICE.exec(step)?.index ?? 0;
  const tail = step.slice(at);
  const stop = tail.search(/[,;:.](\s|$)/);
  return clip(stop > 3 ? tail.slice(0, stop) : tail);
}

/**
 * Up to three facts for the top of a card, in this order: the first place's name, the first
 * step that looks like a price, and the first short tip (a step that is not the price).
 * Cards with no place and no short steps simply have none.
 */
export function deriveFacts(card: Pick<SaveDetail, "places" | "steps">): Fact[] {
  const facts: Fact[] = [];
  const place = card.places[0]?.name?.trim();
  if (place) facts.push({ kind: "place", text: clip(place) });

  const steps = (card.steps ?? []).map((s) => s.trim()).filter(Boolean);
  const priceAt = steps.findIndex((s) => PRICE.test(s));
  if (priceAt >= 0) facts.push({ kind: "price", text: priceText(steps[priceAt]) });
  const tip = steps.find((s, i) => i !== priceAt && s.length <= MAX_FACT);
  if (tip) facts.push({ kind: "tip", text: tip });
  return facts.slice(0, 3);
}

/**
 * The steps still worth listing under "Tips": the ones a chip does not already show whole. A step
 * that became a chip word for word (a short tip, a short price) is left out; one the chip only
 * quotes part of ("Tickets are $15 for two, cash only" as "$15 for two") stays, because the list
 * has the rest.
 */
export function stepsBeyondFacts(steps: readonly string[] | null | undefined, facts: readonly Fact[]): string[] {
  const shown = new Set(facts.filter((f) => f.kind !== "place").map((f) => f.text));
  return (steps ?? []).filter((step) => !shown.has(step.trim()));
}

/** Where Directions goes: the place's own maps link, else a maps search for its name and address. */
export function mapsUrl(place: Place): string {
  return (
    place.maps_url ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name}, ${place.address}`)}`
  );
}
