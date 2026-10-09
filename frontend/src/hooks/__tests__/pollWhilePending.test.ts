import { PENDING_POLL_MS, pollWhilePending } from "../useSaves";

test("polls while any visible save is pending and stops when none is", () => {
  expect(pollWhilePending([{ status: "enriched" }, { status: "pending" }])).toBe(PENDING_POLL_MS);
  expect(pollWhilePending([{ status: "enriched" }, { status: "partial" }])).toBe(false);
  expect(pollWhilePending([])).toBe(false);
  expect(pollWhilePending(undefined)).toBe(false);
});
