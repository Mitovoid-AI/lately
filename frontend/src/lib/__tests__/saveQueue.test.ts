import { ApiError, type LatelyApi, type SaveResult } from "../../api/contract";
import { createMemoryStore } from "../../test/memoryStore";
import { dequeueSave, enqueueSave, flushQueue, queueKey, readQueue } from "../saveQueue";

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
  expect(r.rejected.map((d) => [d.item.text, d.code])).toEqual([["bad", "BAD_URL"]]);
  expect(r.saved).toHaveLength(1);
  expect(await readQueue(store, KEY)).toEqual([]);
});

test("a save the server rejects never blocks the ones behind it (issue #9)", async () => {
  const store = createMemoryStore();
  for (const [i, t] of ["invalid", "huge", "gone", "good"].entries()) await enqueueSave(store, KEY, t, i);
  const codes = { invalid: ["BAD_REQUEST", 422], huge: ["TOO_LARGE", 413], gone: ["NOT_FOUND", 404] } as const;
  const api = apiWith(async (t) => {
    const c = codes[t as keyof typeof codes];
    return c ? Promise.reject(new ApiError(c[0], c[1])) : ok("r1");
  });
  const r = await flushQueue(store, KEY, api);
  expect(api.createSave.mock.calls.map((c) => c[0])).toEqual(["invalid", "huge", "gone", "good"]);
  const rejected = [
    ["invalid", "BAD_REQUEST"],
    ["huge", "TOO_LARGE"],
    ["gone", "NOT_FOUND"],
  ];
  expect(r.rejected.map((d) => [d.item.text, d.code])).toEqual(rejected);
  expect(r.dropped.map((d) => [d.item.text, d.code])).toEqual(rejected);
  expect(r.saved.map((s) => s.item.text)).toEqual(["good"]);
  expect(r.remaining).toEqual([]);
  expect(await readQueue(store, KEY)).toEqual([]);
});

test("the monthly quota drops a save but is not a rejection", async () => {
  const store = createMemoryStore();
  await enqueueSave(store, KEY, "a", 1);
  await enqueueSave(store, KEY, "b", 2);
  const api = apiWith(async () => Promise.reject(new ApiError("QUOTA_EXCEEDED", 429)));
  const r = await flushQueue(store, KEY, api);
  expect(r.dropped.map((d) => d.code)).toEqual(["QUOTA_EXCEEDED", "QUOTA_EXCEEDED"]);
  expect(r.rejected).toEqual([]);
  expect(r.remaining).toEqual([]);
});

test.each([
  ["RATE_LIMITED", 429],
  ["UNAUTHORIZED", 401],
  ["NETWORK", 0],
  ["SERVER", 503],
] as const)("%s stops the flush and keeps everything queued", async (code, status) => {
  const store = createMemoryStore();
  await enqueueSave(store, KEY, "a", 1);
  await enqueueSave(store, KEY, "b", 2);
  const api = apiWith(async () => Promise.reject(new ApiError(code, status)));
  const r = await flushQueue(store, KEY, api);
  expect(api.createSave).toHaveBeenCalledTimes(1);
  expect([r.saved, r.dropped, r.rejected]).toEqual([[], [], []]);
  expect(r.remaining.map((q) => q.text)).toEqual(["a", "b"]);
  expect((await readQueue(store, KEY)).map((q) => q.text)).toEqual(["a", "b"]);
});

test("a deduped save counts as done", async () => {
  const store = createMemoryStore();
  await enqueueSave(store, KEY, "a", 1);
  const api = apiWith(async () => ({ reel_id: "r1", deduped: true, status: "enriched" }));
  expect((await flushQueue(store, KEY, api)).remaining).toEqual([]);
});

/** A store whose reads and writes take a few ticks, like AsyncStorage, so calls can interleave. */
function slowStore() {
  const inner = createMemoryStore();
  const ticks = () => new Promise((r) => setTimeout(r, 5));
  return {
    async getItem(k: string) {
      await ticks();
      return inner.getItem(k);
    },
    async setItem(k: string, v: string) {
      await ticks();
      return inner.setItem(k, v);
    },
  };
}

test("saves queued at the same moment are all kept (writes are serialized)", async () => {
  const store = slowStore();
  await Promise.all([enqueueSave(store, KEY, "a", 1), enqueueSave(store, KEY, "b", 2), enqueueSave(store, KEY, "c", 3)]);
  expect((await readQueue(store, KEY)).map((q) => q.text).sort()).toEqual(["a", "b", "c"]);
});

test("a save queued while another is dequeued is kept", async () => {
  const store = slowStore();
  await enqueueSave(store, KEY, "a", 1);
  await Promise.all([dequeueSave(store, KEY, "a"), enqueueSave(store, KEY, "b", 2)]);
  expect((await readQueue(store, KEY)).map((q) => q.text)).toEqual(["b"]);
});

test("a save queued while the queue is flushing is kept", async () => {
  const store = slowStore();
  await enqueueSave(store, KEY, "a", 1);
  const api = apiWith(async () => ok("r1"));
  await Promise.all([flushQueue(store, KEY, api), enqueueSave(store, KEY, "b", 2)]);
  const left = (await readQueue(store, KEY)).map((q) => q.text);
  expect(left).toContain("b");
  expect(left).not.toContain("a");
});

test("a corrupt queue reads as empty", async () => {
  const store = createMemoryStore({ [KEY]: "{nope" });
  expect(await readQueue(store, KEY)).toEqual([]);
});
