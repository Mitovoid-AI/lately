import { DEFAULT_STEP, stepLabel, waitHint } from "../stage";

test("each enrich stage reads as a plain step", () => {
  expect(stepLabel("resolve")).toBe("Getting the reel");
  expect(stepLabel("fetch")).toBe("Getting the reel");
  expect(stepLabel("transcribe")).toBe("Listening to it");
  expect(stepLabel("vision")).toBe("Listening to it");
  expect(stepLabel("structure")).toBe("Finding places and steps");
  expect(stepLabel("finalize")).toBe("Almost ready");
});

test("no stage yet falls back to the generic step", () => {
  expect(DEFAULT_STEP).toBe("Writing your card");
  expect(stepLabel(null)).toBe(DEFAULT_STEP);
  expect(stepLabel(undefined)).toBe(DEFAULT_STEP);
});

test("a stage this app does not know falls back too", () => {
  expect(stepLabel("brand-new-stage" as Parameters<typeof stepLabel>[0])).toBe(DEFAULT_STEP);
});

test("the wait hint is the usual 30 s while early and admits a slow job later", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  expect(waitHint(new Date(now - 20_000).toISOString(), now)).toBe("about 30 s");
  expect(waitHint(new Date(now - 100_000).toISOString(), now)).toBe("about 30 s");
  expect(waitHint(new Date(now - 3 * 60_000).toISOString(), now)).toBe("taking longer than usual");
});
