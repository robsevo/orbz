// The desk's investigations, as tools (PLAN 5.42; owner, 10-12: "add investigator ... investigate where we lead them
// (can be a pump coin or 5 or how many we ask it) and investigate like ZachXBT does ... notice patterns ... use it to our
// advantage to see how logically we can make money off coins. Patterns people dont usually see. Things we notice too";
// "If its a career slot we already have, just add that logic to one of the crypto ... jobs": the on-chain job's).
// A case is opened on the coins (`open_case`); each coin's launch is read (`trace_launch`: who deployed it, who funded
// them and from where, who bought in its first slots and how much they took, which of them were born that day), its
// holders (`trace_holders`: grouped by who funded them, each group's share), any wallet followed (`trace_wallet`: where
// its money came from and went, its trades in the coin, the ways out to an exchange or a bridge); then the patterns
// (`case_patterns`: each coin's, by code, the same wallets across coins and across every case before, what each pattern
// did to prices before, and what you have noticed); findings kept only on the case's own evidence (`case_finding`),
// wallets labelled (`label_wallet`), and the write-up with how it could be played (`close_case`). The reading is
// trail.ts's, the arithmetic trace.ts's, the keeping casebook.ts's; here it is said in words. Solana's coins (pump.fun's
// among them); the EVM chains are not read yet, and say so.
import type { ToolDef, ToolResult } from "../agent/tools.ts";
import { GROUPS } from "../agent/groups.ts";
import { type Case, type CaseCoin, CaseError, type Casebook, MAX_COINS, partsOf, type Weight } from "./casebook.ts";
import { readTokenKey } from "./dex.ts";
import { BudgetSpent, Trail, isSolanaAddress } from "./trail.ts";
import {
  clustersOf, concentration, firstHands, freshOf, leansOf, PATTERNS, patternsOf, repeats, roundTrips, soldTogether, trackRecord, waysOut,
  withMoves, withNode, type Cluster, type Funding, type Outcome,
} from "./trace.ts";

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const fail = (e: unknown): ToolResult => ({ content: e instanceof Error ? e.message : String(e), isError: true });
const pc = (x: number): string => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const sol = (x: number): string => `${x < 10 ? x.toFixed(3) : x.toFixed(1)} SOL`;
const day = (t: number | null): string => (t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "unknown");
/** A wallet as words: its label if it has one, else its first and last four. */
export const short = (a: string, labels: ReadonlyMap<string, string> = new Map()): string => labels.get(a) ?? `${a.slice(0, 4)}…${a.slice(-4)}`;

/** What the work reads with: a chain reader for each step, the desk's labels, a coin's price now. */
export type Sleuth = { trail: () => Trail; labels: () => { names: Map<string, string>; exits: Set<string> }; priceOf: (key: string) => Promise<{ price: number | null; label: string | null }> };

function coinOf(c: Case, key: string): CaseCoin {
  const coin = c.coins.find((x) => x.key === key);
  if (!coin) throw new CaseError(`${key} is not in case ${c.id}: its coins are ${c.coins.map((x) => x.key).join(", ")}`);
  return coin;
}
function mintOf(key: string): string {
  const t = readTokenKey(key);
  if (!t) throw new CaseError(`${key} is not a coin as "solana:<mint>"`);
  if (t.chain !== "solana") throw new CaseError(`${key}: only Solana's coins are traced yet (the EVM chains need an indexer the desk does not have without a key)`);
  return t.address;
}
/** Every funding the case has read, of every coin. */
const fundingsOf = (c: Case): Funding[] => [...new Map(c.coins.flatMap((x) => x.fundings).map((f) => [f.wallet, f])).values()];

/** First money in for each wallet not read yet (up to `max`), each funder that funded two or more checked for busy;
 * the edges and roles added to the graph. */
