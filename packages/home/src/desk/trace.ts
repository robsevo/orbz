// On-chain investigations, by code (PLAN 5.42; owner, 10-12: "investigate where we lead them (can be a pump coin or 5
// or how many we ask it) and investigate like ZachXBT does ... we want to be able to notice patterns ... use it to our
// advantage to see how logically we can make money off coins. Patterns people dont usually see"). What a case is made
// of and what is read off it: the money as a graph (who sent what to whom, how often, when, with every transfer's
// signature), a coin's first hands (the buys in its launch's own slot and the few after it), wallets grouped by who
// funded them (an exchange's withdrawals never make strangers one group), wallets new on the day they bought, holders
// grouped the same way, groups that sold together, money that went round in a circle, the ways out to a busy wallet (an
// exchange, a bridge, a bot), the same wallets turning up in other coins, and what each pattern did to a coin's price
// in the cases before it. Then how it could be played: facts with their numbers, never advice. Pure, so a test holds
// it; trail.ts reads the chain, cases.ts keeps the case, trace-tools.ts says it in words.

/** One transfer read off a transaction: SOL or a coin (its mint), whole units. */
export type Move = { sig: string; at: number; slot: number; from: string; to: string; asset: string; amount: number };
/** What a wallet is in a case. */
export type Role = "deployer" | "funder" | "first" | "holder" | "pool" | "busy" | "exit" | "wallet";
export type Node = { address: string; roles: Role[]; label: string | null; coins: string[] };
/** Every transfer from one wallet to another of one asset, summed. */
export type Edge = { from: string; to: string; asset: string; amount: number; count: number; first: number; last: number; sigs: string[] };
export type Graph = { nodes: Node[]; edges: Edge[] };

/** The signatures kept on an edge (the first ones, the evidence a finding can cite). */
export const SIGS_KEPT = 12;

export const emptyGraph = (): Graph => ({ nodes: [], edges: [] });

/** A wallet in the graph, with a role, a coin it was seen in and a label added to what it had. */
export function withNode(g: Graph, address: string, o: { role?: Role; coin?: string; label?: string | null } = {}): Node {
  let n = g.nodes.find((x) => x.address === address);
  if (!n) g.nodes.push((n = { address, roles: [], label: null, coins: [] }));
  if (o.role && !n.roles.includes(o.role)) n.roles.push(o.role);
  if (o.coin && !n.coins.includes(o.coin)) n.coins.push(o.coin);
  if (o.label) n.label = o.label;
  return n;
}

/** Transfers added to the graph: each pair's moves of an asset summed on one edge, a transfer counted once (by its
 * signature and its ends), both wallets in the graph. */
export function withMoves(g: Graph, moves: readonly Move[], coin?: string): Graph {
  for (const m of moves) {
    if (m.from === m.to || !(m.amount > 0)) continue;
    withNode(g, m.from, { coin });
    withNode(g, m.to, { coin });
    let e = g.edges.find((x) => x.from === m.from && x.to === m.to && x.asset === m.asset);
    if (!e) g.edges.push((e = { from: m.from, to: m.to, asset: m.asset, amount: 0, count: 0, first: m.at, last: m.at, sigs: [] }));
    if (e.sigs.includes(m.sig)) continue; // the same transfer read twice
    e.amount += m.amount;
    e.count += 1;
    e.first = Math.min(e.first, m.at);
    e.last = Math.max(e.last, m.at);
    if (e.sigs.length < SIGS_KEPT) e.sigs.push(m.sig);
  }
  return g;
}

/** What a finding may cite: a transfer's signature on one of the case's edges, or a wallet in it. */
export function cited(g: Graph, evidence: readonly string[]): { known: string[]; unknown: string[] } {
  const sigs = new Set(g.edges.flatMap((e) => e.sigs));
  const wallets = new Set(g.nodes.map((n) => n.address));
  const known: string[] = [];
  const unknown: string[] = [];
  for (const x of evidence) (sigs.has(x) || wallets.has(x) ? known : unknown).push(x);
  return { known, unknown };
}

