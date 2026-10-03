// A calendar's ICS (PLAN 4.2: "CalDAV/ICS"), read by our own code: the events in a window, with the
// recurrences real calendars use (RRULE: DAILY, WEEKLY with BYDAY, MONTHLY, YEARLY; INTERVAL,
// COUNT, UNTIL; EXDATE). Times in UTC (…Z), in a named zone (TZID=Europe/London), or floating (the
// home's own time); a date alone is a day-long event. A recurrence keeps its own zone's clock (RFC
// 5545): a 09:00 New York standup stays 09:00 in New York when London's clocks change a week before
// New York's. Outlook names its zones the Windows way ("Pacific Standard Time"): the common ones
// are read as theirs. One time of a series moved or called off (its RECURRENCE-ID) replaces that
// time, never doubles it. A monthly rule by weekday ("the second Tuesday", BYDAY=2TU) or by day
// (BYMONTHDAY) is read; a rule with parts this reader does not know gives its first time only,
// never times it made up. Lines are unfolded and text unescaped. What it says is someone else's
// (an invite's title): shown, never obeyed.

export type IcsEvent = { uid: string; title: string; start: number; end: number; allDay: boolean; location: string | null };

const unescape = (s: string): string => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** Wall-clock parts in a zone as an instant (the zone's own offset at that moment, found twice over). */
export function zoned(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = (t: number): number => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(t).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - t;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

/** Where a time's clock is: UTC, a named zone, or the home's own (null). */
type Zone = string | null;

/** Outlook's Windows zone names for the zones people meet in most, as IANA names. */
const WINDOWS: Record<string, string> = {
  "Pacific Standard Time": "America/Los_Angeles", "Mountain Standard Time": "America/Denver", "US Mountain Standard Time": "America/Phoenix",
  "Central Standard Time": "America/Chicago", "Eastern Standard Time": "America/New_York", "Atlantic Standard Time": "America/Halifax",
  "Alaskan Standard Time": "America/Anchorage", "Hawaiian Standard Time": "Pacific/Honolulu", "Newfoundland Standard Time": "America/St_Johns",
  "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik", "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris", "Central Europe Standard Time": "Europe/Budapest", "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau", "FLE Standard Time": "Europe/Kiev", "GTB Standard Time": "Europe/Bucharest", "Russian Standard Time": "Europe/Moscow",
  "India Standard Time": "Asia/Kolkata", "China Standard Time": "Asia/Shanghai", "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul",
  "Singapore Standard Time": "Asia/Singapore", "AUS Eastern Standard Time": "Australia/Sydney", "New Zealand Standard Time": "Pacific/Auckland",
  "E. South America Standard Time": "America/Sao_Paulo", "SA Pacific Standard Time": "America/Bogota", "Arabian Standard Time": "Asia/Dubai",
  "South Africa Standard Time": "Africa/Johannesburg", "Israel Standard Time": "Asia/Jerusalem", "Turkey Standard Time": "Europe/Istanbul",
  UTC: "UTC", "Coordinated Universal Time": "UTC",
};

/** A wall-clock time (month from 0; days past the month's end roll on) in its zone, as an instant. */
function instant(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: Zone): number {
  if (zone === null) return new Date(y, mo, d, h, mi, s).getTime();
  if (zone === "UTC") return Date.UTC(y, mo, d, h, mi, s);
  const day = new Date(Date.UTC(y, mo, d));
  return zoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, s, zone);
}

type When = { t: number; allDay: boolean; wall: [number, number, number, number, number, number]; zone: Zone };

/** A DATE or DATE-TIME value, with its parameters: its instant, its wall clock and zone, and whether it was a date alone. */
function when(value: string, params: Record<string, string>): When | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (m[4] === undefined || params.VALUE === "DATE") return { t: instant(y, mo, d, 0, 0, 0, null), allDay: true, wall: [y, mo, d, 0, 0, 0], zone: null };
  const wall: When["wall"] = [y, mo, d, Number(m[4]), Number(m[5]), Number(m[6])];
  let zone: Zone = m[7] ? "UTC" : params.TZID ? (WINDOWS[params.TZID] ?? params.TZID) : null;
  let t: number;
  try {
    t = instant(...wall, zone);
  } catch {
    zone = null; // a zone this machine does not know: read as the home's own time
    t = instant(...wall, zone);
  }
  return { t, allDay: false, wall, zone };
}

