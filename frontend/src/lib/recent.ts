import { readJson, writeJson, type KeyValueStore } from "./storage";

const KEY = "lately.recent-searches";
const MAX = 5;

export function loadRecent(store: KeyValueStore): Promise<string[]> {
  return readJson<string[]>(store, KEY, []);
}

/** Adds a query to the front (trimmed, case-insensitive dedupe, last 5 kept). */
export async function pushRecent(store: KeyValueStore, query: string): Promise<string[]> {
  const q = query.trim();
  const current = await loadRecent(store);
  if (!q) return current;
  const next = [q, ...current.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
  await writeJson(store, KEY, next);
  return next;
}
