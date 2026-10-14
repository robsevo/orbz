// A team's chemistry (PLAN 5.47; owner, 10-14: "how friendships around the office help orbz better work together and
// match together"), pure: how the orbs you bring into a session get on, from the home's friendships (PLAN 5.9, `/social`).
// Every two of them, an orb not met yet counting as colleagues; the team's mean says its word; the best and worst pairs
// say why. And for each orb not chosen yet, how it gets on with those already chosen: a friend to bring along, or a
// friction to think twice about. The home's own matching (org.ts `whoFits`) weighs the same friendships when it deals a
// session's rows.
export type FriendshipRow = { a: string; b: string; score: number };
export type ChemistryWord = "Great chemistry" | "Good chemistry" | "Mixed" | "Friction";
export type Pair = { a: string; b: string; score: number; word: string };
export type Chemistry = { score: number; word: ChemistryWord; best: Pair | null; worst: Pair | null; pairs: Pair[] };

export const chemistryWord = (n: number): ChemistryWord => (n >= 40 ? "Great chemistry" : n >= 15 ? "Good chemistry" : n > -15 ? "Mixed" : "Friction");
/** A friendship's word, as the home says it (social/rules.ts `wordOf`). */
export const pairWord = (s: number): string => (s >= 50 ? "good friends" : s >= 20 ? "friendly" : s > -20 ? "colleagues" : s > -50 ? "some friction" : "don't get along");

export function scoreOf(rows: readonly FriendshipRow[], x: string, y: string): number {
  return rows.find((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x))?.score ?? 0;
}

/** The team's chemistry; null for fewer than two. */
export function chemistryOf(rows: readonly FriendshipRow[], team: readonly string[]): Chemistry | null {
  if (team.length < 2) return null;
  const pairs: Pair[] = [];
  for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
    const s = scoreOf(rows, team[i]!, team[j]!);
    pairs.push({ a: team[i]!, b: team[j]!, score: s, word: pairWord(s) });
  }
  const score = Math.round(pairs.reduce((n, p) => n + p.score, 0) / pairs.length);
  const sorted = [...pairs].sort((p, q) => q.score - p.score);
  const best = sorted[0]!.score >= 20 ? sorted[0]! : null;
  const worst = sorted.at(-1)!.score <= -20 ? sorted.at(-1)! : null;
  return { score, word: chemistryWord(score), best, worst, pairs };
}

/** How an orb not chosen yet gets on with those chosen: its best friend among them, or its worst friction; null when
 * it is colleagues with them all. */
export function hintFor(rows: readonly FriendshipRow[], orb: string, chosen: readonly string[]): { with: string; score: number; word: string } | null {
  const others = chosen.filter((c) => c !== orb).map((c) => ({ with: c, score: scoreOf(rows, orb, c) }));
  if (!others.length) return null;
  const worst = others.reduce((m, o) => (o.score < m.score ? o : m));
  if (worst.score <= -20) return { ...worst, word: pairWord(worst.score) };
  const best = others.reduce((m, o) => (o.score > m.score ? o : m));
  return best.score >= 20 ? { ...best, word: pairWord(best.score) } : null;
}