async function fund(c: Case, coin: CaseCoin, wallets: readonly string[], trail: Trail, max: number): Promise<Funding[]> {
  const known = new Map(fundingsOf(c).map((f) => [f.wallet, f]));
  const got: Funding[] = [];
  for (const w of wallets.slice(0, max)) {
    let f = known.get(w);
    if (!f) {
      try {
        f = await trail.funding(w);
      } catch (e) {
        if (e instanceof BudgetSpent) break; // as far as this read's budget goes
        trail.unread += 1; // a wallet the chain would not give: skipped, and said
        continue;
      }
    }
    known.set(w, f);
    got.push(f);
  }
  const counts = new Map<string, number>();
  for (const f of known.values()) if (f.funder) counts.set(f.funder, (counts.get(f.funder) ?? 0) + 1);
  for (const [funder, n] of counts) {
    if (n < 2 || known.has(funder) || trail.calls >= trail.budget - 2) continue;
    if (await trail.busy(funder).catch(() => false)) {
      const f = { wallet: funder, funder: null, at: null, sig: null, sol: 0, born: null, busy: true };
      known.set(funder, f);
      got.push(f);
    }
  }
  for (const f of got) {
    if (!coin.fundings.some((x) => x.wallet === f.wallet)) coin.fundings.push(f);
    if (f.busy) withNode(c.graph, f.wallet, { role: "busy", coin: coin.key });
    if (f.funder && f.sig) {
      withMoves(c.graph, [{ sig: f.sig, at: f.at ?? 0, slot: 0, from: f.funder, to: f.wallet, asset: "SOL", amount: f.sol }], coin.key);
      withNode(c.graph, f.funder, { role: "funder", coin: coin.key });
    }
  }
  return got;
}

/** The groups by who funded them over everything the case read, a busy wallet or one labelled a way out never joining
 * strangers. */
const groupsOf = (c: Case, exits: ReadonlySet<string>): Cluster[] => clustersOf(fundingsOf(c), exits);

