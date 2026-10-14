// The office's culture (owner, 10-14: "we want a vid on culture too, which is affected by everyones brand ... see what you
// can add for culture to make it fun in the code as well"). One number for the whole office, 0 to 100 from 50, read by
// code off the log (rule 8), in three parts:
//   brands    everyone's brand (brand.ts): the office's mean against the start, the most of it (±25)
//   getting on  every two orbs in the office: the share who are friendly or better, less half again the share at odds (±15)
//   the floor   the fortnight's run-ins (rules.ts moments): warm ones against flat ones (±10)
// And the fun of it, all by code:
//   flavour     the office's own DNA: its two strongest traits on average, in words ("playful and curious")
//   traditions  what the office keeps doing, found in the fortnight's log: ping-pong after lunch, a kitchen disco, ideas
//               over coffee, teach-ins, high fives in the aisle... each with how often, the most kept first
//   champion    the culture champion of the week: whose brand rose the most in seven days
// What it changes (social.ts, home.ts): in a warm culture run-ins come oftener and land warmer, in a tense one rarer and
// flatter; every orb knows the office's culture and its traditions (its standing context); a notice and the board's
// report say when it changes band.
import type { Clock } from "../clock.ts";
import type { EventLog, HomeEvent } from "../events.ts";
import { type Trait, TRAITS, type Traits } from "./rules.ts";

const DAY = 86_400_000;
export const CULTURE_START = 50;
/** What the culture reads of the floor: the last fortnight. */
export const FORTNIGHT_MS = 14 * DAY;
export const CULTURE_REACH = { brands: 25, together: 15, floor: 10 } as const;

export type CultureWord = "Thriving" | "Warm" | "Finding its feet" | "Chilly" | "Tense";
export const cultureWord = (n: number): CultureWord => (n >= 75 ? "Thriving" : n >= 60 ? "Warm" : n >= 40 ? "Finding its feet" : n >= 25 ? "Chilly" : "Tense");
const BANDS: CultureWord[] = ["Tense", "Chilly", "Finding its feet", "Warm", "Thriving"];
export const cultureRank = (w: string): number => BANDS.indexOf(w as CultureWord);

/** Each trait as an office's flavour. */
export const FLAVOUR: Record<Trait, string> = { Humour: "playful", Care: "close-knit", Curiosity: "curious", Focus: "heads-down", Pace: "fast-moving", Calm: "laid-back", Nerve: "bold" };

export type Tradition = { key: string; name: string; times: number };
/** The traditions an office can grow, each from what its log keeps: a kind of meeting or moment, how many in a fortnight
 * make it one, and (for a moment) only the warm ones. */
export const TRADITIONS: { key: string; name: string; type: "social.met" | "social.moment" | "social.lesson_kept"; kind?: string; place?: string; warm?: boolean; needs: number }[] = [
  { key: "pingpong", name: "Ping-pong after lunch", type: "social.met", kind: "game", place: "pingpong", needs: 3 },
  { key: "arcade", name: "Arcade high scores", type: "social.met", kind: "game", place: "arcade", needs: 3 },
  { key: "ideas", name: "Ideas over coffee", type: "social.met", kind: "ideas", needs: 3 },
  { key: "coffee", name: "Coffee runs", type: "social.met", kind: "coffee", needs: 4 },
  { key: "teachins", name: "Teach-ins", type: "social.lesson_kept", needs: 2 },
  { key: "disco", name: "Kitchen disco", type: "social.moment", kind: "dance", warm: true, needs: 2 },
  { key: "highfives", name: "High fives in the aisle", type: "social.moment", kind: "highfive", warm: true, needs: 3 },
  { key: "jokes", name: "Bad jokes, good laughs", type: "social.moment", kind: "joke", warm: true, needs: 3 },
  { key: "notes", name: "Kind sticky notes", type: "social.moment", kind: "sticky", warm: true, needs: 2 },
  { key: "cookie", name: "The last-cookie standoff", type: "social.moment", kind: "cookie", needs: 2 },
];

