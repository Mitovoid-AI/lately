// Saves made while offline wait on the device and are sent when Lately can reach the API again.
import { ApiError, type ApiErrorCode, type LatelyApi, type SaveResult } from "../api/contract";
import { readJson, writeJson, type KeyValueStore } from "./storage";

export interface QueuedSave {
  id: string;
  text: string;
  queued_at: string;
}

export interface FlushResult {
  saved: { item: QueuedSave; result: SaveResult }[];
  /** Refused for good (no reel link, monthly quota): taken off the queue. */
  dropped: { item: QueuedSave; code: ApiErrorCode }[];
  remaining: QueuedSave[];
}

/** One queue per account, so a different sign-in never sends someone else's links. */
export const queueKey = (userId: string) => `lately.save-queue.${userId}`;

// Retrying cannot fix these; anything else (offline, server down, rate limit) waits for the next try.
const PERMANENT: ApiErrorCode[] = ["BAD_URL", "QUOTA_EXCEEDED"];

export async function readQueue(store: KeyValueStore, key: string): Promise<QueuedSave[]> {
  const items = await readJson<unknown>(store, key, []);
  return Array.isArray(items) ? (items as QueuedSave[]).filter((q) => q && typeof q.text === "string") : [];
}

// Every read-modify-write of a queue runs on one promise chain per key, so a share queued
// while another is queued, dequeued or flushed is never overwritten by a stale copy.
const chains = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
  chains.set(
    key,
    run.catch(() => {}),
  );
  return run;
}

export function enqueueSave(store: KeyValueStore, key: string, text: string, now = Date.now()): Promise<QueuedSave[]> {
  return serialized(key, async () => {
    const t = text.trim();
    const items = await readQueue(store, key);
    if (!t || items.some((q) => q.text === t)) return items;
    const next = [...items, { id: `q-${now}-${items.length}`, text: t, queued_at: new Date(now).toISOString() }];
    await writeJson(store, key, next);
    return next;
  });
}

/** Takes a text off the queue (it was saved another way). */
export function dequeueSave(store: KeyValueStore, key: string, text: string): Promise<QueuedSave[]> {
  return serialized(key, async () => {
    const next = (await readQueue(store, key)).filter((q) => q.text !== text.trim());
    await writeJson(store, key, next);
    return next;
  });
}

/** Empties the queue (sign-out, account deletion). */
export function clearQueue(store: KeyValueStore, key: string): Promise<void> {
  return serialized(key, () => writeJson(store, key, []));
}

/** Sends queued saves oldest first; stops at the first failure a later retry might fix. */
export async function flushQueue(store: KeyValueStore, key: string, api: Pick<LatelyApi, "createSave">): Promise<FlushResult> {
  const items = await readQueue(store, key);
  const out: FlushResult = { saved: [], dropped: [], remaining: [] };
  let i = 0;
  for (; i < items.length; i++) {
    const item = items[i];
    try {
      out.saved.push({ item, result: await api.createSave(item.text) });
    } catch (e) {
      if (e instanceof ApiError && PERMANENT.includes(e.code)) {
        out.dropped.push({ item, code: e.code });
        continue;
      }
      break;
    }
  }
  // Something may have been queued while this ran: keep it as well.
  const done = new Set([...out.saved, ...out.dropped].map((x) => x.item.id));
  out.remaining = await serialized(key, async () => {
    const latest = (await readQueue(store, key)).filter((q) => !done.has(q.id));
    await writeJson(store, key, latest);
    return latest;
  });
  return out;
}
