import { buildDemoSeed } from "../../api/demo-data";
import { NOW } from "../../test/fixtures";
import { matchSaves } from "../search";

const saves = buildDemoSeed(NOW).saves;
const MOMO = "Hole-in-the-wall momo spot in Koramangala";

test("finds the momo card by a word in its title and tags", () => {
  const hits = matchSaves(saves, "momo");
  expect(hits[0].save.title).toBe(MOMO);
  expect(hits[0].why).toContain("#momos");
});

test("a match on the user's note ranks first and is explained first", () => {
  const hits = matchSaves(saves, "cafe to try");
  expect(hits[0].save.title).toBe(MOMO);
  expect(hits[0].why[0]).toBe("your note: “cafe to try”");
});

test("a place match is explained with the place name", () => {
  expect(matchSaves(saves, "koramangala")[0].why).toContain("📍 Momo Point");
});

test("regex metacharacters are treated as plain text", () => {
  expect(() => matchSaves(saves, "c++(")).not.toThrow();
  expect(matchSaves(saves, "c++(")).toEqual([]);
});

test("a blank query matches nothing", () => {
  expect(matchSaves(saves, "   ")).toEqual([]);
});