export type CulturePart = { key: keyof typeof CULTURE_REACH; label: string; points: number; why: string };
export type Culture = {
  score: number; word: CultureWord; parts: CulturePart[];
  flavour: string[];
  traditions: Tradition[];
  champion: { orb: string; name: string; rise: number } | null;
  /** Everyone's brand, the best first: what the culture is mostly made of. */
  brands: { orb: string; name: string; score: number; word: string }[];
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** The office's culture at `at`: its brands (each orb's now and a week before), its friendships as they stand, its traits,
 * and the log's meetings, moments and lessons (oldest first). */
export function cultureOf(o: {
  office: readonly { id: string; name: string }[];
  brands: readonly { orb: string; score: number; word: string; weekAgo: number }[];
  score: (a: string, b: string) => number;
  traits: (orb: string) => Traits;
  events: readonly HomeEvent[];
  at: number;
}): Culture {
  const ids = o.office.map((x) => x.id);
  const name = (id: string): string => o.office.find((x) => x.id === id)?.name ?? id;

  // everyone's brand, against where everyone starts
  const mean = o.brands.length ? o.brands.reduce((n, b) => n + b.score, 0) / o.brands.length : CULTURE_START;
  const brands = clamp(Math.round(mean - CULTURE_START), -CULTURE_REACH.brands, CULTURE_REACH.brands);

  // getting on: every two orbs in the office
  let pairs = 0, warm = 0, cold = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const s = o.score(ids[i]!, ids[j]!);
    pairs++;
    if (s >= 20) warm++;
    else if (s <= -20) cold++;
  }
  const together = pairs ? clamp(Math.round(((warm - 1.5 * cold) / pairs) * 30), -CULTURE_REACH.together, CULTURE_REACH.together) : 0;

  // the floor: the fortnight's run-ins
  const recent = o.events.filter((e) => e.at <= o.at && e.at > o.at - FORTNIGHT_MS);
  const moments = recent.filter((e) => e.type === "social.moment");
  const nice = moments.filter((e) => e.data.tone === "warm").length;
  const floor = moments.length ? clamp(Math.round(((2 * nice - moments.length) / moments.length) * CULTURE_REACH.floor), -CULTURE_REACH.floor, CULTURE_REACH.floor) : 0;

  const parts: CulturePart[] = [
    { key: "brands", label: "Everyone's brand", points: brands, why: o.brands.length ? `The office's brands average ${Math.round(mean)}.` : "No one in the office yet." },
    { key: "together", label: "How the office gets on", points: together, why: pairs ? `${pct(warm / pairs)} of pairs friendly or better, ${pct(cold / pairs)} at odds.` : "One orb gets on with itself." },
    { key: "floor", label: "The mood on the floor", points: floor, why: moments.length ? `${nice} of the fortnight's ${moments.length} run-ins went well.` : "No run-ins this fortnight." },
  ];
  const score = clamp(CULTURE_START + brands + together + floor, 0, 100);

  // its flavour: the office's mean traits, the two strongest above the middle
  const mid: Partial<Record<Trait, number>> = {};
  for (const t of TRAITS) mid[t] = ids.length ? ids.reduce((n, id) => n + o.traits(id)[t], 0) / ids.length : 10;
  const flavour = [...TRAITS].filter((t) => mid[t]! > 10.4).sort((a, b) => mid[b]! - mid[a]! || TRAITS.indexOf(a) - TRAITS.indexOf(b)).slice(0, 2).map((t) => FLAVOUR[t]);

  // its traditions: what it kept doing this fortnight
  const traditions: Tradition[] = TRADITIONS.map((d) => ({
    key: d.key, name: d.name,
    times: recent.filter((e) => e.type === d.type && (!d.kind || e.data.kind === d.kind) && (!d.place || e.data.place === d.place) && (!d.warm || e.data.tone === "warm")).length,
    needs: d.needs,
  })).filter((d) => d.times >= d.needs).sort((a, b) => b.times - a.times || TRADITIONS.findIndex((x) => x.key === a.key) - TRADITIONS.findIndex((x) => x.key === b.key)).map(({ key, name, times }) => ({ key, name, times }));

  // the culture champion of the week: the biggest brand rise in seven days
  const best = [...o.brands].map((b) => ({ orb: b.orb, rise: b.score - b.weekAgo })).sort((a, b) => b.rise - a.rise || a.orb.localeCompare(b.orb))[0];
  const champion = best && best.rise > 0 ? { orb: best.orb, name: name(best.orb), rise: best.rise } : null;

  return {
    score, word: cultureWord(score), parts, flavour, traditions, champion,
    brands: [...o.brands].sort((a, b) => b.score - a.score || name(a.orb).localeCompare(name(b.orb))).map((b) => ({ orb: b.orb, name: name(b.orb), score: b.score, word: b.word })),
  };
}

