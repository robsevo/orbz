// What a person can ask a schedule for (PLAN 2.4: "daily at a time, or every N with a 15-minute
// minimum, with a plain-words preview"), as a rule, and the cron pattern the home runs it by. Every
// N divides its hour or its day, so the runs are evenly spaced (cron's "*/45" would run at :00 and
// :45). The words are read back off the pattern, so the preview says what will really happen, and a
// pattern made some other way (an orb's, an older home's) is said as best it can be.
import { cronOf } from "./schedule.ts";

export type Rule =
  | { kind: "daily"; time: string; days?: number[] } // days: 1 Monday … 7 Sunday; none, every day
  | { kind: "every"; n: number; unit: "minutes" | "hours" };

export const EVERY_MINUTES = [15, 20, 30] as const;
export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12] as const;
const DAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export class RuleError extends Error {}

/** The cron pattern for a rule, or why it cannot be one. */
export function cronFor(r: Rule): string {
  if (r.kind === "every") {
    if (r.unit === "minutes") {
      if (!(EVERY_MINUTES as readonly number[]).includes(r.n)) throw new RuleError(`every ${r.n} minutes: choose 15, 20 or 30 (never under 15, and evenly through the hour)`);
      return `*/${r.n} * * * *`;
    }
    if (!(EVERY_HOURS as readonly number[]).includes(r.n)) throw new RuleError(`every ${r.n} hours: choose 1, 2, 3, 4, 6, 8 or 12 (evenly through the day)`);
    return r.n === 1 ? "0 * * * *" : `0 */${r.n} * * *`;
  }
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(r.time);
  if (!m) throw new RuleError(`"${r.time}" is not a time of day (00:00 to 23:59)`);
  const days = [...new Set(r.days ?? [])].sort((a, b) => a - b);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new RuleError("days are 1 (Monday) to 7 (Sunday)");
  const dow = !days.length || days.length === 7 ? "*" : days.map((d) => d % 7).sort((a, b) => a - b).join(",");
  return `${Number(m[2])} ${Number(m[1])} * * ${dow}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const list = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** A pattern in plain words: "Every day at 09:00", "Weekdays at 08:30", "Every 15 minutes". */
export function wordsOf(cron: string): string {
  const f = cron.trim().split(/\s+/);
  if (f.length === 5) {
    const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
    const every = /^\*\/(\d+)$/.exec(min);
    if (every && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${every[1]} minutes`;
    const hours = /^\*\/(\d+)$/.exec(hour);
    if (min === "0" && dom === "*" && mon === "*" && dow === "*" && (hour === "*" || hours)) return hour === "*" ? "Every hour" : `Every ${hours![1]} hours`;
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && mon === "*") {
      const at = `${pad(Number(hour))}:${pad(Number(min))}`;
      if (dow === "*") return `Every day at ${at}`;
      if (/^[0-7](,[0-7])*$/.test(dow)) {
        const days = [...new Set(dow.split(",").map((d) => Number(d) % 7 || 7))].sort((a, b) => a - b);
        if (days.join() === "1,2,3,4,5") return `Weekdays at ${at}`;
        if (days.join() === "6,7") return `Weekends at ${at}`;
        return `${list(days.map((d) => `${DAY[d]}s`))} at ${at}`;
      }
    }
  }
  return `On its own pattern (${cron})`;
}

/** What the editor shows as you choose: the pattern, its words, and when it runs next. */
export function preview(r: Rule, timezone: string, from: Date, count = 3): { cron: string; words: string; next: number[] } {
  const cron = cronFor(r);
  const runs = cronOf(cron, timezone).nextRuns(count, from).map((d) => d.getTime());
  return { cron, words: wordsOf(cron), next: runs };
}

/** A rule from what the door was sent, checked for shape (the values are cronFor's to check). */
export function ruleOf(v: unknown): Rule {
  const r = v as Record<string, unknown> | null;
  if (r?.kind === "daily" && typeof r.time === "string") {
    if (r.days !== undefined && !(Array.isArray(r.days) && r.days.every((d) => typeof d === "number"))) throw new RuleError("days are a list of numbers");
    return { kind: "daily", time: r.time, ...(Array.isArray(r.days) && { days: r.days as number[] }) };
  }
  if (r?.kind === "every" && typeof r.n === "number" && (r.unit === "minutes" || r.unit === "hours")) return { kind: "every", n: r.n, unit: r.unit };
  throw new RuleError('a rule is {kind: "daily", time: "HH:MM", days?} or {kind: "every", n, unit: "minutes" | "hours"}');
}
