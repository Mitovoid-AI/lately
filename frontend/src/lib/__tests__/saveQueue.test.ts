import { ApiError, type LatelyApi, type SaveResult } from "../../api/contract";
import { createMemoryStore } from "../../test/memoryStore";
import { enqueueSave, flushQueue, queueKey, readQueue } from "../saveQueue";

const KEY = queueKey("u1");
const ok = (id: string): SaveResult => ({ reel_id: id, deduped: false, status: "pending" });

function apiWith(createSave: LatelyApi["createSave"]) {
  return { createSave: jest.fn(createSave) } as unknown as LatelyApi & { createSave: jest.Mock };
}

test("queued saves persist in order and identical text is queued once", async () => {
  const store = createMemoryStore();
  await enqueueSave(store, KEY, "a", 1);
  await enqueueSave(store, KEY, "b", 2);
  await enqueueSave(store, KEY, " a ", 3);
  expect((await readQueue(store, KEY)).map((q) => q.text)).toEqual(["a", "b"]);
});

test("queues are per user", async () => {
  const store = createMemoryStore();
  await enqueueSave(store, queueKey("u1"), "a", 1);
  expect(await readQueue(store, queueKey("u2"))).toEqual([]);
});

test("flush saves everything when online and empties the queue", async () => {
  const store = createMemoryStore();
  await enqueueSave(store, KEY, "a", 1);
  await enqueueSave(store, KEY, "b", 2);
  const api = apiWith(async (t) => ok(`r-${t}`));
  const r = await flushQueue(store, KEY, api);
  expect(api.createSave.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  expect(r.saved).toHaveLength(2);
  expect(r.remaining).toEqual([]);
  expect(await readQueue(store, KEY)).toEqual([]);
});

test("still offline: flush stops at the first network failure and keeps the rest", async () => {
  const store = createMemoryStore();
  await enqueueSave(store, KEY, "a", 1);
  await enqueueSave(store, KEY, "b", 2);
  const api = apiWith(async () => Promise.reject(new ApiError("NETWORK", 0)));
  const r = await flushQueue(store, KEY, api);
  expect(api.createSave).toHaveBeenCalledTimes(1);
  expect(r.remaining.map((q) => q.text)).toEqual(["a", "b"]);
  expect((await readQueue(store, KEY)).length).toBe(2);
});

test("links the server refuses for good are dropped and reported", async () => {
  const store = createMemoryStore();
  await enqueueSave(store, KEY, "bad", 1);
  await enqueueSave(store, KEY, "good", 2);
  const api = apiWith(async (t) => (t === "bad" ? Promise.reject(new ApiError("BAD_URL", 422)) : ok("r1")));
  const r = await flushQueue(store, KEY, api);
  expect(r.dropped.map((d) => [d.item.text, d.code])).toEqual([["bad", "BAD_URL"]]);
  expect(r.saved).toHaveLength(1);
  expect(await readQueue(store, KEY)).toEqual([]);
});

test("a deduped save counts as done", async () => {
  const store = createMemoryStore();
  await enqueueSave(store, KEY, "a", 1);
  const api = apiWith(async () => ({ reel_id: "r1", deduped: true, status: "enriched" }));
  expect((await flushQueue(store, KEY, api)).remaining).toEqual([]);
});

test("a corrupt queue reads as empty", async () => {
  const store = createMemoryStore({ [KEY]: "{nope" });
  expect(await readQueue(store, KEY)).toEqual([]);
});
