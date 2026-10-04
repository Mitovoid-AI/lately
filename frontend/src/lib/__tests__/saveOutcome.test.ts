import { ApiError } from "../../api/contract";
import { outcomeFromError, outcomeFromResult } from "../saveOutcome";

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
