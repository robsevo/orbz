// A case's money drawn as ZachXBT draws it (PLAN 5.42; owner, 10-12, his charts as the example): wallets in columns from
// left to right as the money ran, where it came from (the funders, their funders further left), the deployer, its first
// hands, the holders and the wallets it reached, and on the right the ways out (exchanges, bridges, bots); each transfer
// a curve with its amount, how many transfers it sums and when. The pools are left out (every buy goes through one: drawn,
// they hide the trail). Pure, so a test holds it; CaseView.tsx draws it.
import type { CaseEdge, CaseNode, CaseRole } from "../home/link.ts";

export type Placed = { node: CaseNode; role: CaseRole; col: number; x: number; y: number; side: "in" | "out" | null };
export type Drawn = { edge: CaseEdge; from: Placed; to: Placed; path: string; mid: { x: number; y: number }; label: string; when: string };
export type Flow = { width: number; height: number; nodes: Placed[]; edges: Drawn[]; hidden: number };

/** What a wallet is drawn as, of all it is: a way out over all, then the deployer, a first hand, a funder, a holder. */
const ORDER: CaseRole[] = ["exit", "busy", "deployer", "first", "funder", "holder", "wallet", "pool"];
export const mainRole = (n: CaseNode): CaseRole => ORDER.find((r) => n.roles.includes(r)) ?? "wallet";
/** How much a wallet matters to the drawing, when there are more than fit. */
const WEIGHT: Record<CaseRole, number> = { deployer: 1000, first: 600, funder: 500, exit: 450, busy: 400, holder: 200, wallet: 100, pool: 0 };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const when = (t: number): string => {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
export const amountText = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(2));

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
type Pt = { x: number; y: number };
const bez = (p: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t;
  return { x: u ** 3 * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t ** 3 * p[3].x, y: u ** 3 * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t ** 3 * p[3].y };
};

/** The drawing. `width`: the room it has (its columns fit it, between `minColW` and `maxColW` apart; narrower, it
 * scrolls). An exchange that both paid wallets and was paid is drawn twice, as he draws one: where its money came out on
 * the left, where money went into it on the right. Each line's words go where they cover no other words and no wallet. */
