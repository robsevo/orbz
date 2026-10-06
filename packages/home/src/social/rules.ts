// Office life and friendships (PLAN 5.9; owner, 10-06: "when orbs arent doing anything in office, they
// should interact, and learn off each other if they can. Or just talk and exchange ideas, or just play
// games together ... and they in them create ffriendship, which means, they work well together, or not",
// and "they all meet, they are in the office"). The rules, by code and pure: how two orbs' traits get on,
// who meets whom, what they do and where, and how a meeting moves a friendship. social.ts keeps the
// office's meetings and friendships and runs them on the home's tick.

/** The seven traits, as the app's DNA has them (packages/app/src/orb/dna.ts TRAITS; a test keeps them alike). */
export const TRAITS = ["Pace", "Care", "Curiosity", "Humour", "Focus", "Calm", "Nerve"] as const;
export type Trait = (typeof TRAITS)[number];
export type Traits = Record<Trait, number>;
/** An orb whose traits the app has not sent yet: every trait at its middle. */
export const NEUTRAL: Traits = { Pace: 10, Care: 10, Curiosity: 10, Humour: 10, Focus: 10, Calm: 10, Nerve: 10 };

export type Kind = "coffee" | "ideas" | "game" | "lesson";
/** Where it happens: a spot on the floor (its POI ids), or the teacher's desk for a lesson. */
export type Place = "coffee" | "cooler" | "bistro1" | "bistro2" | "pingpong" | "arcade" | "desk";

/** The office's day, where the home runs: from 07:00 to 22:30 (the floor's orbs sleep from 23:00). */
export const OPENS_MIN = 7 * 60;
export const CLOSES_MIN = 22 * 60 + 30;
export const inOfficeDay = (t: number): boolean => {
  const d = new Date(t);
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= OPENS_MIN && m < CLOSES_MIN;
};
/** The next opening (07:00) after `t`. */
export function nextOpening(t: number): number {
  const d = new Date(t);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7).getTime();
  return t < today ? today : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 7).getTime();
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** How two orbs' traits get on, from -1 (they rub) to 1 (they click); the same both ways. Like Humour and
 * like Pace click; Care and Curiosity that both have bring them together; a lot of Nerve against a lot of
 * Calm rubs, and so does a lot of Focus against a lot of Humour. Two middling orbs get on a little. */
export function compat(a: Traits, b: Traits): number {
  const like = (t: Trait, w: number): number => w * (1 - Math.abs(a[t] - b[t]) / 16);
  const both = (t: Trait, w: number): number => w * ((Math.min(a[t], b[t]) - 8) / 10);
  const over = (v: number): number => Math.max(0, (v - 11) / 7);
  const rub = (x: Trait, y: Trait, w: number): number => w * (over(a[x]) * over(b[y]) + over(b[x]) * over(a[y]));
  const v = like("Humour", 0.45) + like("Pace", 0.3) + both("Care", 0.3) + both("Curiosity", 0.2) - rub("Nerve", "Calm", 0.9) - rub("Focus", "Humour", 0.7) - 0.7;
  return clamp(Math.round(v * 1000) / 1000, -1, 1);
}

/** What a friendship is called, by its number. */
export type Word = "good friends" | "friendly" | "colleagues" | "some friction" | "don't get along";
export function wordOf(score: number): Word {
  return score >= 50 ? "good friends" : score >= 20 ? "friendly" : score > -20 ? "colleagues" : score > -50 ? "some friction" : "don't get along";
}

/** One pick, weighted. */
function weighted<T>(items: T[], weight: (t: T) => number, r: () => number): T {
  const ws = items.map((t) => Math.max(0.0001, weight(t)));
  let x = r() * ws.reduce((n, w) => n + w, 0);
  for (let i = 0; i < items.length; i++) if ((x -= ws[i]!) <= 0) return items[i]!;
  return items[items.length - 1]!;
}

/** Who meets: anyone with anyone; the sociable (Humour, Care, Pace) start more of them, a friend is a little
 * likelier to be the one met, and the last two do not meet again at once unless no one else is free. */
export function pickPair(free: string[], traits: (orb: string) => Traits, score: (a: string, b: string) => number, last: readonly [string, string] | null, r: () => number): [string, string] | null {
  if (free.length < 2) return null;
  const a = weighted(free, (o) => {
    const t = traits(o);
    return 1 + (t.Humour + t.Care + t.Pace) / 30;
  }, r);
  const same = (x: string): boolean => Boolean(last && last.includes(a) && last.includes(x));
  const others = free.filter((x) => x !== a && !same(x));
  const pool = others.length ? others : free.filter((x) => x !== a);
  const b = weighted(pool, (x) => 1 + Math.max(0, score(a, x)) / 50, r);
  return [a, b];
}

/** What two orbs do together: coffee and a talk, ideas about their work, a game, or (friends, when one has
 * a lesson the other lacks) a lesson. */
export function pickKind(a: Traits, b: Traits, o: { lesson: boolean; score: number }, r: () => number): Kind {
  const avg = (t: Trait): number => (a[t] + b[t]) / 2;
  const kinds: [Kind, number][] = [
    ["coffee", 2 + (avg("Pace") - 10) * 0.1 + (avg("Care") - 10) * 0.05],
    ["ideas", 1.5 + (avg("Curiosity") - 10) * 0.15],
    ["game", 1 + (avg("Humour") - 10) * 0.15 + (avg("Nerve") - 10) * 0.05],
  ];
  if (o.lesson && o.score >= 20) kinds.push(["lesson", 1.5]);
  return weighted(kinds, ([, w]) => w, r)[0];
}

export function placeOf(kind: Kind, r: () => number): Place {
  if (kind === "coffee") return r() < 0.6 ? "coffee" : "cooler";
  if (kind === "ideas") return r() < 0.5 ? "bistro1" : "bistro2";
  if (kind === "game") return r() < 0.7 ? "pingpong" : "arcade";
  return "desk";
}

/** Who wins a game: a coin weighed a little by Pace and Focus. */
export function winnerOf(a: string, b: string, ta: Traits, tb: Traits, r: () => number): string {
  const edge = ((ta.Pace + ta.Focus) - (tb.Pace + tb.Focus)) / 40;
  return r() < clamp(0.5 + edge, 0.2, 0.8) ? a : b;
}

/** How one meeting moves a friendship: each kind of time together a little, more the better they get on,
 * less (or the other way) the worse; a game lost by an orb with little Humour and a lot of Nerve stings. */
export function deltaOf(kind: Kind, c: number, o: { loser?: Traits } = {}, r: () => number = () => 0.5): number {
  const base = { coffee: 3, ideas: 4, game: 3, lesson: 5 }[kind];
  let d = base * (0.4 + c) + c * 5 + (r() * 4 - 2);
  if (kind === "game" && o.loser) d -= Math.max(0, (o.loser.Nerve - 10) * 0.35 - (o.loser.Humour - 10) * 0.25);
  return Math.round(d);
}

/** A friendship's number, kept between -100 and 100. */
export const clampScore = (n: number): number => clamp(Math.round(n), -100, 100);

/** Whether traits sent by the app are the seven, each a number in reach. */
export function readTraits(v: unknown): Traits | null {
  if (!v || typeof v !== "object") return null;
  const out = {} as Traits;
  for (const t of TRAITS) {
    const n = (v as Record<string, unknown>)[t];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 40) return null;
    out[t] = Math.round(n * 10) / 10;
  }
  return out;
}
