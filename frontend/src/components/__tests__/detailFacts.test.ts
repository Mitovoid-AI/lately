import type { Place, SaveDetail } from "../../api/contract";
import { deriveFacts, mapsUrl } from "../detail/facts";
import { pushedOnStack } from "../search/pushedOnStack";

const card = (over: Partial<Pick<SaveDetail, "places" | "steps">>) => ({ places: [], steps: null, ...over });
const place = (over: Partial<Place> = {}): Place => ({
  name: "Joe's Pizza",
  address: "7 Carmine St, New York",
  maps_url: null,
  ...over,
});

describe("deriveFacts", () => {
  test("the first place, the first price-like step and the first short tip, in that order", () => {
    const facts = deriveFacts(
      card({
        places: [place(), place({ name: "Second place" })],
        steps: ["Cash only", "$15 for two", "Go before noon"],
      }),
    );
    expect(facts).toEqual([
      { kind: "place", text: "Joe's Pizza" },
      { kind: "price", text: "$15 for two" },
      { kind: "tip", text: "Cash only" },
    ]);
  });

  test("a price step is never also the tip", () => {
    const facts = deriveFacts(card({ steps: ["About $12 a head"] }));
    expect(facts).toEqual([{ kind: "price", text: "About $12 a head" }]);
  });

  test("a long price step is cut down to the part with the price", () => {
    const facts = deriveFacts(card({ steps: ["Tickets are $15 for two, and the line is long on weekends"] }));
    expect(facts).toEqual([{ kind: "price", text: "$15 for two" }]);
  });

  test("steps too long for a chip are not tips", () => {
    expect(deriveFacts(card({ steps: ["Search with stars:>500 pushed:>2026-01-01 and topic:job-search"] }))).toEqual([]);
  });

  test("a card with no place and no steps has no facts", () => {
    expect(deriveFacts(card({}))).toEqual([]);
    expect(deriveFacts(card({ steps: ["", "  "] }))).toEqual([]);
  });

  test("at most three, and long place names are clipped", () => {
    const facts = deriveFacts(
      card({
        places: [place({ name: "The Extraordinarily Long Named Dumpling Kitchen" })],
        steps: ["$9 lunch", "Try the soup", "Ask for chili oil"],
      }),
    );
    expect(facts).toHaveLength(3);
    expect(facts[0].text.length).toBeLessThanOrEqual(30);
    expect(facts[0].text.endsWith("…")).toBe(true);
  });
});

describe("mapsUrl", () => {
  test("uses the place's own maps link", () => {
    expect(mapsUrl(place({ maps_url: "https://maps.app.goo.gl/abc" }))).toBe("https://maps.app.goo.gl/abc");
  });

  test("otherwise searches maps for the name and address", () => {
    expect(mapsUrl(place())).toBe(
      "https://www.google.com/maps/search/?api=1&query=Joe's%20Pizza%2C%207%20Carmine%20St%2C%20New%20York",
    );
  });

  test("an empty link counts as none", () => {
    expect(mapsUrl(place({ maps_url: "" }))).toContain("google.com/maps/search");
  });
});

describe("pushedOnStack", () => {
  const stack = (index: number, parent?: object) => ({
    getState: () => ({ type: "stack", index }),
    getParent: () => parent as never,
  });
  const tabs = (parent?: object) => ({
    getState: () => ({ type: "tab", index: 1 }),
    getParent: () => parent as never,
  });

  test("a tab on the root of the stack has nowhere to go back to", () => {
    expect(pushedOnStack(tabs(stack(0)))).toBe(false);
  });

  test("a tab pushed over another screen can go back", () => {
    expect(pushedOnStack(tabs(stack(2)))).toBe(true);
  });

  test("a screen directly in a stack looks at its own stack", () => {
    expect(pushedOnStack(stack(1))).toBe(true);
    expect(pushedOnStack(stack(0))).toBe(false);
  });

  test("with no navigator at all there is no Back", () => {
    expect(pushedOnStack(undefined)).toBe(false);
    expect(pushedOnStack({})).toBe(false);
  });
});