// ── a coin's launch ─────────────────────────────────────────────────────────────────────────────────────────────────
export type Buy = { wallet: string; sig: string; slot: number; at: number; tokens: number; sol: number };
export type Launch = {
  coin: string; deployer: string; sig: string; slot: number; at: number;
  /** its whole supply, whole units */
  supply: number;
  /** the buys read from the launch on (the deployer's own in the launch's transaction among them) */
  buys: Buy[];
  /** the pool its first buys bought from (pump.fun's curve), left out of every holder's count */
  pool: string | null;
  /** whether the read reached the coin's first transaction (a coin with more history than a read takes: no) */
  reachedStart: boolean;
};
/** The coin's first hands: whoever bought in the launch's own slot or the `slots` after it, what they took. */
export type FirstHands = { slots: number; wallets: string[]; buys: number; tokens: number; share: number; sol: number; deployerShare: number; inLaunchSlot: number };

export function firstHands(l: Launch, slots = 2): FirstHands {
  const early = l.buys.filter((b) => b.slot >= l.slot && b.slot <= l.slot + slots && b.wallet !== l.pool);
  const wallets = [...new Set(early.map((b) => b.wallet))];
  const tokens = early.reduce((n, b) => n + b.tokens, 0);
  const dev = early.filter((b) => b.wallet === l.deployer).reduce((n, b) => n + b.tokens, 0);
  return {
    slots, wallets, buys: early.length, tokens, share: l.supply > 0 ? tokens / l.supply : 0,
    sol: early.reduce((n, b) => n + b.sol, 0), deployerShare: l.supply > 0 ? dev / l.supply : 0,
    inLaunchSlot: new Set(early.filter((b) => b.slot === l.slot).map((b) => b.wallet)).size,
  };
}

// ── who funded whom ─────────────────────────────────────────────────────────────────────────────────────────────────
/** A wallet's first money in: who sent it, when, how much; when it was born (its first transaction); a wallet with
 * more history than a read takes is busy (an exchange's, a bot's, a program's), and its first money is not looked for. */
export type Funding = { wallet: string; funder: string | null; at: number | null; sig: string | null; sol: number; born: number | null; busy: boolean };
export type Cluster = { root: string; wallets: string[] };

/** Wallets grouped by who funded them: a wallet and its funder are one group, up the chain, unless the funder is busy
 * (or is in `services`): an exchange sends every customer their first SOL, and they are strangers. Groups of one are
 * left out; the largest first. */
export function clustersOf(fundings: readonly Funding[], services: ReadonlySet<string> = new Set()): Cluster[] {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(a, r);
    return r;
  };
  const busy = new Set([...fundings.filter((f) => f.busy).map((f) => f.wallet), ...services]);
  for (const f of fundings) {
    find(f.wallet);
    if (!f.funder || busy.has(f.funder)) continue;
    const a = find(f.wallet);
    const b = find(f.funder);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, Set<string>>();
  for (const f of fundings) {
    if (busy.has(f.wallet)) continue;
    const r = find(f.wallet);
    if (!groups.has(r)) groups.set(r, new Set());
    groups.get(r)!.add(f.wallet);
  }
  return [...groups].map(([root, w]) => ({ root, wallets: [...w].sort() })).filter((c) => c.wallets.length > 1).sort((a, b) => b.wallets.length - a.wallets.length || a.root.localeCompare(b.root));
}

/** The first hands that were new: born within `hours` before their first buy. */
export function freshOf(fundings: readonly Funding[], buys: readonly Buy[], hours = 24): string[] {
  const born = new Map(fundings.map((f) => [f.wallet, f.born]));
  const first = new Map<string, number>();
  for (const b of buys) first.set(b.wallet, Math.min(first.get(b.wallet) ?? Infinity, b.at));
  return [...first].filter(([w, at]) => {
    const b = born.get(w);
    return b !== null && b !== undefined && at - b >= 0 && at - b <= hours * 3_600_000;
  }).map(([w]) => w).sort();
}

// ── who holds it ────────────────────────────────────────────────────────────────────────────────────────────────────
export type Holding = { owner: string; tokens: number; pool: boolean };
export type Concentration = {
  holders: number;
  /** the ten largest holders' share of the supply, its pools left out */
  top10: number;
  /** what its pools hold */
  pools: number;
  /** each group's share (groups by who funded them, two or more holders), the largest first */
  groups: { root: string; wallets: string[]; share: number }[];
};

