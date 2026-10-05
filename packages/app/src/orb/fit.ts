// Who would suit the team (owner, 10-05: "recruiter should also be able to show the orbs profile when we
// click on it, and which ones would best suit our team by rank"). An applicant's fit, 0 to 100, from what
// it is made of against the office as it is, by code (rule 8: never a model's opinion):
//   - what it brings (45): the skills it leans toward further than anyone in the office already does;
//   - how it complements (35): strong where the team's traits run low, and the other way round (the
//     angle between its traits and the team's, each from the even 10 every trait would have);
//   - harmony (10): a part of it against its own nature (a clash) costs a little;
//   - its rank (10): the first of its kind starts as the Senior and leads that work; a Junior less.
// Pure, so a test can import it (node --test cannot import .tsx).
import { TOTAL, TRAITS } from "./dna.ts";
import { sheetOf, type Character } from "./spec.ts";

export type Fit = { score: number; why: string[]; brings: { skill: string; by: number }[] };
export type Ranked<T> = { item: T; fit: Fit; rank: number };

const EVEN = TOTAL / TRAITS.length; // 10: every trait the same
const W = { brings: 45, complements: 35, harmony: 10, rank: 10 } as const;

const traitsOf = (c: Character): number[] => sheetOf(c).traits.map((t) => t.value);

/** How well `c` would suit the office `team`, starting as `startsAs`. */
export function fitOf(c: Character, team: Character[], startsAs: "Senior" | "Junior" | string): Fit {
  const sh = sheetOf(c);
  const mine = sh.leans;
  // the most any orb in the office leans to each skill (nothing, with no one there)
  const best = new Map<string, number>();
  for (const o of team) for (const l of sheetOf(o).leans) best.set(l.name, Math.max(best.get(l.name) ?? 0, l.value));
  const brings = mine.map((l) => ({ skill: l.name, by: Math.round(Math.max(0, l.value - (best.get(l.name) ?? 0)) * 10) / 10 })).filter((b) => b.by > 0).sort((a, b) => b.by - a.by);
  const bring = brings.reduce((n, b) => n + b.by, 0) / mine.reduce((n, l) => n + l.value, 0);

  // its traits against the team's average, each as a lean away from the even 10
  const me = traitsOf(c).map((v) => v - EVEN);
  const avg = TRAITS.map((_, i) => (team.length ? team.reduce((n, o) => n + traitsOf(o)[i]!, 0) / team.length : EVEN) - EVEN);
  const dot = me.reduce((n, v, i) => n + v * avg[i]!, 0);
  const len = (v: number[]): number => Math.hypot(...v);
  const cos = len(me) && len(avg) ? dot / (len(me) * len(avg)) : 0; // no lean either way: neither like nor unlike
  const complement = (1 - cos) / 2;

  const clashes = sh.dna.moves.filter((m) => m.clash).length;
  const harmony = 1 - Math.min(1, clashes / 4);
  const lead = startsAs === "Senior" ? 1 : 0.4;

  // new skills worth 40% of its 24 points is as much as an applicant brings to an office that has someone
  const score = Math.round(W.brings * Math.min(1, bring / 0.4) + W.complements * complement + W.harmony * harmony + W.rank * lead);

  // why, in a few words each: the biggest of what it brings, where it fills a gap, its rank, a clash
  const why: string[] = [];
  if (!team.length) why.push("no one in the office yet to measure against");
  else if (brings.length && brings[0]!.by >= 0.5) why.push(`brings ${list(brings.filter((b) => b.by >= 0.5).slice(0, 2).map((b) => b.skill))} your team is light on`);
  else why.push("its skills your team already has");
  const gap = TRAITS.map((t, i) => ({ t, mine: me[i]!, team: avg[i]! })).filter((x) => x.mine > 1 && x.team < 0).sort((a, b) => b.mine - b.team - (a.mine - a.team))[0];
  if (team.length && gap) why.push(`strong in ${gap.t}, where your team runs low`);
  if (startsAs === "Senior") why.push("would lead its kind of work as the Senior");
  if (clashes) why.push(clashes === 1 ? "one clash in its make-up" : `${clashes} clashes in its make-up`);
  return { score, why, brings };
}

/** Everyone ranked, the best fit first (a tie keeps the order they came in). */
export function ranked<T>(items: T[], fit: (t: T) => Fit): Ranked<T>[] {
  return items
    .map((item, i) => ({ item, fit: fit(item), i }))
    .sort((a, b) => b.fit.score - a.fit.score || a.i - b.i)
    .map(({ item, fit }, i) => ({ item, fit, rank: i + 1 }));
}

const list = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