type Prop = { name: string; params: Record<string, string>; value: string };
function props(lines: string[]): Prop[] {
  return lines.map((l) => {
    const i = l.indexOf(":");
    const head = i < 0 ? l : l.slice(0, i);
    const [name, ...ps] = head.split(";");
    const params = Object.fromEntries(ps.map((p) => p.split("=")).map(([k, v]) => [k!.toUpperCase(), (v ?? "").replace(/^"|"$/g, "")]));
    return { name: name!.toUpperCase(), params, value: i < 0 ? "" : l.slice(i + 1) };
  });
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
/** At most this many occurrences of one recurring event are worked out (a daily one for years is not thousands). */
export const OCCURRENCES_CAP = 500;

/** The events in [from, to), recurrences worked out within it. */
export function icsEvents(text: string, from: number, to: number): IcsEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const blocks: Prop[][] = [];
  let block: string[] | null = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) block = [];
    else if (/^END:VEVENT$/i.test(line) && block) {
      blocks.push(props(block));
      block = null;
    } else block?.push(line);
  }
  // one time of a series moved or called off: the series leaves that time to it
  const replaced = new Map<string, Set<number>>();
  for (const ps of blocks) {
    const id = ps.find((p) => p.name === "RECURRENCE-ID");
    const t = id && when(id.value, id.params)?.t;
    if (t === undefined || t === null) continue;
    const uid = ps.find((p) => p.name === "UID")?.value ?? "";
    replaced.set(uid, (replaced.get(uid) ?? new Set()).add(t));
  }
  const out: IcsEvent[] = [];
  for (const ps of blocks) {
    if (/^CANCELLED$/i.test(ps.find((p) => p.name === "STATUS")?.value ?? "")) continue; // called off: not on
    const series = !ps.some((p) => p.name === "RECURRENCE-ID");
    out.push(...occurrences(ps, from, to, series ? (replaced.get(ps.find((p) => p.name === "UID")?.value ?? "") ?? new Set()) : new Set()));
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

/** What a rule may say that this reader works out; any other part and only its first time is given. */
const READ_PARTS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "WKST"]);

