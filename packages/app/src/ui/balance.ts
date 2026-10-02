// The arithmetic of a grid without stragglers (owner, 2026-10-01: "i hate when like just 1 item is
// lingering in a table or header"). Pure, so a test can try every count at every width.

/** How a grid lays out: `cols` tracks, and how many tracks each item spans (all 1 for plain columns). */
export type GridPlan = { cols: number; spans: number[] };

/** The most even columns, up to `max`, that never leave a single item alone on the last row, or
 * null when no column count does (13 in four, three or two). It gives up a few columns (to 70%)
 * for rows all the same length, or one column at any width: eight in four, or in two, not three,
 * three and two; 24 in twelves, not sixteen and eight. */
export function balanceColumns(n: number, max: number): number | null {
  if (n <= max) return Math.max(1, n);
  // the fewest rows there can be, when they come out all the same length (ten in fives, not 8 + 2)
  const fewest = Math.ceil(n / max);
  if (n % fewest === 0) return n / fewest;
  // rows that are all the same length, when a few columns fewer gives them (24 in twelves, not 16 + 8)
  for (let c = max; c >= Math.max(2, Math.ceil(max * 0.7)); c--) if (n % c === 0) return c;
  if (max - 1 >= 2 && n % (max - 1) === 0) return max - 1;
  for (let c = max; c >= Math.max(2, max - 1); c--) if (n % c >= 2) return c;
  return null;
}

/** A plan for `n` items at most `max` across. Plain columns when they work (losing at most one);
 * otherwise rows as even as they can be (13 at four across: 4, 3, 3, 3), each item spanning its
 * share of a common track count. Two across with an odd count: pairs, and the last one takes the
 * whole row (a full row is not a straggler; half of one is). */
export function planGrid(n: number, max: number): GridPlan {
  const c = balanceColumns(n, max);
  if (c !== null) return { cols: c, spans: Array(n).fill(1) };
  if (max <= 1) return { cols: 1, spans: Array(n).fill(1) };
  if (max === 2) return { cols: 2, spans: [...Array(n - 1).fill(1), 2] };
  const rows = Math.ceil(n / max);
  const base = Math.floor(n / rows);
  const extra = n % rows; // the first `extra` rows hold one more
  const cols = extra ? base * (base + 1) : base;
  const spans: number[] = [];
  for (let r = 0; r < rows; r++) {
    const size = r < extra ? base + 1 : base;
    for (let i = 0; i < size; i++) spans.push(cols / size);
  }
  return { cols, spans };
}

/** With an "add one" tile in front: the tile is a cell when that keeps the rows whole, and takes
 * the whole first row when that is what saves the rest. */
export function layoutOf(n: number, max: number, lead: boolean): { plan: GridPlan; spanLead: boolean } {
  if (!lead) return { plan: planGrid(n, max), spanLead: false };
  const all = planGrid(n + 1, max);
  const plain = all.spans.every((s) => s === 1);
  // a cell when the tile and the rest fill plain columns, as wide as fits (less one at most)
  const wide = max === 1 || all.cols >= Math.max(2, Math.min(max, n + 1) - 1);
  if (n === 0 || (plain && wide)) return { plan: all, spanLead: false };
  return { plan: planGrid(n, max), spanLead: true };
}

/** The rows a plan makes, as item counts: what a test (and the harness) checks for a lone one. */
export function rowsOf(plan: GridPlan): number[] {
  const rows: number[] = [];
  let used = plan.cols;
  for (const s of plan.spans) {
    if (used + s > plan.cols) {
      rows.push(0);
      used = 0;
    }
    rows[rows.length - 1]!++;
    used += s;
  }
  return rows;
}