export function concentration(h: readonly Holding[], supply: number, clusters: readonly Cluster[]): Concentration {
  const wallets = h.filter((x) => !x.pool && x.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const share = (n: number): number => (supply > 0 ? n / supply : 0);
  const held = new Map(wallets.map((x) => [x.owner, x.tokens]));
  const groups = clusters.map((c) => {
    const inIt = c.wallets.filter((w) => held.has(w));
    return { root: c.root, wallets: inIt, share: share(inIt.reduce((n, w) => n + held.get(w)!, 0)) };
  }).filter((g) => g.wallets.length > 1).sort((a, b) => b.share - a.share);
  return {
    holders: wallets.length,
    top10: share(wallets.slice(0, 10).reduce((n, x) => n + x.tokens, 0)),
    pools: share(h.filter((x) => x.pool).reduce((n, x) => n + x.tokens, 0)),
    groups,
  };
}

// ── how they moved ──────────────────────────────────────────────────────────────────────────────────────────────────
export type Sell = { wallet: string; at: number; sig: string; tokens: number };
/** A group whose wallets sold within `windowMs` of each other: at least two of them, the sells of that window. */
export function soldTogether(sells: readonly Sell[], clusters: readonly Cluster[], windowMs = 60_000): { root: string; wallets: string[]; from: number; to: number; sigs: string[] }[] {
  const out: { root: string; wallets: string[]; from: number; to: number; sigs: string[] }[] = [];
  for (const c of clusters) {
    const s = sells.filter((x) => c.wallets.includes(x.wallet)).sort((a, b) => a.at - b.at);
    let best: Sell[] = [];
    for (let i = 0; i < s.length; i++) {
      const win = s.filter((x) => x.at >= s[i]!.at && x.at - s[i]!.at <= windowMs);
      if (new Set(win.map((x) => x.wallet)).size > new Set(best.map((x) => x.wallet)).size) best = win;
    }
    const wallets = [...new Set(best.map((x) => x.wallet))].sort();
    if (wallets.length > 1) out.push({ root: c.root, wallets, from: best[0]!.at, to: best.at(-1)!.at, sigs: best.map((x) => x.sig) });
  }
  return out;
}

/** Money that went from one wallet to another and back, about as much each way (within `tolerance`): volume made, not
 * traded. A pool or a busy wallet at either end is a trade (a coin bought from a pool and sold back to it), not a circle. */
export function roundTrips(g: Graph, tolerance = 0.1): { a: string; b: string; asset: string; there: number; back: number }[] {
  const out: { a: string; b: string; asset: string; there: number; back: number }[] = [];
  const market = new Set(g.nodes.filter((n) => n.roles.some((r) => r === "pool" || r === "busy" || r === "exit")).map((n) => n.address));
  for (const e of g.edges) {
    if (e.from > e.to || market.has(e.from) || market.has(e.to)) continue; // each pair once; a pool's is a trade
    const back = g.edges.find((x) => x.from === e.to && x.to === e.from && x.asset === e.asset);
    if (!back) continue;
    const big = Math.max(e.amount, back.amount);
    if (big > 0 && Math.abs(e.amount - back.amount) / big <= tolerance) out.push({ a: e.from, b: e.to, asset: e.asset, there: e.amount, back: back.amount });
  }
  return out;
}

/** The ways money left `from` for a busy wallet or one labelled a way out, at most `hops` transfers away, the shortest
 * first: each a list of wallets, the first `from`, the last the way out. Never through a pool: a pool is where a trade
 * happens, not a hop in anyone's trail (10-12, a live coin: one bot's buy and another's through the curve read as 51
 * ways out). */
export function waysOut(g: Graph, from: string, hops = 4): string[][] {
  const role = (a: string, r: Role): boolean => !!g.nodes.find((x) => x.address === a)?.roles.includes(r);
  const isOut = (a: string): boolean => role(a, "busy") || role(a, "exit");
  const out: string[][] = [];
  const seen = new Set([from]);
  let level: string[][] = [[from]];
  for (let h = 0; h < hops && level.length; h++) {
    const next: string[][] = [];
    for (const path of level) {
      for (const e of g.edges.filter((x) => x.from === path.at(-1))) {
        if (seen.has(e.to) || role(e.to, "pool")) continue;
        const p = [...path, e.to];
        if (isOut(e.to)) out.push(p);
        else next.push(p);
        seen.add(e.to);
      }
    }
    level = next;
  }
  return out;
}

// ── across cases ────────────────────────────────────────────────────────────────────────────────────────────────────
/** A wallet's part in a coin, as a case found it. */
export type Part = { coin: string; address: string; role: Role };
/** The wallets that turned up in more than one coin (as its deployer, a funder, one of its first hands or a holder),
 * the most coins first: the same hands at work again. */
export function repeats(parts: readonly Part[]): { address: string; coins: string[]; roles: Role[] }[] {
  const by = new Map<string, { coins: Set<string>; roles: Set<Role> }>();
  for (const p of parts) {
    if (p.role === "busy" || p.role === "pool" || p.role === "wallet") continue; // an exchange or a pool is in every coin
    if (!by.has(p.address)) by.set(p.address, { coins: new Set(), roles: new Set() });
    by.get(p.address)!.coins.add(p.coin);
    by.get(p.address)!.roles.add(p.role);
  }
  return [...by].filter(([, v]) => v.coins.size > 1).map(([address, v]) => ({ address, coins: [...v.coins].sort(), roles: [...v.roles].sort() }))
    .sort((a, b) => b.coins.length - a.coins.length || a.address.localeCompare(b.address));
}

// ── the patterns, named ─────────────────────────────────────────────────────────────────────────────────────────────
/** The patterns a coin is checked for, each by a line of code below (the thresholds are the desk's own, said with
 * every pattern so they can be argued with). */
export const PATTERNS = {
  bundled: "its first hands took 20% or more of the supply in the launch's first slots",
  devHeavy: "its deployer bought 5% or more of the supply in the launch",
  oneFunder: "one group of wallets funded from one place holds 10% or more",
  fresh: "half or more of its first hands were wallets born the same day",
  devSold: "its deployer sold half or more of what it bought",
  soldTogether: "a group funded from one place sold within a minute",
  roundTrips: "money went round in a circle between two wallets",
  cashOut: "money from its deployer or its first hands reached a busy wallet (an exchange, a bridge, a bot)",
  seenBefore: "its deployer, a funder or one of its first hands turned up in another coin",
  spread: "its supply is spread: no group over 5%, its first hands under 10%",
} as const;
export type Pattern = keyof typeof PATTERNS;

/** What a coin's case found, as the patterns read it. */
export type CoinFacts = {
  coin: string;
  first?: FirstHands;
  fresh?: number; // how many of the first hands were new
  concentration?: Concentration;
  devSoldShare?: number | null; // of what the deployer bought, how much it sold
  soldTogether?: number; // groups that sold within a minute
  roundTrips?: number;
  cashOut?: number; // busy wallets the deployer's and the first hands' money reached
  seenBefore?: number; // wallets of its launch seen in other coins
};

export function patternsOf(f: CoinFacts): Pattern[] {
  const out: Pattern[] = [];
  const top = f.concentration?.groups[0]?.share ?? 0;
  if (f.first && f.first.share >= 0.2) out.push("bundled");
  if (f.first && f.first.deployerShare >= 0.05) out.push("devHeavy");
  if (top >= 0.1) out.push("oneFunder");
  if (f.first && f.fresh !== undefined && f.first.wallets.length >= 2 && f.fresh / f.first.wallets.length >= 0.5) out.push("fresh");
  if (f.devSoldShare !== undefined && f.devSoldShare !== null && f.devSoldShare >= 0.5) out.push("devSold");
  if ((f.soldTogether ?? 0) > 0) out.push("soldTogether");
  if ((f.roundTrips ?? 0) > 0) out.push("roundTrips");
  if ((f.cashOut ?? 0) > 0) out.push("cashOut");
  if ((f.seenBefore ?? 0) > 0) out.push("seenBefore");
  if (f.first && f.concentration && top <= 0.05 && f.first.share < 0.1) out.push("spread");
  return out;
}

/** What each pattern did before: over the cases that found it, how the coin's price moved from the case's opening to
 * now (the median, how many fell, how many), and the same over the cases without it. */
export type Outcome = { patterns: readonly Pattern[]; change: number | null };
export type Track = { pattern: Pattern; n: number; median: number | null; fell: number; without: { n: number; median: number | null } };

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function trackRecord(cases: readonly Outcome[]): Track[] {
  const priced = cases.filter((c): c is { patterns: readonly Pattern[]; change: number } => c.change !== null && Number.isFinite(c.change));
  return (Object.keys(PATTERNS) as Pattern[]).map((p) => {
    const w = priced.filter((c) => c.patterns.includes(p)).map((c) => c.change);
    const wo = priced.filter((c) => !c.patterns.includes(p)).map((c) => c.change);
    return { pattern: p, n: w.length, median: median(w), fell: w.filter((x) => x < 0).length, without: { n: wo.length, median: median(wo) } };
  }).filter((t) => t.n > 0);
}

// ── how it could be played ──────────────────────────────────────────────────────────────────────────────────────────
/** A lean: what the facts point to, with their numbers. `wary`: supply that can be sold into you; `timing`: when it
 * moved before; `follow`: wallets worth watching; `edge`: a track record that says more than a guess. */
export type Lean = { kind: "wary" | "timing" | "follow" | "edge"; words: string };

const pc = (x: number): string => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

export function leansOf(f: CoinFacts, o: { track?: readonly Track[]; followers?: readonly { address: string; coins: string[] }[] } = {}): Lean[] {
  const out: Lean[] = [];
  const pats = patternsOf(f);
  if (f.first && pats.includes("bundled")) out.push({ kind: "wary", words: `${f.first.wallets.length} wallets took ${pc(f.first.share)} of the supply in the launch's first ${f.first.slots + 1} slots: that supply was bought at the floor and can be sold into any rise.` });
  const top = f.concentration?.groups[0];
  if (top && pats.includes("oneFunder")) out.push({ kind: "wary", words: `${top.wallets.length} holders funded from one place (${top.root.slice(0, 6)}…) hold ${pc(top.share)}: one hand can move it.` });
  if (pats.includes("fresh") && f.first) out.push({ kind: "wary", words: `${f.fresh} of its ${f.first.wallets.length} first hands were born the day they bought: wallets made for this coin, not people finding it.` });
  if (pats.includes("devSold")) out.push({ kind: "timing", words: `its deployer has already sold ${pc(f.devSoldShare!)} of what it bought: the launch's own money is leaving.` });
  if (pats.includes("soldTogether")) out.push({ kind: "timing", words: `${f.soldTogether} group${f.soldTogether === 1 ? "" : "s"} funded from one place sold within a minute: watch for that group selling again.` });
  if (pats.includes("cashOut")) out.push({ kind: "timing", words: `money from its launch already reached ${f.cashOut} busy wallet${f.cashOut === 1 ? "" : "s"} (an exchange, a bridge, a bot): cashing out has begun.` });
  for (const w of o.followers ?? []) out.push({ kind: "follow", words: `${w.address.slice(0, 6)}… was among the first hands of ${w.coins.length} coins the desk has looked into: what it buys next is worth a look before anyone else sees it.` });
  for (const t of o.track ?? []) {
    if (!pats.includes(t.pattern) || t.n < 3 || t.median === null) continue;
    out.push({ kind: "edge", words: `in ${t.n} earlier cases where ${PATTERNS[t.pattern]}, the price moved ${t.median >= 0 ? "+" : ""}${(t.median * 100).toFixed(0)}% (median) from the case's opening, ${t.fell} of them down${t.without.n ? `; without it, ${t.without.median === null ? "n/a" : `${t.without.median >= 0 ? "+" : ""}${(t.without.median * 100).toFixed(0)}%`} over ${t.without.n}` : ""}.` });
  }
  if (pats.includes("spread")) out.push({ kind: "edge", words: "its supply is spread (no group over 5%, its first hands under 10%): what moves it is buyers, not one hand." });
  return out;
}
