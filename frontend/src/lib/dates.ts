const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Card meta dates: "Just now", "3h", "2d", "1w", "1mo". */
export function relativeShort(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < HOUR) return "Just now";
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms < 30 * DAY) return `${Math.floor(ms / (7 * DAY))}w`;
  return `${Math.floor(ms / (30 * DAY))}mo`;
}

/** Card detail: "Saved today", "Saved yesterday", "Saved 5 days ago", "Saved 2 weeks ago". */
export function savedAgo(iso: string, now: number): string {
  const days = Math.floor(Math.max(0, now - Date.parse(iso)) / DAY);
  if (days === 0) return "Saved today";
  if (days === 1) return "Saved yesterday";
  if (days < 14) return `Saved ${days} days ago`;
  return `Saved ${Math.floor(days / 7)} weeks ago`;
}

/** "2026-11-01" → "1 Nov" */
export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Sunday, 4 Oct" (viewer's local date) */
export function curatedDate(now: number): string {
  const d = new Date(now);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "2023-10-01" → "Oct 2023" */
export function monthYear(isoDate: string): string {
  const [y, m] = isoDate.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
