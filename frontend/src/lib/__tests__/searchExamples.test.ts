import { createDemoApi } from "../../api/demo";
import { NOW } from "../../test/fixtures";
import { createMemoryStore } from "../../test/memoryStore";
import { SEARCH_EXAMPLES } from "../searchExamples";

/** The demo card each example search is meant to surface first. */
const EXPECTED_TOP: Record<string, string> = {
  "momo place in queens": "s-momo",
  "coffee bar with a reading room": "s-espresso",
  "pour over at home": "s-drip",
  "mount rainier itinerary": "s-manali",
  "desk back stretch": "s-yoga",
  "github search tricks": "s-github",
  "remote jobs for junior devs": "s-visa",
  "linen outfits": "s-linen",
};

test("every example search has a card named for it, and none is missing", () => {
  expect(Object.keys(EXPECTED_TOP).sort()).toEqual([...SEARCH_EXAMPLES].sort());
});

test("examples are lowercase, short and free of em dashes", () => {
  for (const q of SEARCH_EXAMPLES) {
    expect(q).toBe(q.toLowerCase());
    expect(q).not.toContain("—");
    expect(q.split(" ").length).toBeLessThanOrEqual(6);
  }
});

test("each example finds its card first in the demo library", async () => {
  const api = createDemoApi({ now: () => NOW, storage: createMemoryStore() });
  for (const q of SEARCH_EXAMPLES) {
    const hits = await api.search(q);
    expect({ q, top: hits[0]?.save.id }).toEqual({ q, top: EXPECTED_TOP[q] });
  }
});
