import { createMemoryStore } from "../../test/memoryStore";
import { loadRecent, pushRecent } from "../recent";

test("recent searches are trimmed, deduped case-insensitively, newest first", async () => {
  const store = createMemoryStore();
  await pushRecent(store, "momo");
  await pushRecent(store, "Momo ");
  expect(await pushRecent(store, "manali")).toEqual(["manali", "Momo"]);
  expect(await loadRecent(store)).toEqual(["manali", "Momo"]);
});

test("only the last five are kept and blanks are ignored", async () => {
  const store = createMemoryStore();
  for (const q of ["a", "b", "c", "d", "e", "f", "g", "   "]) await pushRecent(store, q);
  expect(await loadRecent(store)).toEqual(["g", "f", "e", "d", "c"]);
});