function occurrences(ps: Prop[], from: number, to: number, elsewhere: Set<number>): IcsEvent[] {
  const get = (n: string) => ps.find((p) => p.name === n);
  const startP = get("DTSTART");
  const start = startP && when(startP.value, startP.params);
  if (!start) return [];
  const endP = get("DTEND");
  const end = endP ? when(endP.value, endP.params) : null;
  const length = end ? Math.max(0, end.t - start.t) : start.allDay ? 86_400_000 : 0;
  const base = { uid: get("UID")?.value ?? "", title: unescape(get("SUMMARY")?.value ?? "(no title)"), allDay: start.allDay, location: get("LOCATION") ? unescape(get("LOCATION")!.value) : null };
  const skip = new Set([...elsewhere, ...ps.filter((p) => p.name === "EXDATE").flatMap((p) => p.value.split(",").map((v) => when(v, p.params)?.t)).filter((t): t is number => t !== undefined)]);
  const rule = get("RRULE");
  const one = (t: number): IcsEvent | null => (t + length > from && t < to && !skip.has(t) ? { ...base, start: t, end: t + length } : null);
  if (!rule) return [one(start.t)].filter((e): e is IcsEvent => e !== null);
  const r = Object.fromEntries(rule.value.split(";").map((kv) => kv.split("=")).map(([k, v]) => [k!.toUpperCase(), v ?? ""]));
  if (Object.keys(r).some((k) => !READ_PARTS.has(k)) || (r.BYDAY && r.FREQ === "YEARLY") || (r.BYMONTHDAY && r.FREQ !== "MONTHLY")) {
    return [one(start.t)].filter((e): e is IcsEvent => e !== null); // a rule this reader does not know: its first time only, never made-up ones
  }
  const interval = Math.max(1, Number(r.INTERVAL ?? 1) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? when(r.UNTIL, {})?.t ?? Infinity : Infinity;
  const byDay = (r.BYDAY ?? "").split(",").map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0);
  // a monthly rule's weekdays may be numbered: 2TU the second Tuesday, -1FR the last Friday
  const nthDays = (r.BYDAY ?? "").split(",").filter(Boolean).map((d) => ({ n: Number(d.slice(0, -2) || 0), wd: DAYS.indexOf(d.slice(-2)) })).filter((d) => d.wd >= 0);
  const monthDays = (r.BYMONTHDAY ?? "").split(",").filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n !== 0);
  /** The days of a month a monthly rule names, in order (1-based; past its end are left out). */
  const inMonth = (y: number, mo: number): number[] => {
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const days: number[] = [];
    for (const n of monthDays) days.push(n > 0 ? n : last + 1 + n);
    for (const { n, wd } of nthDays) {
      const all = Array.from({ length: last }, (_, i) => i + 1).filter((d) => new Date(Date.UTC(y, mo, d)).getUTCDay() === wd);
      if (n === 0) days.push(...all);
      else {
        const d = n > 0 ? all[n - 1] : all[all.length + n];
        if (d !== undefined) days.push(d);
      }
    }
    return [...new Set(days.filter((d) => d >= 1 && d <= last))].sort((a, b) => a - b);
  };
  const [Y, M, D, h, mi, sec] = start.wall;
  const at = (y: number, mo: number, d: number): number => instant(y, mo, d, h, mi, sec, start.zone); // the same wall-clock time, in its own zone, each time
  const lands = (y: number, mo: number, d: number): boolean => new Date(Date.UTC(y, mo, d)).getUTCDate() === D; // the 31st: only the months that have one
  const weekday = new Date(Date.UTC(Y, M, D)).getUTCDay();
  const found: IcsEvent[] = [];
  let n = 0;
  for (let step = 0; step < OCCURRENCES_CAP * 7 && n < count; step++) {
    let candidates: number[];
    if (r.FREQ === "DAILY") candidates = [at(Y, M, D + step * interval)].filter(() => !byDay.length || byDay.includes(new Date(Date.UTC(Y, M, D + step * interval)).getUTCDay())); // every weekday, say
    else if (r.FREQ === "WEEKLY") candidates = (byDay.length ? byDay : [weekday]).sort((a, b) => a - b).map((wd) => at(Y, M, D - weekday + step * 7 * interval + wd));
    else if (r.FREQ === "MONTHLY" && (nthDays.length || monthDays.length)) {
      const month = new Date(Date.UTC(Y, M + step * interval, 1));
      candidates = inMonth(month.getUTCFullYear(), month.getUTCMonth()).map((d) => at(month.getUTCFullYear(), month.getUTCMonth(), d));
    } else if (r.FREQ === "MONTHLY") candidates = lands(Y, M + step * interval, D) ? [at(Y, M + step * interval, D)] : [];
    else if (r.FREQ === "YEARLY") candidates = lands(Y + step * interval, M, D) ? [at(Y + step * interval, M, D)] : [];
    else return [one(start.t)].filter((e): e is IcsEvent => e !== null); // a rule we do not read: its first time only
    let past = false;
    for (const t of candidates) {
      if (t < start.t) continue;
      if (t > until || n >= count) {
        past = true;
        break;
      }
      n++;
      if (t >= to) {
        past = true;
        break;
      }
      const e = one(t);
      if (e) found.push(e);
      if (found.length >= OCCURRENCES_CAP) return found;
    }
    if (past) break;
  }
  return found;
}
