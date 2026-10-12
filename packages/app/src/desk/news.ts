// The news screen's arithmetic (PLAN 5.43), pure: the filters a list of stories offers (the coins and kinds in it, the
// most first), a filter applied, a move said. NewsDesk.tsx draws it.
import type { NewsStory } from "../home/link.ts";

export type NewsFilter = { kind: "all" } | { kind: "moving" } | { kind: "coin"; coin: string } | { kind: "type"; type: string };
/** What "could move it" means on the screen: a kind that has tended to move prices (the home's weight 3 and up). */
export const MOVING = 3;

/** The words for each kind of news, as a chip says them. */
export const KIND_WORDS: Record<string, string> = { regulation: "Regulation", lawsuit: "Court", etf: "ETF", hack: "Hack", macro: "Macro", listing: "Listing", unlock: "Unlock", buyer: "Big buyer", outage: "Outage", liquidations: "Liquidations" };

/** The coins and the kinds the stories hold, each with how many, the most first (ties in their first story's order). */
export function facets(items: readonly NewsStory[]): { coins: [string, number][]; kinds: [string, number][] } {
  const count = (keys: string[][]): [string, number][] => {
    const m = new Map<string, number>();
    for (const ks of keys) for (const k of ks) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  return { coins: count(items.map((x) => x.coins)), kinds: count(items.map((x) => x.kinds)) };
}

export function filtered(items: readonly NewsStory[], f: NewsFilter): NewsStory[] {
  switch (f.kind) {
    case "all": return [...items];
    case "moving": return items.filter((x) => x.weight >= MOVING);
    case "coin": return items.filter((x) => x.coins.includes(f.coin));
    case "type": return items.filter((x) => x.kinds.includes(f.type));
  }
}

/** A move since a story, as a chip says it: its sign, one decimal. */
export const moveWords = (m: number): string => `${m >= 0 ? "+" : "−"}${Math.abs(m * 100).toFixed(1)}%`;
