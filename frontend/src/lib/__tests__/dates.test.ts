import { NOW } from "../../test/fixtures";
import { curatedDate, relativeShort, savedAgo, shortDate } from "../dates";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("relativeShort buckets", () => {
  expect(relativeShort(ago(10 * MIN), NOW)).toBe("Just now");
  expect(relativeShort(ago(3 * 60 * MIN), NOW)).toBe("3h");
  expect(relativeShort(ago(2 * DAY), NOW)).toBe("2d");
  expect(relativeShort(ago(8 * DAY), NOW)).toBe("1w");
  expect(relativeShort(ago(15 * DAY), NOW)).toBe("2w");
  expect(relativeShort(ago(40 * DAY), NOW)).toBe("1mo");
});

test("savedAgo reads like the card detail copy", () => {
  expect(savedAgo(ago(1 * MIN), NOW)).toBe("Saved today");
  expect(savedAgo(ago(1 * DAY), NOW)).toBe("Saved yesterday");
  expect(savedAgo(ago(5 * DAY), NOW)).toBe("Saved 5 days ago");
  expect(savedAgo(ago(15 * DAY), NOW)).toBe("Saved 2 weeks ago");
});

test("shortDate and curatedDate", () => {
  expect(shortDate("2026-11-01")).toBe("1 Nov");
  expect(curatedDate(NOW)).toBe("Sunday, 4 Oct");
});
