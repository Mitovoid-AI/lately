import type { Save } from "../../api/contract";

type Stage = NonNullable<Save["stage"]>;

/** What the enrich job is doing, in words a person would use. */
const STEP: Record<Stage, string> = {
  resolve: "Getting the reel",
  fetch: "Getting the reel",
  transcribe: "Listening to it",
  vision: "Listening to it",
  structure: "Finding places and steps",
  finalize: "Almost ready",
};

/** Shown when the server has not named a step yet (or names one this app does not know). */
export const DEFAULT_STEP = "Writing your card";

/** The step name for a pending save's current stage. */
export function stepLabel(stage: Save["stage"] | undefined): string {
  return (stage ? STEP[stage] : undefined) ?? DEFAULT_STEP;
}

/** A card usually takes about this long; past `SLOW_AFTER_MS` the estimate would be a lie. */
const SLOW_AFTER_MS = 2 * 60_000;

/** An honest time hint: the usual wait while it is early, a plain admission once it is not. */
export function waitHint(createdAt: string, now: number): string {
  const age = now - (Date.parse(createdAt) || now);
  return age > SLOW_AFTER_MS ? "taking longer than usual" : "about 30 s";
}
