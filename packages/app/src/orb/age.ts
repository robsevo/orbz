// How long, as a person says it (owner, 10-02: "show orb age in days, years as well if and when we
// get there"): days, then years and days once there is a year. A year runs from a date to the same
// date the next year, and a day is the clock coming round where you are: daylight saving moves
// neither.

const DAY_MS = 86_400_000;

/** A moment as the wall clock where you are reads it, written as if that were UTC, so the days
 * between two of them are 24 hours each, daylight saving or not. */
function wall(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/** From `from` to `to`: "0 days", "1 day", "364 days", "1 year", "2 years, 40 days". */
export function span(from: number, to: number): string {
  const a = new Date(wall(from));
  const b = wall(to);
  const yearsOn = (n: number): number => Date.UTC(a.getUTCFullYear() + n, a.getUTCMonth(), a.getUTCDate(), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds(), a.getUTCMilliseconds());
  let years = 0;
  while (yearsOn(years + 1) <= b) years++;
  const days = Math.max(0, Math.floor((b - yearsOn(years)) / DAY_MS));
  const d = `${days} day${days === 1 ? "" : "s"}`;
  if (!years) return d;
  const y = `${years} year${years === 1 ? "" : "s"}`;
  return days ? `${y}, ${d}` : y;
}
