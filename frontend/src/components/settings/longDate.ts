const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A timestamp as "Dec 12, 2026" in the phone's time zone (US order, like the app's other dates); null when it doesn't parse. */
export function longDate(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
