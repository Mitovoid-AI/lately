import { ApiError } from "../../api/contract";
import {
  outcomeFromError,
  outcomeFromResult,
  TRACKER_ESTIMATE,
  TRACKER_LATE,
  TRACKER_PARTIAL,
  TRACKER_SLOW,
  TRACKER_UNREACHABLE,
  trackerNote,
  trackerSteps,
} from "../saveOutcome";

test("a created save is 'saved', a repeat is 'deduped'", () => {
  expect(outcomeFromResult({ reel_id: "r1", deduped: false, status: "pending" })).toEqual({ kind: "saved", reelId: "r1" });
  expect(outcomeFromResult({ reel_id: "r1", deduped: true, status: "enriched" })).toEqual({ kind: "deduped", reelId: "r1" });
});

test("API errors map to their sheet state", () => {
  expect(outcomeFromError(new ApiError("BAD_URL", 422))).toEqual({ kind: "bad_url" });
  expect(outcomeFromError(new ApiError("QUOTA_EXCEEDED", 429))).toEqual({ kind: "quota" });
  expect(outcomeFromError(new ApiError("RATE_LIMITED", 429))).toEqual({ kind: "rate_limited" });
  expect(outcomeFromError(new ApiError("NETWORK", 0))).toEqual({ kind: "network" });
  expect(outcomeFromError(new ApiError("SERVER", 500))).toEqual({ kind: "network" });
  expect(outcomeFromError(new Error("x"))).toEqual({ kind: "network" });
});

const states = (steps: ReturnType<typeof trackerSteps>) => steps.map((s) => s.state);

test("the tracker follows the server's stage through its four named steps", () => {
  expect(trackerSteps("pending", "resolve").map((s) => [s.label, s.state])).toEqual([
    ["Getting the reel", "active"],
    ["Listening to it", "todo"],
    ["Finding places and steps", "todo"],
    ["Card ready", "todo"],
  ]);
  expect(states(trackerSteps("pending", "fetch"))).toEqual(["active", "todo", "todo", "todo"]);
  expect(trackerSteps("pending", "transcribe").map((s) => [s.label, s.state])).toEqual([
    ["Got the reel", "done"],
    ["Listening to it", "active"],
    ["Finding places and steps", "todo"],
    ["Card ready", "todo"],
  ]);
  expect(states(trackerSteps("pending", "vision"))).toEqual(["done", "active", "todo", "todo"]);
  expect(states(trackerSteps("pending", "structure"))).toEqual(["done", "done", "active", "todo"]);
  expect(states(trackerSteps("pending", "finalize"))).toEqual(["done", "done", "active", "todo"]);
});

test("a pending save the server has not staged yet starts on the first step", () => {
  expect(states(trackerSteps("pending", null))).toEqual(["active", "todo", "todo", "todo"]);
  expect(states(trackerSteps("pending", undefined))).toEqual(["active", "todo", "todo", "todo"]);
});

test("an enriched or partial card has finished every step", () => {
  for (const status of ["enriched", "partial"] as const) {
    const steps = trackerSteps(status, null);
    expect(states(steps)).toEqual(["done", "done", "done", "done"]);
    expect(steps.map((s) => s.label)).toEqual(["Got the reel", "Listened to it", "Found places and steps", "Card ready"]);
  }
});

test("the line under the steps is an honest estimate early, then plain words, never a percentage", () => {
  expect(trackerNote({ status: "pending", stage: "resolve" })).toBe(TRACKER_ESTIMATE);
  expect(trackerNote({ status: "pending", stage: "vision" })).toBe(TRACKER_ESTIMATE);
  expect(trackerNote({ status: "pending" })).toBe(TRACKER_ESTIMATE);
  expect(TRACKER_ESTIMATE).toContain("about 30 s");
  expect(trackerNote({ status: "pending", stage: "structure" })).toBe(TRACKER_LATE);
  expect(trackerNote({ status: "pending", stage: "finalize" })).toBe(TRACKER_LATE);
  expect(trackerNote({ status: "pending", stage: "vision", slow: true })).toBe(TRACKER_SLOW);
  expect(trackerNote({ status: "pending", stage: "vision", slow: true, unreachable: true })).toBe(TRACKER_UNREACHABLE);
  expect(trackerNote({ status: "enriched" })).toBe("Your card is ready.");
  expect(trackerNote({ status: "enriched", first: true })).toBe("Your first card is ready.");
  expect(trackerNote({ status: "partial", slow: true })).toBe(TRACKER_PARTIAL);
});