export function layout(nodes: readonly CaseNode[], edges: readonly CaseEdge[], o: { max?: number; width?: number; minColW?: number; maxColW?: number; rowH?: number; pad?: number; assets?: Record<string, string> } = {}): Flow {
  const max = o.max ?? 36;
  const rowH = o.rowH ?? 86;
  const pad = o.pad ?? 60;
  const flowOf = new Map<string, number>();
  for (const e of edges) for (const a of [e.from, e.to]) flowOf.set(a, (flowOf.get(a) ?? 0) + (e.asset === "SOL" ? e.amount : 0));
  const drawn = nodes.filter((n) => mainRole(n) !== "pool");
  const kept = [...drawn].sort((a, b) => WEIGHT[mainRole(b)] - WEIGHT[mainRole(a)] || (flowOf.get(b.address) ?? 0) - (flowOf.get(a.address) ?? 0) || a.address.localeCompare(b.address)).slice(0, max);
  const keep = new Set(kept.map((n) => n.address));
  const lines = edges.filter((e) => keep.has(e.from) && keep.has(e.to) && e.from !== e.to);
  // what is drawn: each wallet once, a way out on the side its money is on (both sides, two copies)
  const out = (n: CaseNode): boolean => ["busy", "exit"].includes(mainRole(n));
  type Item = { key: string; node: CaseNode; side: "in" | "out" | null };
  const items: Item[] = [];
  for (const n of kept) {
    if (!out(n)) items.push({ key: n.address, node: n, side: null });
    else {
      const sends = lines.some((e) => e.from === n.address);
      const gets = lines.some((e) => e.to === n.address);
      if (sends) items.push({ key: `${n.address}>`, node: n, side: "out" });
      if (gets || !sends) items.push({ key: `>${n.address}`, node: n, side: "in" });
    }
  }
  const fromKey = (a: string): string => (items.some((i) => i.key === `${a}>`) ? `${a}>` : items.some((i) => i.key === a) ? a : `>${a}`);
  const toKey = (a: string): string => (items.some((i) => i.key === `>${a}`) ? `>${a}` : items.some((i) => i.key === a) ? a : `${a}>`);
  const links = lines.map((e) => ({ e, from: fromKey(e.from), to: toKey(e.to) }));
  // columns: the deployer, its first hands and the holders where they stand; a funder (and a way out money came out of)
  // a column left of what it paid, its own funder further left; a wallet a column right of what paid it; the ways out
  // money went into on the far right
  const col = new Map<string, number>();
  const base: Partial<Record<CaseRole, number>> = { deployer: 2, first: 3, holder: 4 };
  for (const i of items) {
    const r = mainRole(i.node);
    if (i.side === null && base[r] !== undefined) col.set(i.key, base[r]!);
  }
  for (let pass = 0; pass < 6; pass++) {
    for (const i of items) {
      const r = mainRole(i.node);
      if (r === "funder" || i.side === "out") {
        const to = links.filter((l) => l.from === i.key && col.has(l.to)).map((l) => col.get(l.to)! - 1);
        col.set(i.key, to.length ? Math.min(...to) : 1);
      } else if (r === "wallet") {
        const from = links.filter((l) => l.to === i.key && col.has(l.from)).map((l) => col.get(l.from)! + 1);
        col.set(i.key, from.length ? Math.max(...from) : 4);
      }
    }
  }
  const inner = [...col.values()];
  const last = (inner.length ? Math.max(...inner) : 4) + 1;
  for (const i of items) if (!col.has(i.key)) col.set(i.key, last);
  const used = [...new Set(items.map((i) => col.get(i.key)!))].sort((a, b) => a - b);
  const at = new Map(used.map((c, k) => [c, k]));
  const columns = used.map(() => [] as Item[]);
  for (const i of items) columns[at.get(col.get(i.key)!)!]!.push(i);
  for (const c of columns) c.sort((a, b) => ORDER.indexOf(mainRole(a.node)) - ORDER.indexOf(mainRole(b.node)) || (flowOf.get(b.node.address) ?? 0) - (flowOf.get(a.node.address) ?? 0) || a.key.localeCompare(b.key));
  // fewer crossings (layered drawing's barycenter sweeps): each column ordered by where the wallets it trades with stand
  // in the columns before it, then after it, four times over; a wallet with none keeps its place
  const rowOf = new Map<string, number>();
  const index = (): void => columns.forEach((c) => c.forEach((i, j) => rowOf.set(i.key, j / Math.max(1, c.length - 1))));
  index();
  const colOf = new Map(items.map((i) => [i.key, at.get(col.get(i.key)!)!]));
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? columns.map((_, k) => k) : columns.map((_, k) => columns.length - 1 - k);
    for (const k of order) {
      const c = columns[k]!;
      const near = (i: Item): number | null => {
        const ys = links.filter((l) => (l.from === i.key || l.to === i.key)).map((l) => (l.from === i.key ? l.to : l.from)).filter((o) => (down ? colOf.get(o)! < k : colOf.get(o)! > k)).map((o) => rowOf.get(o)!);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
      };
      const keyed = c.map((i, j) => ({ i, j, b: near(i) }));
      keyed.sort((x, y) => (x.b ?? x.j / Math.max(1, c.length - 1)) - (y.b ?? y.j / Math.max(1, c.length - 1)) || x.j - y.j);
      columns[k] = keyed.map((x) => x.i);
      index();
    }
  }
  const gaps = Math.max(1, columns.length - 1);
  const colW = Math.max(o.minColW ?? 150, Math.min(o.maxColW ?? 240, o.width ? (o.width - 2 * pad) / gaps : (o.maxColW ?? 240)));
  const tallest = Math.max(1, ...columns.map((c) => c.length));
  const height = pad * 2 + (tallest - 1) * rowH;
  const placed = new Map<string, Placed>();
  columns.forEach((c, k) => {
    const top = (height - (c.length - 1) * rowH) / 2;
    c.forEach((i, j) => placed.set(i.key, { node: i.node, role: mainRole(i.node), col: k, x: pad + k * colW, y: top + j * rowH, side: i.side }));
  });
  const width = columns.length > 1 ? pad * 2 + gaps * colW : pad * 2;
  const r = 18;
  // the room taken: every wallet (its circle and its name under it), then each line's words as they are placed
  const taken: Box[] = [...placed.values()].map((p) => ({ x0: p.x - 48, y0: p.y - r - 2, x1: p.x + 48, y1: p.y + r + 32 }));
  const outEdges: Drawn[] = links.map(({ e, from, to }) => {
    const a = placed.get(from)!;
    const b = placed.get(to)!;
    let ctrl: [Pt, Pt, Pt, Pt];
    if (b.x > a.x) {
      const dx = (b.x - a.x) / 2;
      ctrl = [{ x: a.x + r, y: a.y }, { x: a.x + r + dx, y: a.y }, { x: b.x - r - dx, y: b.y }, { x: b.x - r, y: b.y }];
    } else {
      // back, or within a column: a loop over the top
      const lift = Math.max(40, Math.abs(a.x - b.x) / 3 + 30);
      const y = Math.min(a.y, b.y) - lift;
      ctrl = [{ x: a.x, y: a.y - r }, { x: a.x, y }, { x: b.x, y }, { x: b.x, y: b.y - r }];
    }
    const path = `M${ctrl[0].x},${ctrl[0].y} C${ctrl[1].x},${ctrl[1].y} ${ctrl[2].x},${ctrl[2].y} ${ctrl[3].x},${ctrl[3].y}`;
    const asset = e.asset === "SOL" ? "SOL" : (o.assets?.[e.asset] ?? "tokens");
    const label = `${amountText(e.amount)} ${asset}${e.count > 1 ? ` (${e.count} transfers)` : ""}`;
    const stamp = when(e.first);
    const w = Math.max(label.length * 6.2, stamp.length * 5.6) + 8;
    const boxAt = (m: Pt): Box => ({ x0: m.x - w / 2, y0: m.y - 16, x1: m.x + w / 2, y1: m.y + 14 });
    // the first spot along its line that covers nothing; with none free, the one that covers least
    const cover = (m: Pt): number => {
      const b = boxAt(m);
      return taken.reduce((n, x) => n + (overlaps(x, b) ? (Math.min(x.x1, b.x1) - Math.max(x.x0, b.x0)) * (Math.min(x.y1, b.y1) - Math.max(x.y0, b.y0)) : 0), 0);
    };
    let mid = bez(ctrl, 0.5);
    let least = Infinity;
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8, 0.14, 0.86]) {
      const m = bez(ctrl, t);
      const c = cover(m);
      if (c < least) {
        least = c;
        mid = m;
      }
      if (c === 0) break;
    }
    taken.push(boxAt(mid));
    return { edge: e, from: a, to: b, path, mid, label, when: stamp };
  });
  // a loop over the top (or its words) above the drawing: everything moved down so it shows, the drawing that much taller
  const above = Math.min(0, ...outEdges.map((d) => d.mid.y - 18), ...outEdges.map((d) => Math.min(...[...d.path.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]))) - 4));
  if (above < 0) {
    const dy = -above;
    const move = (path: string): string => path.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x: string, y: string) => `${x},${Number(y) + dy}`);
    for (const pl of placed.values()) pl.y += dy;
    for (const d of outEdges) {
      d.path = move(d.path);
      d.mid = { x: d.mid.x, y: d.mid.y + dy };
    }
  }
  return { width, height: height - Math.min(0, above), nodes: [...placed.values()], edges: outEdges, hidden: drawn.length - kept.length };
}

/** The coins named in a box of words: a mint address (a pump.fun link's or DexScreener's too) or "solana:<mint>", each
 * once, as the desk keys them; at most `max`. */
export function coinsIn(text: string, max = 10): string[] {
  const out: string[] = [];
  // a whole run of base58, never the inside of a longer word (the tail of an EVM address is base58 too)
  for (const m of text.matchAll(/(?<![0-9A-Za-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![0-9A-Za-z])/g)) {
    const k = `solana:${m[1]}`;
    if (!out.includes(k)) out.push(k);
  }
  return out.slice(0, max);
}