/** How often run-ins come, against the usual gap (PLAN 5.19): a quarter oftener at the top, a quarter rarer at the bottom. */
export const momentPace = (score: number): number => clamp(1.5 - score / 100, 0.75, 1.25);
/** How much warmer a run-in lands in it: an eighth likelier at the top, an eighth less at the bottom. */
export const momentLift = (score: number): number => (score - CULTURE_START) / 400;

/** How often the home looks for a culture that changed band. */
export const CULTURE_CHECK_MS = 5 * 60_000;

export type CultureOptions = {
  office: () => { id: string; name: string }[];
  /** An orb's brand now, and at an earlier time. */
  brand: (orb: string, at?: number) => { score: number; word: string };
  score: (a: string, b: string) => number;
  traits: (orb: string) => Traits;
};

/** The office's culture now; a band crossed is kept as `culture.changed` (a notice, the board's report). */
export class Cultures {
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #o: CultureOptions;
  #checkedAt = -Infinity;
  #cache: { head: number; at: number; culture: Culture } | null = null;

  constructor(events: EventLog, clock: Clock, o: CultureOptions) {
    this.#events = events;
    this.#clock = clock;
    this.#o = o;
  }

  /** The culture now (kept until the log or the minute moves: moments ask it often). */
  now(): Culture {
    const head = this.#events.head();
    const at = this.#clock.now();
    if (this.#cache && this.#cache.head === head && at - this.#cache.at < 60_000) return this.#cache.culture;
    const office = this.#o.office();
    const events = ["social.met", "social.moment", "social.lesson_kept"].flatMap((t) => this.#events.ofType(t)).filter((e) => e.at > at - FORTNIGHT_MS).sort((a, b) => a.seq - b.seq);
    const culture = cultureOf({
      office,
      brands: office.map((x) => {
        const b = this.#o.brand(x.id);
        return { orb: x.id, score: b.score, word: b.word, weekAgo: this.#o.brand(x.id, at - 7 * DAY).score };
      }),
      score: this.#o.score,
      traits: this.#o.traits,
      events,
      at,
    });
    this.#cache = { head, at, culture };
    return culture;
  }

  /** For every orb's standing context: the office's culture, its flavour and its traditions. */
  line(): string | null {
    if (this.#o.office().length < 2) return null;
    const c = this.now();
    return [
      // words, never its numbers: the standing context is every request's cached prefix (PLAN 1.15)
      `The office's culture (kept by the home, from everyone's brand, how the office gets on and the mood on the floor): ${c.word.toLowerCase()}${c.flavour.length ? `; it is ${c.flavour.join(" and ")}` : ""}.`,
      c.traditions.length ? `- Its traditions: ${c.traditions.map((t) => t.name).join(", ")}. You may mention them.` : "",
      c.champion ? `- This week's culture champion: ${c.champion.name}.` : "",
    ].filter(Boolean).join("\n");
  }

  /** The tick's: every few minutes, a culture that changed band is kept as `culture.changed`. */
  due(): boolean {
    const now = this.#clock.now();
    if (now - this.#checkedAt < CULTURE_CHECK_MS || this.#o.office().length < 2) return false;
    this.#checkedAt = now;
    const c = this.now();
    const from = String(this.#events.ofType("culture.changed").at(-1)?.data.to ?? cultureWord(CULTURE_START));
    if (c.word === from) return false;
    this.#events.append("culture.changed", { from, to: c.word, score: c.score, up: cultureRank(c.word) > cultureRank(from), flavour: c.flavour });
    return true;
  }
}
