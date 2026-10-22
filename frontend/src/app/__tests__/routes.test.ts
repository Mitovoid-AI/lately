// Route files decide the paths, so a stray duplicate (a second /search, Curated left in the tabs)
// would make navigation ambiguous. Jest runs in Node; the app's TypeScript config has no Node
// types, so type just what is used.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs") as {
  existsSync(file: string): boolean;
  readFileSync(file: string, encoding: "utf8"): string;
};
const path = require("path") as { join(...parts: string[]): string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

const APP = path.join(__dirname, "..");
const has = (file: string) => fs.existsSync(path.join(APP, file));

test("Search is a tab: one /search route, inside (tabs)", () => {
  expect(has("(tabs)/search.tsx")).toBe(true);
  expect(has("search.tsx")).toBe(false);
});

test("Curated is a stack screen: /curated at the top level, not in (tabs)", () => {
  expect(has("curated.tsx")).toBe(true);
  expect(has("(tabs)/curated.tsx")).toBe(false);
});

test("the tab files are exactly Home, Search, Save, Stacks", () => {
  for (const file of ["index", "search", "save", "stacks"]) expect(has(`(tabs)/${file}.tsx`)).toBe(true);
});

test("the root stack lists Curated and no longer lists a stack-level search", () => {
  const layout = fs.readFileSync(path.join(APP, "_layout.tsx"), "utf8");
  expect(layout).toContain('<Stack.Screen name="curated" />');
  expect(layout).not.toContain('name="search"');
});
