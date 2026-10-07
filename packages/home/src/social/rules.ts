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

// ── moments: small run-ins between two orbs (owner, 10-07: "more micro interactions and situations between orbs that
// affect friendships that affect their mood in office, but not too many ... lively pace please, but goofy and funny as
// well. fun to watch") ─────────────────────────────────────────────────────────────────────────────
// A moment is a few seconds: two lines said, a gesture each, a point or two on their friendship, which way decided by
// how they get on and by the one it happened to. By code; the lines are ours, never a model's.

export type MomentKind = "bump" | "highfive" | "cookie" | "joke" | "mug" | "sticky" | "trip" | "dance";
/** Where a moment happens: in an aisle between two desks, in the kitchen, or at the first one's desk. */
export type MomentPlace = "aisle" | "kitchen" | "desk";
/** How it went: warm (both glad), flat (it fell flat, or it stung). */
export type MomentTone = "warm" | "flat";
export type Moment = { kind: MomentKind; place: MomentPlace; tone: MomentTone; lines: [string, string]; gestures: [string, string]; delta: number };

type Script = { place: MomentPlace; warm: [string, string][]; flat: [string, string][]; gestures: { warm: [string, string]; flat: [string, string] }; weight: (a: Traits, b: Traits) => number; lands: (a: Traits, b: Traits, c: number) => number };
const SCRIPTS: Record<MomentKind, Script> = {
  bump: {
    place: "aisle",
    warm: [["Oops! After you.", "No, after you!"], ["Beep beep!", "Traffic jam in Build again."], ["Whoa, nearly!", "Ha, we need indicators."]],
    flat: [["Watch it!", "You walked into me!"], ["Excuse me.", "...Hmph."]],
    gestures: { warm: ["squish", "wiggle"], flat: ["pout", "pout"] },
    weight: (a, b) => 1 + (a.Pace + b.Pace) / 20,
    lands: (a, b, c) => 0.55 + c * 0.6 + (b.Calm - 10) * 0.03,
  },
  highfive: {
    place: "aisle",
    warm: [["Up top!", "Yes!"], ["Nice work today!", "You too!"]],
    flat: [["Up top!", "...Oh. Sorry, hands full."], ["High five?", "Maybe later."]],
    gestures: { warm: ["hop", "hop"], flat: ["hop", "squish"] },
    weight: (a, b) => 0.6 + (a.Humour + b.Care) / 20,
    lands: (a, b, c) => 0.75 + c * 0.5,
  },
  cookie: {
    place: "kitchen",
    warm: [["Last cookie. Half each?", "Deal!"], ["You have it.", "No, you!"]],
    flat: [["Mine! Last one.", "Hey! I had my eye on that."], ["Who ate all the cookies?", "...Not me. (crumbs)"]],
    gestures: { warm: ["hop", "nod"], flat: ["wiggle", "pout"] },
    weight: (a, b) => 0.8 + (a.Humour + b.Humour) / 40,
    lands: (a, b, c) => 0.5 + c * 0.6 + (a.Care - 10) * 0.04,
  },
  joke: {
    place: "desk",
    warm: [["Why did the orb cross the office? The other desk had snacks.", "Ha! Stealing that."], ["I'm not lazy, I'm on energy-saving mode.", "Same."]],
    flat: [["Knock knock.", "...We're working."], ["Get it? Orb-ital?", "Tough crowd, huh."]],
    gestures: { warm: ["wiggle", "jelly"], flat: ["wink", "doze"] },
    weight: (a) => 0.6 + a.Humour / 10,
    lands: (a, b, c) => 0.45 + c * 0.6 + (b.Humour - 10) * 0.05 - (b.Focus - 10) * 0.02,
  },
  mug: {
    place: "kitchen",
    warm: [["Has anyone seen my mug?", "It's in your hand."], ["Who took my mug?", "Sorry! Washed it for you."]],
    flat: [["That's my mug.", "It was in the sink!"]],
    gestures: { warm: ["look", "nod"], flat: ["pout", "squish"] },
    weight: (a, b) => 0.5 + (b.Care - 10) * 0.03,
    lands: (a, b, c) => 0.7 + c * 0.4 + (a.Calm - 10) * 0.03,
  },
  sticky: {
    place: "desk",
    warm: [["Who put a sticky note on my screen?", "It says 'you're doing great'!"], ["A note on my desk!", "Drink some water, it says."]],
    flat: [["Who put a sticky note on my screen?", "...It says 'boo'."]],
    gestures: { warm: ["hop", "wink"], flat: ["pout", "wink"] },
    weight: (a, b) => 0.4 + (b.Humour + b.Care) / 40,
    lands: (a, b, c) => 0.6 + c * 0.5 + (b.Care - 10) * 0.04,
  },
  trip: {
    place: "aisle",
    warm: [["Whoa—!", "You OK? Very graceful."], ["The beanbag got me again.", "It's a menace."]],
    flat: [["Whoa—!", "Ha! Did you see that?"]],
    gestures: { warm: ["squish", "nod"], flat: ["squish", "wiggle"] },
    weight: (a) => 0.4 + (20 - a.Calm) / 40,
    lands: (a, b, c) => 0.65 + c * 0.4 + (b.Care - 10) * 0.05,
  },
  dance: {
    place: "kitchen",
    warm: [["This song is a bop.", "Kitchen disco!"], ["Coffee's ready! Little dance.", "Joining in."]],
    flat: [["This song is a bop.", "Please, no dancing in the kitchen."]],
    gestures: { warm: ["jelly", "wiggle"], flat: ["jelly", "doze"] },
    weight: (a, b) => 0.3 + (a.Humour + b.Humour + a.Nerve) / 60,
    lands: (a, b, c) => 0.5 + c * 0.6 + (b.Humour - 10) * 0.05,
  },
};
export const MOMENT_KINDS = Object.keys(SCRIPTS) as MomentKind[];

/** A moment between `a` (it starts it) and `b`: which, where, how it went, the lines, the gestures and the friendship's
 * change (warm +1 to +3, more the better they get on; flat -1 to -2). */
export function pickMoment(a: Traits, b: Traits, r: () => number): Moment {
  const c = compat(a, b);
  const kind = weighted(MOMENT_KINDS, (k) => Math.max(0.05, SCRIPTS[k].weight(a, b)), r);
  const s = SCRIPTS[kind];
  const tone: MomentTone = r() < clamp(s.lands(a, b, c), 0.1, 0.95) ? "warm" : "flat";
  const pool = tone === "warm" ? s.warm : s.flat;
  const lines = pool[Math.floor(r() * pool.length)]!;
  const delta = tone === "warm" ? clamp(Math.round(1 + c * 2 + r()), 1, 3) : -clamp(Math.round(1 + r()), 1, 2);
  return { kind, place: s.place, tone, lines, gestures: s.gestures[tone], delta };
}
