import { countOf } from "../counts";

test("one is singular, everything else plural", () => {
  expect(countOf(1, "reel")).toBe("1 reel");
  expect(countOf(0, "reel")).toBe("0 reels");
  expect(countOf(13, "Saved Reel")).toBe("13 Saved Reels");
  expect(countOf(1, "Collection")).toBe("1 Collection");
  expect(countOf(2, "story", "stories")).toBe("2 stories");
});
