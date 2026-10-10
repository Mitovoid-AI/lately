import { ApiError, type ApiErrorCode, type SaveResult } from "../api/contract";

/** What the save sheet shows after POST /saves (one state per API outcome). */
export type SaveOutcome =
  | { kind: "saved"; reelId: string }
  | { kind: "deduped"; reelId: string }
  | { kind: "bad_url" }
  | { kind: "quota" }
  | { kind: "rate_limited" }
  | { kind: "network" }
  /** Offline, server trouble or rate limited: the text waits in the save queue and is sent later. */
  | { kind: "queued"; reason: QueueReason };

export type QueueReason = "offline" | "server" | "busy";

/** Failures a later retry can fix, so the share goes to the save queue instead of being lost. */
export const QUEUE_REASON: Partial<Record<ApiErrorCode, QueueReason>> = {
  NETWORK: "offline",
  SERVER: "server",
  RATE_LIMITED: "busy",
};

export const QUEUED_BODY: Record<QueueReason, string> = {
  offline: "You're offline. Lately will save this reel as soon as you're back online.",
  server: "Lately's server is having trouble. It will save this reel as soon as it's back.",
  busy: "Lately is busy right now. It will save this reel in a moment.",
};

export function outcomeFromResult(r: SaveResult): SaveOutcome {
  return r.deduped ? { kind: "deduped", reelId: r.reel_id } : { kind: "saved", reelId: r.reel_id };
}

export function outcomeFromError(e: unknown): SaveOutcome {
  if (e instanceof ApiError) {
    if (e.code === "BAD_URL") return { kind: "bad_url" };
    if (e.code === "QUOTA_EXCEEDED") return { kind: "quota" };
    if (e.code === "RATE_LIMITED") return { kind: "rate_limited" };
  }
  return { kind: "network" };
}
