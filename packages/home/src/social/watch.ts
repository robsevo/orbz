// The CEO's brand watch (owner, 10-14: "we want our CEO to be absolutely obsessed with it please, thats how he chooses and
// lets you know who to promote. and skills too ... the ceo verifies and tracks each employees brand"). The CEO checks
// every orb's brand (brand.ts) and its skills (the XP its work earned in its own kind of work, specialty.ts), and says
// what it would do with each, by code (rule 8: nothing anyone says counts):
//   Promote      ready for the next level by its evidence (levels.ts), and a brand of 50 or more
//   Brand first  ready by its evidence, but the office thinks too little of it yet (under 50)
//   Watch        a brand under 40
//   Rising       up 5 or more this week
//   Steady       the rest
// It recommends every Promote to you, the best first by its merit (brand, and skills up to 30 more): a notice with
// Promote and Not yet, since only you promote (PLAN 3.8); each orb and level once. The CEO itself is never on it.
import type { Clock } from "../clock.ts";
import type { EventLog } from "../events.ts";

export type Verdict = "Promote" | "Brand first" | "Watch" | "Rising" | "Steady";
export type WatchRow = { orb: string; name: string; brand: number; word: string; week: number; skill: { area: string; xp: number } | null; skills: number; level: string; next: string | null; ready: boolean; verdict: Verdict; merit: number };
export type Watch = { ceo: { orb: string; name: string } | null; rows: WatchRow[]; pick: { orb: string; name: string; to: string; why: string } | null };

/** Skills' share of merit: a point for every 50 XP in its own kind of work, up to 30. */
export const meritOf = (brand: number, skills: number): number => brand + Math.min(30, Math.floor(skills / 50));
export function verdictOf(r: { brand: number; week: number; ready: boolean }): Verdict {
  if (r.ready) return r.brand >= 50 ? "Promote" : "Brand first";
  if (r.brand < 40) return "Watch";
  return r.week >= 5 ? "Rising" : "Steady";
}
/** Why the CEO recommends it, in a line. */
export const whyOf = (r: WatchRow): string =>
  `Brand ${r.brand}, ${r.word.toLowerCase()}${r.week > 0 ? `, up ${r.week} this week` : r.week < 0 ? `, down ${-r.week} this week` : ""}${r.skill ? `; ${r.skill.xp.toLocaleString("en-GB")} XP in ${r.skill.area}` : ""}.`;

/** The watch from each orb's numbers (the CEO left out), the best merit first. */
export function watchOf(ceo: { orb: string; name: string } | null, orbs: Omit<WatchRow, "verdict" | "merit">[]): Watch {
  const rows = orbs.filter((o) => o.orb !== ceo?.orb).map((o) => ({ ...o, verdict: verdictOf(o), merit: meritOf(o.brand, o.skills) }))
    .sort((a, b) => b.merit - a.merit || a.name.localeCompare(b.name));
  const best = ceo ? rows.find((r) => r.verdict === "Promote") : undefined;
  return { ceo, rows, pick: best ? { orb: best.orb, name: best.name, to: best.next!, why: whyOf(best) } : null };
}

export const WATCH_CHECK_MS = 5 * 60_000;

export type WatchOptions = {
  ceo: () => { orb: string; name: string } | null;
  office: () => { id: string; name: string }[];
  brand: (orb: string, at?: number) => { score: number; word: string };
  /** Its XP by area (the radar), its level and its next level by the evidence. */
  skills: (orb: string) => { areas: Record<string, number>; own: string[] };
  next: (orb: string) => { level: string; to: string | null; ready: boolean };
};

export class BrandWatch {
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #o: WatchOptions;
  #checkedAt = -Infinity;

  constructor(events: EventLog, clock: Clock, o: WatchOptions) {
    this.#events = events;
    this.#clock = clock;
    this.#o = o;
  }

  now(): Watch {
    const at = this.#clock.now();
    return watchOf(this.#o.ceo(), this.#o.office().map((x) => {
      const b = this.#o.brand(x.id);
      const sk = this.#o.skills(x.id);
      const own = sk.own.length ? sk.own : Object.keys(sk.areas);
      const top = own.map((area) => ({ area, xp: sk.areas[area] ?? 0 })).sort((p, q) => q.xp - p.xp)[0];
      const n = this.#o.next(x.id);
      return {
        orb: x.id, name: x.name, brand: b.score, word: b.word, week: b.score - this.#o.brand(x.id, at - 7 * 86_400_000).score,
        skill: top && top.xp > 0 ? top : null, skills: own.reduce((s, a) => s + (sk.areas[a] ?? 0), 0), level: n.level, next: n.to, ready: n.ready,
      };
    }));
  }

  /** For the CEO's standing context: its obsession, and the watch as it stands. */
  line(orb: string): string | null {
    const w = this.now();
    if (!w.ceo || w.ceo.orb !== orb) return null;
    return [
      "You are the CEO, and you are obsessed with brand: how the whole office sees each employee (kept by the home, from their friendships, the work the Founder approved or corrected, their ideas, how they help the others and their record). You track every brand and every employee's skills, and you recommend promotions by them, never by talk. Bring brand up whenever it fits.",
      // words, never the numbers: the standing context is every request's cached prefix (PLAN 1.15)
      ...w.rows.map((r) => `- ${r.name}: ${r.word.toLowerCase()}${r.skill ? `, strongest in ${r.skill.area}` : ""}; ${r.verdict === "Promote" ? `you recommend ${r.next}` : r.verdict === "Brand first" ? `ready for ${r.next} on paper, but you want its brand up first` : r.verdict.toLowerCase()}.`),
    ].join("\n");
  }

  /** The tick's: every few minutes, each Promote is recommended to you once (an orb and its level). */
  due(): number {
    const now = this.#clock.now();
    if (now - this.#checkedAt < WATCH_CHECK_MS) return 0;
    this.#checkedAt = now;
    const w = this.now();
    if (!w.ceo) return 0;
    const said = new Set(this.#events.ofType("ceo.recommended").map((e) => `${e.orb}\0${String(e.data.to)}`));
    let n = 0;
    for (const r of w.rows) {
      if (r.verdict !== "Promote" || said.has(`${r.orb}\0${r.next}`)) continue;
      this.#events.append("ceo.recommended", { to: r.next, ceo: w.ceo.orb, ceoName: w.ceo.name, name: r.name, why: whyOf(r), brand: r.brand, skills: r.skills }, { orb: r.orb });
      n++;
    }
    return n;
  }
}
