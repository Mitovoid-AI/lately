import { NOW } from "../../test/fixtures";
import {
  isStalePending,
  markRetried,
  PENDING_FAST_MS,
  PENDING_POLL_MS,
  PENDING_SLOW_MS,
  pollWhilePending,
} from "../useSaves";

const MIN = 60_000;
const save = (status: "pending" | "enriched" | "partial", ageMs: number, id = `s-${status}-${ageMs}`) => ({
  id,
  status,
  created_at: new Date(NOW - ageMs).toISOString(),
});

test("polls fast while a pending save is young, slowly after 2 min, and stops after 15 min", () => {
  expect(PENDING_POLL_MS).toBe(PENDING_FAST_MS);
  expect(PENDING_FAST_MS).toBe(4000);
  expect(PENDING_SLOW_MS).toBe(30_000);
  expect(pollWhilePending([save("pending", 30_000)], NOW)).toBe(4000);
  expect(pollWhilePending([save("pending", 5 * MIN)], NOW)).toBe(30_000);
  expect(pollWhilePending([save("pending", 16 * MIN)], NOW)).toBe(false);
  // The youngest pending save sets the pace.
  expect(pollWhilePending([save("pending", 16 * MIN), save("pending", 5 * MIN), save("pending", MIN)], NOW)).toBe(4000);
});

test("does not poll when nothing is pending", () => {
  expect(pollWhilePending([save("enriched", 0), save("partial", 0)], NOW)).toBe(false);
  expect(pollWhilePending([], NOW)).toBe(false);
  expect(pollWhilePending(undefined, NOW)).toBe(false);
});

test("a retried save counts its age from the retry", () => {
  const old = save("pending", 3 * 24 * 60 * MIN, "s-retried");
  expect(pollWhilePending([old], NOW)).toBe(false);
  markRetried("s-retried", NOW - 10_000);
  expect(pollWhilePending([old], NOW)).toBe(4000);
  expect(isStalePending(old, NOW)).toBe(false);
});

test("a pending save older than 10 minutes is stale (offer Try again)", () => {
  expect(isStalePending(save("pending", 9 * MIN), NOW)).toBe(false);
  expect(isStalePending(save("pending", 11 * MIN), NOW)).toBe(true);
  expect(isStalePending(save("partial", 11 * MIN), NOW)).toBe(false);
});
