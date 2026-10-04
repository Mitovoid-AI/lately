import { ApiError, type SaveResult } from "../api/contract";

/** What the save sheet shows after POST /saves (one state per API outcome). */
export type SaveOutcome =
  | { kind: "saved"; reelId: string }
  | { kind: "deduped"; reelId: string }
  | { kind: "bad_url" }
  | { kind: "quota" }
  | { kind: "rate_limited" }
  | { kind: "network" };

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
