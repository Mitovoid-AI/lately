import { buildDemoSeed } from "../../api/demo-data";
import type { SaveDetail } from "../../api/contract";
import { NOW } from "../../test/fixtures";
import { matchSaves, parseWhy, whyChips } from "../search";
import { SEARCH_EXAMPLES } from "../searchExamples";

const saves = buildDemoSeed(NOW).saves;
// The demo content is rewritten from time to time, so these tests read what they search for
// from the momo save itself instead of repeating its words here.
const momo = saves.find((s) => s.id === "s-momo")!;

function made(over: Partial<SaveDetail>): SaveDetail {
  return {
    id: "x",
    source_url: "https://www.instagram.com/reel/AbCdEf1/",
    shortcode: null,
    status: "enriched",
    note: null,
    created_at: new Date(NOW).toISOString(),
    title: null,
    caption: null,
    category: null,
    thumbnail_url: null,
    creator: null,
    channel: "app_share",
    summary: null,
    steps: null,
    tags: null,
    places: [],
    media_status: "ready",
    ...over,
  };
}

test("finds the card by one of its tags and explains the tag", () => {
  const tag = momo.tags![0];
  const hit = matchSaves(saves, tag).find((h) => h.save.id === "s-momo");
  expect(hit).toBeDefined();
  expect(hit!.why).toContain(`#${tag}`);
});

test("a match on the user's note ranks first and is explained first", () => {
  const hits = matchSaves(saves, momo.note!);
  expect(hits[0].save.id).toBe("s-momo");
  expect(hits[0].why[0]).toBe(`your note: “${momo.note}”`);
});

test("a place match is explained with the place name", () => {
  const place = momo.places[0];
  const hit = matchSaves(saves, place.name).find((h) => h.save.id === "s-momo");
  expect(hit!.why).toContain(`📍 ${place.name}`);
});

test("regex metacharacters are treated as plain text", () => {
  expect(() => matchSaves(saves, "c++(")).not.toThrow();
  expect(matchSaves(saves, "c++(")).toEqual([]);
});

test("a blank query matches nothing", () => {
  expect(matchSaves(saves, "   ")).toEqual([]);
});

test("every example search finds something in the demo library", () => {
  for (const q of SEARCH_EXAMPLES) {
    expect(matchSaves(saves, q).length).toBeGreaterThan(0);
  }
});

test("cards matching more of the query rank first", () => {
  const one = made({ id: "one", title: "Job board tips" });
  const both = made({ id: "both", title: "Job search spreadsheet", created_at: new Date(NOW - 86_400_000).toISOString() });
  expect(matchSaves([one, both], "job search")[0].save.id).toBe("both");
});

describe("why chips", () => {
  test("the pin and the prefixes become plain words, never an emoji", () => {
    expect(parseWhy("📍 Momo Point")).toEqual({ kind: "place", text: "Momo Point" });
    expect(parseWhy("your note: “cafe to try”")).toEqual({ kind: "note", text: "Your note: “cafe to try”" });
    // The server writes the note in straight quotes.
    expect(parseWhy('your note: "cafe to try"')).toEqual({ kind: "note", text: "Your note: “cafe to try”" });
    expect(parseWhy("similar meaning")).toEqual({ kind: "meaning", text: "Similar meaning" });
    expect(parseWhy("title: momo")).toEqual({ kind: "title", text: "Title: momo" });
    expect(parseWhy("caption: momo")).toEqual({ kind: "caption", text: "Caption: momo" });
    expect(parseWhy("#momos")).toEqual({ kind: "tag", text: "#momos" });
    expect(parseWhy("@bangalorefoodie")).toEqual({ kind: "creator", text: "@bangalorefoodie" });
    expect(parseWhy("   ")).toBeNull();
    expect(parseWhy("📍")).toBeNull();
  });

  test("a long note is clipped so the chip stays short", () => {
    const chip = parseWhy(`your note: “${"a very long reminder ".repeat(6)}”`)!;
    expect(chip.text.length).toBeLessThanOrEqual(40);
    expect(chip.text.endsWith("…”")).toBe(true);
  });

  test("at most three distinct chips, strongest first", () => {
    const chips = whyChips(["your note: “x”", "title: a", "title: a", "📍 Spot", "#tag", "@who"]);
    expect(chips.map((c) => c.kind)).toEqual(["note", "title", "place"]);
    expect(whyChips([])).toEqual([]);
  });
});
