import { createDemoApi } from "../../api/demo";
import type { Save } from "../../api/contract";
import { NOW } from "../../test/fixtures";
import { createMemoryStore } from "../../test/memoryStore";
import { examplesFromSaves, MAX_EXAMPLE_LENGTH, MIN_EXAMPLES, SEARCH_EXAMPLES } from "../searchExamples";

/** The demo card each example search is meant to surface first. */
const EXPECTED_TOP: Record<string, string> = {
  "momo place in queens": "s-momo",
  "reading room cafe": "s-espresso",
  "pour over at home": "s-drip",
  "rainier itinerary": "s-manali",
  "desk back stretch": "s-yoga",
  "github search tricks": "s-github",
  "junior dev jobs": "s-visa",
  "linen outfits": "s-linen",
};

test("every example search has a card named for it, and none is missing", () => {
  expect(Object.keys(EXPECTED_TOP).sort()).toEqual([...SEARCH_EXAMPLES].sort());
});

test("examples are lowercase, short, never clipped on a phone and free of em dashes", () => {
  for (const q of SEARCH_EXAMPLES) {
    expect(q).toBe(q.toLowerCase());
    expect(q).not.toContain("—");
    expect(q.split(" ").length).toBeLessThanOrEqual(6);
    // 22 characters still fit Home's field after the word "Search" at 375 pt.
    expect(q.length).toBeLessThanOrEqual(MAX_EXAMPLE_LENGTH);
  }
});

test("each example finds its card first in the demo library", async () => {
  const api = createDemoApi({ now: () => NOW, storage: createMemoryStore() });
  for (const q of SEARCH_EXAMPLES) {
    const hits = await api.search(q);
    expect({ q, top: hits[0]?.save.id }).toEqual({ q, top: EXPECTED_TOP[q] });
  }
});

describe("examples from a person's own saves (the live app)", () => {
  let n = 0;
  function save(over: Partial<Save> = {}): Save {
    n += 1;
    return {
      id: `s${n}`,
      source_url: `https://www.instagram.com/reel/R${n}/`,
      shortcode: `R${n}`,
      status: "enriched",
      note: null,
      created_at: new Date(NOW - n * 3_600_000).toISOString(),
      title: `Title ${n}`,
      caption: null,
      category: null,
      thumbnail_url: null,
      creator: "someone",
      channel: "app_share",
      ...over,
    };
  }

  test("takes their short notes and the categories they have saves in, in turn", () => {
    const out = examplesFromSaves([
      save({ note: "dinner to try", category: "Food & Places" }),
      save({ note: "hike in june", category: "Fitness" }),
      save({ note: null, category: "Dev & Tools" }),
    ]);
    expect(out).toEqual(["dinner to try", "dev & tools", "hike in june", "food & places", "fitness"]);
  });

  test("every chip is 22 characters or fewer: a long note is not offered", () => {
    const out = examplesFromSaves([
      save({ note: "a note that goes on far past the limit", category: "Food & Places" }),
      save({ note: "short note", category: "Fitness" }),
      save({ note: "another one", category: "Dev & Tools" }),
    ]);
    expect(out.every((q) => q.length <= MAX_EXAMPLE_LENGTH)).toBe(true);
    expect(out).not.toContain("a note that goes on far past the limit");
    expect(out).toContain("short note");
  });

  test("a note being written (pending) is not used, a repeat is offered once, six at most", () => {
    const out = examplesFromSaves([
      save({ note: "pending note", status: "pending" }),
      save({ note: "Same note" }),
      save({ note: "same note" }),
      save({ note: "note three" }),
      save({ note: "note four" }),
      save({ note: "note five" }),
      save({ note: "note six" }),
      save({ note: "note seven" }),
    ]);
    expect(out).not.toContain("pending note");
    expect(out.filter((q) => q.toLowerCase() === "same note")).toHaveLength(1);
    expect(out).toHaveLength(6);
  });

  test("fewer than three is no chips at all: a library this small has nothing to suggest", () => {
    expect(examplesFromSaves([])).toEqual([]);
    expect(examplesFromSaves([save({ note: "only one", category: null })])).toEqual([]);
    const two = examplesFromSaves([save({ note: "first", category: null }), save({ note: "second", category: null })]);
    expect(two).toEqual([]);
    expect(MIN_EXAMPLES).toBe(3);
  });

  test("the demo library is rich enough to suggest something", async () => {
    const api = createDemoApi({ now: () => NOW, storage: createMemoryStore() });
    const out = examplesFromSaves(await api.listSaves({ limit: 100 }));
    expect(out.length).toBeGreaterThanOrEqual(MIN_EXAMPLES);
  });
});
