import { ApiError, type ApiErrorCode, type ReelStatus, type SaveResult, type SaveStage } from "../api/contract";

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

// ----------------------------------------------------------------------------- progress --
// What the save sheet's tracker shows while a card is being made. Every state comes from the
// server's real enrich stage (Save.stage); nothing here is a timer or a percentage.

export type StepState = "done" | "active" | "todo";

export interface TrackerStep {
  key: "reel" | "listen" | "find" | "ready";
  /** The step's name now: "Getting the reel" while it runs, "Got the reel" once it has. */
  label: string;
  state: StepState;
}

const STEPS = [
  { key: "reel", doing: "Getting the reel", done: "Got the reel" },
  { key: "listen", doing: "Listening to it", done: "Listened to it" },
  { key: "find", doing: "Finding places and steps", done: "Found places and steps" },
  { key: "ready", doing: "Card ready", done: "Card ready" },
] as const;

/** Which tracker step each of the server's stages belongs to. */
const STAGE_STEP: Record<SaveStage, number> = {
  resolve: 0,
  fetch: 0,
  transcribe: 1,
  vision: 1,
  structure: 2,
  finalize: 2,
};

/** Shown while a save is pending and the server has not named its stage (or names one this app does not know). */
export const STAGE_FALLBACK = "Getting details";

/**
 * What the enrich job is doing right now, in the tracker's own words. Home's pending tile and the
 * card detail use this so every place says the same thing: Getting the reel, Listening to it,
 * Finding places and steps. With no stage it is "Getting details".
 */
export function stageLabel(stage: SaveStage | null | undefined): string {
  if (!stage || !(stage in STAGE_STEP)) return STAGE_FALLBACK;
  return STEPS[STAGE_STEP[stage]].doing;
}

/**
 * The four named steps for a save. A pending save is on the step its stage belongs to (the first
 * one when the server has not said, as an older server does not); an enriched or partial card has
 * finished them all.
 */
export function trackerSteps(status: ReelStatus, stage: SaveStage | null | undefined): TrackerStep[] {
  const finished = status !== "pending";
  const current = finished ? STEPS.length : stage && stage in STAGE_STEP ? STAGE_STEP[stage] : 0;
  return STEPS.map((s, i) => {
    const state: StepState = i < current ? "done" : i === current ? "active" : "todo";
    return { key: s.key, label: state === "done" ? s.done : s.doing, state };
  });
}

// No time is promised here: nothing measures how long a card takes in production.
export const TRACKER_ESTIMATE = "Lately is reading the reel. You can close this.";
export const TRACKER_LATE = "Almost there";
export const TRACKER_SLOW = "Still working. You can close this; the card keeps filling in.";
export const TRACKER_UNREACHABLE = "Can't check progress right now. The card keeps filling in.";
/** One wording for a card that is only partly filled in, here and on the card itself. */
export const PARTIAL_NOTICE = "Lately could only read part of this reel.";
export const TRACKER_PARTIAL = `${PARTIAL_NOTICE} Open the card to try again.`;

/** The one line under the steps. */
export function trackerNote(o: {
  status: ReelStatus;
  stage?: SaveStage | null;
  /** Polling has been going on long enough to say the card is slow. */
  slow?: boolean;
  /** The last check on the server failed. */
  unreachable?: boolean;
  /** This is the first card the person has ever saved. */
  first?: boolean;
}): string {
  if (o.status === "enriched") return o.first ? "Your first card is ready." : "Your card is ready.";
  if (o.status === "partial") return TRACKER_PARTIAL;
  if (o.unreachable) return TRACKER_UNREACHABLE;
  if (o.slow) return TRACKER_SLOW;
  return o.stage && STAGE_STEP[o.stage] === 2 ? TRACKER_LATE : TRACKER_ESTIMATE;
}