export async function readLaunch(c: Case, key: string, s: Sleuth): Promise<string> {
  const coin = coinOf(c, key);
  const mint = mintOf(key);
  const trail = s.trail();
  const { names, exits } = s.labels();
  const l = await trail.launch(key, mint, { pages: 10, slots: 2, maxTx: 30 });
  coin.launch = { deployer: l.deployer, sig: l.sig, slot: l.slot, at: l.at, pool: l.pool, supply: l.supply, reachedStart: l.reachedStart, txs: l.txs };
  const seen = new Set(coin.buys.map((b) => `${b.sig}:${b.wallet}`));
  for (const b of l.buys) if (!seen.has(`${b.sig}:${b.wallet}`)) coin.buys.push(b);
  for (const x of l.sells) if (!coin.sells.some((y) => y.sig === x.sig && y.wallet === x.wallet)) coin.sells.push(x);
  withMoves(c.graph, l.moves, key);
  const name = coin.label ?? short(mint);
  if (!l.reachedStart) {
    c.coins = c.coins.map((x) => (x.key === key ? coin : x));
    return `${name}: its history is longer than ${l.txs.toLocaleString("en-US")} transactions, so its launch was not reached and its deployer is not known from the chain alone. Read who holds it instead (trace_holders), and follow its largest holders (trace_wallet).`;
  }
  if (l.pool) withNode(c.graph, l.pool, { role: "pool", coin: key, label: "its pool" });
  withNode(c.graph, l.deployer, { role: "deployer", coin: key });
  const first = firstHands(l, 2);
  for (const w of first.wallets) if (w !== l.deployer) withNode(c.graph, w, { role: "first", coin: key });
  // the deployer and its first hands' first money in; the deployer's funder's own too (who is behind it)
  const fundings = await fund(c, coin, [l.deployer, ...first.wallets.filter((w) => w !== l.deployer)], trail, 13);
  const dev = fundings.find((f) => f.wallet === l.deployer);
  let up: Funding | null = null;
  if (dev?.funder && !exits.has(dev.funder) && !fundingsOf(c).some((f) => f.wallet === dev.funder && f.busy) && trail.calls < trail.budget - 4) {
    up = (await fund(c, coin, [dev.funder], trail, 1))[0] ?? null;
  }
  const fresh = freshOf(coin.fundings, l.buys.filter((b) => first.wallets.includes(b.wallet)));
  const groups = groupsOf(c, exits).map((g) => ({ ...g, wallets: g.wallets.filter((w) => first.wallets.includes(w)) })).filter((g) => g.wallets.length > 1);
  coin.facts = { ...(coin.facts ?? { coin: key }), coin: key, first, fresh: fresh.length };
  c.coins = c.coins.map((x) => (x.key === key ? coin : x));
  const lines = [
    `${name} (${key}) launched ${day(l.at)} UTC in slot ${l.slot}, deployed by ${short(l.deployer, names)} (signature ${l.sig}); ${l.pool ? `its first buys bought from ${short(l.pool)} (its pool)` : "no pool found in its creation"}. Supply ${Math.round(l.supply).toLocaleString("en-US")}.`,
    `Its first hands (its launch's slot and the 2 after): ${first.wallets.length} wallet${first.wallets.length === 1 ? "" : "s"}, ${first.buys} buys, ${pc(first.share)} of the supply for ${sol(first.sol)}; ${first.inLaunchSlot} bought in the launch's own slot; the deployer's own buy ${pc(first.deployerShare)}.`,
  ];
  if (first.wallets.length) lines.push(`  ${l.buys.filter((b) => first.wallets.includes(b.wallet)).sort((a, b) => b.tokens - a.tokens).slice(0, 12).map((b) => `${short(b.wallet, names)} ${pc(l.supply ? b.tokens / l.supply : 0)} (slot +${b.slot - l.slot}, ${b.sig.slice(0, 10)}…)`).join("; ")}`);
  const born = (f: Funding | undefined): string => (f?.born && f.at ? (Math.abs(f.at - f.born) < 60_000 ? ", the minute it was born" : `, born ${day(f.born)}`) : "");
  if (dev) lines.push(dev.busy ? `The deployer is busy (a thousand transactions in under two days or more history than a read takes): its first money in was not looked for.` : `The deployer's first money in: ${dev.funder ? `${sol(dev.sol)} from ${short(dev.funder, names)} at ${day(dev.at)}${born(dev)} (signature ${dev.sig})` : "not found in its first transactions"}${up?.funder ? `; that wallet's own: ${sol(up.sol)} from ${short(up.funder, names)} at ${day(up.at)}` : up?.busy ? "; that wallet is busy (an exchange, a bridge or a bot)" : ""}.`);
  lines.push(fresh.length ? `New wallets: ${fresh.length} of the ${first.wallets.length} first hands were born within a day before they bought (${fresh.slice(0, 8).map((w) => short(w, names)).join(", ")}).` : "None of the first hands read was born within a day before buying.");
  lines.push(groups.length ? `First hands funded from one place: ${groups.map((g) => `${short(g.root, names)} funded ${g.wallets.map((w) => short(w, names)).join(", ")}`).join("; ")}.` : "No two of the first hands share a funder (through no busy wallet).");
  const busy = coin.fundings.filter((f) => f.busy).map((f) => short(f.wallet, names));
  if (busy.length) lines.push(`Busy wallets (an exchange, a bridge or a bot; wallets they funded are not grouped): ${busy.join(", ")}.`);
  lines.push(`Read: ${l.read} of its transactions, ${coin.fundings.length} wallets' first money in${trail.unread ? ` (${trail.unread} wallet${trail.unread === 1 ? "" : "s"} the chain would not give)` : ""}; ${trail.calls} calls to the chain${trail.calls >= trail.budget ? ", its budget spent: read again for the rest" : ""}.`);
  return lines.join("\n");
}

export async function readHolders(c: Case, key: string, s: Sleuth): Promise<string> {
  const coin = coinOf(c, key);
  const mint = mintOf(key);
  const trail = s.trail();
  const { names, exits } = s.labels();
  const h = await trail.holders(mint, { top: 40 });
  coin.holders = { holdings: h.holdings, accounts: h.accounts, at: Date.now() };
  for (const x of h.holdings) withNode(c.graph, x.owner, { role: x.pool ? "pool" : "holder", coin: key });
  const wallets = h.holdings.filter((x) => !x.pool).map((x) => x.owner);
  await fund(c, coin, wallets, trail, 15);
  const groups = groupsOf(c, exits);
  const conc = concentration(h.holdings, h.supply, groups);
  coin.facts = { ...(coin.facts ?? { coin: key }), coin: key, concentration: conc };
  c.coins = c.coins.map((x) => (x.key === key ? coin : x));
  const first = new Set(coin.buys.filter((b) => coin.launch && b.slot <= coin.launch.slot + 2).map((b) => b.wallet));
  const role = (w: string): string => (w === coin.launch?.deployer ? " (its deployer)" : first.has(w) ? " (a first hand)" : "");
  const lines = [
    `${coin.label ?? short(mint)}: ${h.accounts.toLocaleString("en-US")} token accounts, ${conc.holders} of the largest read as wallets; its pools hold ${pc(conc.pools)}; the ten largest wallets ${pc(conc.top10)}.`,
    `The largest: ${h.holdings.filter((x) => !x.pool).slice(0, 10).map((x) => `${short(x.owner, names)} ${pc(h.supply ? x.tokens / h.supply : 0)}${role(x.owner)}`).join("; ")}.`,
    conc.groups.length ? `Holders funded from one place: ${conc.groups.slice(0, 5).map((g) => `${short(g.root, names)}'s ${g.wallets.length} hold ${pc(g.share)} (${g.wallets.slice(0, 6).map((w) => short(w, names)).join(", ")})`).join("; ")}.` : "No two of its largest holders share a funder (through no busy wallet).",
    `Read: ${coin.fundings.length} wallets' first money in${trail.unread ? ` (${trail.unread} the chain would not give)` : ""}; ${trail.calls} calls to the chain${trail.calls >= trail.budget ? ", its budget spent: read again for the rest" : ""}.`,
  ];
  return lines.join("\n");
}

export async function readWallet(c: Case, wallet: string, s: Sleuth, key?: string): Promise<string> {
  if (!isSolanaAddress(wallet)) throw new CaseError(`${wallet} is not a Solana address`);
  const trail = s.trail();
  const { names, exits } = s.labels();
  const coin = key ? coinOf(c, key) : null;
  const mint = key ? mintOf(key) : undefined;
  const fl = await trail.flows(wallet, { limit: 20, mint });
  withMoves(c.graph, fl.moves, key);
  withNode(c.graph, wallet, { coin: key });
  const host = coin ?? c.coins[0]!;
  const [f] = await fund(c, host, [wallet], trail, 1);
  // where its money went most: each checked for busy, so the ways out are found
  const sent = new Map<string, number>();
  for (const m of fl.moves) if (m.from === wallet && m.asset === "SOL") sent.set(m.to, (sent.get(m.to) ?? 0) + m.amount);
  const got = new Map<string, number>();
  for (const m of fl.moves) if (m.to === wallet && m.asset === "SOL") got.set(m.from, (got.get(m.from) ?? 0) + m.amount);
  const top = [...sent].sort((a, b) => b[1] - a[1]).slice(0, 4);
  for (const [to] of top) {
    if (exits.has(to)) withNode(c.graph, to, { role: "exit", label: names.get(to) ?? null });
    else if (trail.calls < trail.budget - 1 && (await trail.busy(to))) withNode(c.graph, to, { role: "busy" });
  }
  for (const x of c.graph.nodes) if (exits.has(x.address) && !x.roles.includes("exit")) withNode(c.graph, x.address, { role: "exit", label: names.get(x.address) ?? null });
  const lines = [`${short(wallet, names)}: ${f?.busy ? "busy (more history than a read takes: an exchange, a bridge or a bot)" : `first money in ${f?.funder ? `${sol(f.sol)} from ${short(f.funder, names)} at ${day(f.at)}` : "not found"}, born ${day(f?.born ?? null)}`}. Its last ${fl.read} transactions read.`];
  if (top.length) lines.push(`Sent most to: ${top.map(([to, n]) => `${short(to, names)} ${sol(n)}${c.graph.nodes.find((x) => x.address === to)?.roles.some((r) => r === "busy" || r === "exit") ? " (busy: a way out)" : ""}`).join("; ")}.`);
  const from = [...got].sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (from.length) lines.push(`Got most from: ${from.map(([w, n]) => `${short(w, names)} ${sol(n)}`).join("; ")}.`);
  if (coin && mint) {
    for (const b of fl.buys) if (!coin.buys.some((x) => x.sig === b.sig && x.wallet === b.wallet)) coin.buys.push(b);
    for (const x of fl.sells) if (!coin.sells.some((y) => y.sig === x.sig && y.wallet === x.wallet)) coin.sells.push(x);
    const bought = coin.buys.filter((b) => b.wallet === wallet).reduce((n, b) => n + b.tokens, 0);
    const soldN = coin.sells.filter((x) => x.wallet === wallet).reduce((n, x) => n + x.tokens, 0);
    if (wallet === coin.launch?.deployer && bought > 0) coin.facts = { ...(coin.facts ?? { coin: coin.key }), coin: coin.key, devSoldShare: Math.min(1, soldN / bought) };
    lines.push(`In ${coin.label ?? key}: bought ${Math.round(bought).toLocaleString("en-US")}, sold ${Math.round(soldN).toLocaleString("en-US")} (as read)${wallet === coin.launch?.deployer ? ": it is the deployer" : ""}.`);
  }
  const ways = waysOut(c.graph, wallet);
  if (ways.length) lines.push(`Ways out: ${ways.slice(0, 4).map((p) => p.map((w) => short(w, names)).join(" → ")).join("; ")}.`);
  lines.push(`${trail.calls} calls to the chain.`);
  return lines.join("\n");
}

/** Each coin's patterns and leans, the wallets this case's coins share, the same hands in earlier cases, what each pattern
 * did to prices before, and what you have noticed. */
export async function readPatterns(c: Case, book: Casebook, s: Sleuth, others: readonly Case[]): Promise<string> {
  const { names, exits } = s.labels();
  const groups = groupsOf(c, exits);
  const before = book.parts(c.id).filter((p) => !exits.has(p.address));
  const all = repeats([...before, ...c.coins.flatMap(partsOf)].filter((p) => !exits.has(p.address)));
  // the record: every earlier case's coins, their patterns then, their price now against their price at its opening
  const outcomes: Outcome[] = [];
  for (const o of others.slice(0, 12)) {
    for (const k of o.coins) {
      if (!k.facts || !k.priceAtOpen) continue;
      const now = (await s.priceOf(k.key).catch(() => ({ price: null, label: null }))).price;
      outcomes.push({ patterns: patternsOf(k.facts), change: now ? now / k.priceAtOpen - 1 : null });
    }
  }
  const track = trackRecord(outcomes);
  const lines: string[] = [];
  for (const k of c.coins) {
    const name = k.label ?? k.key;
    if (!k.facts) {
      lines.push(`${name}: not read yet (trace_launch, trace_holders).`);
      continue;
    }
    const mine = new Set(partsOf(k).map((p) => p.address));
    const first = new Set(k.facts.first?.wallets ?? []);
    // the busy wallets its launch's money reached (a first hand that is itself busy, a bot, is no one's way out)
    const busy = new Set(c.graph.nodes.filter((n) => n.roles.includes("busy") || n.roles.includes("exit")).map((n) => n.address));
    const out = new Set<string>();
    for (const w of [k.launch?.deployer, ...first]) if (w && !busy.has(w)) for (const p of waysOut(c.graph, w)) out.add(p.at(-1)!);
    const seen = all.filter((r) => mine.has(r.address) && r.coins.some((x) => x !== k.key));
    k.facts = {
      ...k.facts,
      soldTogether: soldTogether(k.sells, groups).length,
      roundTrips: roundTrips({ nodes: c.graph.nodes, edges: c.graph.edges.filter((e) => mine.has(e.from) || mine.has(e.to)) }).length,
      cashOut: out.size,
      seenBefore: seen.length,
    };
    const pats = patternsOf(k.facts);
    const followers = all.filter((r) => r.roles.includes("first") && first.has(r.address) && r.coins.length > 1);
    const leans = leansOf(k.facts, { track, followers });
    lines.push(`${name}: ${pats.length ? pats.map((p) => `${p} (${PATTERNS[p]})`).join("; ") : "none of the desk's patterns"}.`);
    for (const r of seen.slice(0, 6)) lines.push(`  ${short(r.address, names)} was ${r.roles.join(" and ")} in ${r.coins.filter((x) => x !== k.key).length} other coin${r.coins.length > 2 ? "s" : ""}: ${r.coins.filter((x) => x !== k.key).slice(0, 4).join(", ")}`);
    for (const l of leans) lines.push(`  ${l.kind}: ${l.words}`);
  }
  if (c.coins.length > 1) {
    const shared = repeats(c.coins.flatMap(partsOf).filter((p) => !exits.has(p.address)));
    lines.push(shared.length ? `Across this case's coins, the same wallets: ${shared.slice(0, 8).map((r) => `${short(r.address, names)} (${r.roles.join("/")}) in ${r.coins.length}`).join("; ")}.` : "Across this case's coins: no wallet in more than one (as read).");
  }
  if (track.length) lines.push(`The record (${outcomes.filter((x) => x.change !== null).length} earlier coins, price now against price at the case's opening): ${track.map((t) => `${t.pattern} ${t.n} coins, median ${t.median === null ? "n/a" : `${t.median >= 0 ? "+" : ""}${(t.median * 100).toFixed(0)}%`}, ${t.fell} down`).join("; ")}.`);
  else lines.push("No record yet: earlier cases with their coins read and priced make one.");
  const noticed = book.noticed();
  if (noticed.length) lines.push(`What the person has noticed before; check this case for each: ${noticed.map((n) => `"${n.words}"`).join("; ")}.`);
  book.save(c);
  return lines.join("\n");
}

export function traceTools(o: { book: Casebook; sleuth: Sleuth; nameOf: (orb: string) => string }): ToolDef[] {
  const { book, sleuth } = o;
  const g = GROUPS.trace;
  const caseOf = (a: Record<string, unknown>): Case => {
    const c = book.get(Number(a.case));
    if (!c) throw new CaseError(`no case ${String(a.case)}: open one (open_case)`);
    return c;
  };
  const coinParam = { type: "string", description: 'a coin as "solana:<mint>" (a pump.fun mint ends in "pump")' };
  return [
    {
      name: "open_case", group: g, label: "Opening a case", untrusted: "feed",
      description: `Opens a case on 1 to ${MAX_COINS} coins (Solana's, as "solana:<mint>") with the question you are answering. Then read each coin's launch (trace_launch) and holders (trace_holders), follow whatever looks off (trace_wallet) as far as it goes, check the patterns (case_patterns), keep each finding with its evidence (case_finding), and close it with your write-up and how it could be played (close_case).`,
      parameters: obj({ coins: { type: "array", items: coinParam, minItems: 1, maxItems: MAX_COINS }, question: { type: "string" }, title: { type: "string" } }, ["coins", "question"]),
      describe: (a) => `open a case on ${Array.isArray(a.coins) ? a.coins.length : 0} coin(s)`, decision: "allow",
      async run(a, ctx) {
        try {
          const coins = [];
          for (const k of (a.coins as string[]).map((x) => String(x).trim())) {
            mintOf(k);
            const p = await sleuth.priceOf(k).catch(() => ({ price: null, label: null }));
            coins.push({ key: k, label: p.label, price: p.price });
          }
          const c = book.open({ coins, question: String(a.question ?? ""), orb: ctx.orb, title: typeof a.title === "string" ? a.title : undefined });
          return { content: `Case ${c.id} ("${c.title}") opened on ${c.coins.map((k) => `${k.label ?? k.key}${k.priceAtOpen ? ` at $${k.priceAtOpen.toPrecision(4)}` : ""}`).join(", ")}. Read each coin's launch first (trace_launch).` };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "trace_launch", group: g, label: "Reading a coin's launch", untrusted: "feed",
      description: "A coin's launch, from its chain: who deployed it and who funded that wallet (and who funded that one), the pool its first buys bought from, every wallet that bought in its launch's slot and the 2 after it (its first hands) with what each took, which of them were born that day, and which share a funder. Busy wallets (exchanges, bridges, bots) never group the wallets they funded. Adds what it read to the case's graph.",
      parameters: obj({ case: { type: "integer" }, coin: coinParam }, ["case", "coin"]),
      describe: (a) => `read the launch of ${String(a.coin)}`, decision: "allow",
      async run(a) {
        try {
          const c = caseOf(a);
          const words = await readLaunch(c, String(a.coin), sleuth);
          book.save(c);
          return { content: words };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "trace_holders", group: g, label: "Reading who holds a coin", untrusted: "feed",
      description: "Who holds a coin now, from its chain: every token account of its mint, its pools told from wallets, the ten largest wallets' share, the largest holders' first money in, and the holders grouped by who funded them with each group's share (one hand behind many wallets). Marks the deployer and the first hands among them.",
      parameters: obj({ case: { type: "integer" }, coin: coinParam }, ["case", "coin"]),
      describe: (a) => `read who holds ${String(a.coin)}`, decision: "allow",
      async run(a) {
        try {
          const c = caseOf(a);
          const words = await readHolders(c, String(a.coin), sleuth);
          book.save(c);
          return { content: words };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "trace_wallet", group: g, label: "Following a wallet", untrusted: "feed",
      description: "Follows one wallet: its first money in and when it was born, its last 20 transactions (who it sent to and got from most, each large recipient checked for busy: an exchange, a bridge, a bot), its trades in one of the case's coins if you name it (the deployer's: how much of its buy it has sold), and the ways out from it the case has found. Follow the money a hop at a time: the next wallet it names is the next to follow.",
      parameters: obj({ case: { type: "integer" }, wallet: { type: "string" }, coin: coinParam }, ["case", "wallet"]),
      describe: (a) => `follow ${String(a.wallet).slice(0, 8)}…`, decision: "allow",
      async run(a) {
        try {
          const c = caseOf(a);
          const words = await readWallet(c, String(a.wallet).trim(), sleuth, typeof a.coin === "string" && a.coin ? a.coin : undefined);
          book.save(c);
          return { content: words };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "case_patterns", group: g, label: "Checking the patterns", untrusted: "feed",
      description: `The patterns, by code, for each of the case's coins (${Object.keys(PATTERNS).join(", ")}), each with its threshold; the wallets its coins share; the same hands in every earlier case; what each pattern did to prices in earlier cases (price now against price at their opening), and the leans those facts point to (wary, timing, follow, edge). Also what the person has noticed before: check each against this case and say what you find.`,
      parameters: obj({ case: { type: "integer" } }, ["case"]),
      describe: (a) => `check case ${String(a.case)}'s patterns`, decision: "allow",
      async run(a) {
        try {
          const c = caseOf(a);
          const others = book.list().filter((x) => x.id !== c.id).map((x) => book.get(x.id)!).filter(Boolean);
          return { content: await readPatterns(c, book, sleuth, others) };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "case_finding", group: g, label: "Keeping a finding",
      description: "Keeps a finding in the case: what you found, in a sentence or two, with its evidence: the signatures of the transfers it rests on, or the wallets, exactly as the case read them (a finding citing anything the case did not read is refused: read it first). Weight: strong (the chain shows it), likely (the pattern points to it), hunch.",
      parameters: obj({ case: { type: "integer" }, words: { type: "string" }, evidence: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 40 }, weight: { type: "string", enum: ["strong", "likely", "hunch"] } }, ["case", "words", "evidence", "weight"]),
      describe: (a) => `keep a finding in case ${String(a.case)}`, decision: "allow",
      async run(a, ctx) {
        try {
          const f = book.find(Number(a.case), ctx.orb, String(a.words), (a.evidence as string[]).map(String), a.weight as Weight);
          return { content: `Kept as finding ${f.id} (${f.weight}).` };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "label_wallet", group: g, label: "Labelling a wallet",
      description: "Labels a wallet for every case: a name for it (what it is: an exchange's hot wallet, a bridge, a mixer, a known bot, a group's main wallet), and whether it is a way out (an exchange, a bridge, a mixer: money reaching it has left the chain's trail, and wallets it funded are strangers). Only label what the chain or a public source shows.",
      parameters: obj({ address: { type: "string" }, label: { type: "string" }, exit: { type: "boolean" } }, ["address", "label", "exit"]),
      describe: (a) => `label ${String(a.address).slice(0, 8)}…`, decision: "allow",
      async run(a, ctx) {
        try {
          if (!isSolanaAddress(String(a.address))) throw new CaseError(`${String(a.address)} is not a Solana address`);
          const l = book.label(String(a.address), String(a.label), a.exit === true, ctx.orb);
          return { content: `${short(l.address)} is "${l.label}"${l.exit ? ", a way out" : ""}, for every case.` };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "close_case", group: g, label: "Closing a case",
      description: "Closes a case with your write-up (what happened, told as ZachXBT tells it: the trail step by step, each step on what the case read, what is shown and what is only likely) and how it could be played (from its leans: what to avoid, when it moved before, which wallets to watch, a rule worth testing on paper first; never a promise). Check case_patterns first.",
      parameters: obj({ case: { type: "integer" }, summary: { type: "string" }, play: { type: "string" } }, ["case", "summary", "play"]),
      describe: (a) => `close case ${String(a.case)}`, decision: "allow",
      async run(a) {
        try {
          const c = book.close(Number(a.case), String(a.summary), String(a.play));
          return { content: `Case ${c.id} closed with ${c.findings.length} finding${c.findings.length === 1 ? "" : "s"}.` };
        } catch (e) {
          return fail(e);
        }
      },
    },
  ];
}
