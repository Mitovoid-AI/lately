const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** An average month and a year, in days: old dates count in these instead of weeks. */
const MONTH_DAYS = 30.44;
const YEAR_DAYS = 365;

/** Card meta dates: "Just now", "3h", "2d", "1w", "1mo", "1y". */
export function relativeShort(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < HOUR) return "Just now";
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms < 30 * DAY) return `${Math.floor(ms / (7 * DAY))}w`;
  if (ms < YEAR_DAYS * DAY) return `${Math.floor(ms / (30 * DAY))}mo`;
  return `${Math.floor(ms / (YEAR_DAYS * DAY))}y`;
}

/**
 * Card detail: "Saved today", "Saved yesterday", "Saved 5 days ago", "Saved 2 weeks ago", then
 * months past 8 weeks ("Saved 3 months ago") and years past one ("Saved 1 year ago").
 */
export function savedAgo(iso: string, now: number): string {
  const days = Math.floor(Math.max(0, now - Date.parse(iso)) / DAY);
  if (days === 0) return "Saved today";
  if (days === 1) return "Saved yesterday";
  if (days < 14) return `Saved ${days} days ago`;
  if (days < 8 * 7) return `Saved ${Math.floor(days / 7)} weeks ago`;
  // Past 8 weeks it is at least "2 months", so the count never steps back from 7 weeks to 1 month.
  if (days < YEAR_DAYS) return `Saved ${Math.max(2, Math.floor(days / MONTH_DAYS))} months ago`;
  const years = Math.floor(days / YEAR_DAYS);
  return `Saved ${years} ${years === 1 ? "year" : "years"} ago`;
}

/** "2026-11-01" → "Nov 1" (US order: month first) */
export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Sunday, Oct 4" (viewer's local date) */
export function curatedDate(now: number): string {
  const d = new Date(now);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "2023-10-01" → "Oct 2023" */
export function monthYear(isoDate: string): string {
  const [y, m] = isoDate.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
