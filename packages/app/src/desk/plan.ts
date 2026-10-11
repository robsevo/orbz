// The desk floor's plan (PLAN 5.22; owner, 10-10: "in the same theme that we have going on here, but its own thing";
// "like the office, with desks etc, funny, fast professional"). Pure (no React, no DOM), drawn by desk/art.tsx and played
// by desk/Floor.tsx, the office floor's way: the same size of plan, so the office's A* routing (floor/plan.ts `route`)
// walks it on this floor's own grid.
//
// From the back: the wall of screens (the market live), with the research corner, the war room and the coffee bar under
// it; the corridor; the pit, three rows of four desks, two seats each, every desk's screens showing what its orb trades;
// the hallway; then the bell (rung for every trade won), the head's glass office and the risk desk. The desk's orbs walk
// fast (half again an office orb's pace) and their moments come from the desk's real events.
import type { HueName } from "../design/tokens.ts";
import { CELL, GH, GW, H, W, type Rect, type Spot } from "../floor/plan.ts";
import { NAMES } from "../floor/props.ts";

export { H, W };
export const WALL = 84;
const R = 7;
const EDGE = 36;

export type AreaId = "research" | "warroom" | "coffee" | "pit" | "bell" | "head" | "risk";
export type Area = { id: AreaId; name: string; hue: HueName; rect: Rect; door: { x: number; w: number } | null };
const TOP = 300;
const LOW = 832;
export const AREAS: Area[] = [
  { id: "research", name: "Research corner", hue: "violet", rect: { x: 0, y: WALL, w: 392, h: TOP - WALL }, door: { x: 150, w: 90 } },
  { id: "warroom", name: "War room", hue: "amber", rect: { x: 404, y: WALL, w: 392, h: TOP - WALL }, door: { x: 555, w: 90 } },
  { id: "coffee", name: "Coffee bar", hue: "apricot", rect: { x: 808, y: WALL, w: 392, h: TOP - WALL }, door: { x: 955, w: 90 } },
  { id: "pit", name: "The pit", hue: "lime", rect: { x: 0, y: 352, w: W, h: 428 }, door: null },
  { id: "head", name: NAMES.jobs.deskhead.title, hue: "honey", rect: { x: 0, y: LOW, w: 392, h: H - LOW }, door: { x: 150, w: 90 } },
  { id: "bell", name: "The bell", hue: "lime", rect: { x: 404, y: LOW, w: 392, h: H - LOW }, door: { x: 555, w: 90 } },
  { id: "risk", name: "Risk desk", hue: "coral", rect: { x: 808, y: LOW, w: 392, h: H - LOW }, door: { x: 955, w: 90 } },
];
export const areaOf = (id: AreaId): Area => AREAS.find((a) => a.id === id)!;

/** A desk in the pit: a long desk, three screens, two seats behind it facing you. */
export type TDesk = { n: number; rect: Rect; seats: [Spot, Spot]; approach: [Spot, Spot] };
export const TDESK = { w: 232, h: 40 } as const;
export const TDESKS: TDesk[] = [0, 1, 2].flatMap((row) =>
  [0, 1, 2, 3].map((col) => {
    const x = 42 + col * (TDESK.w + 62);
    const y = 418 + row * 128;
    const seat = (k: number): Spot => ({ x: x + (k === 0 ? 62 : TDESK.w - 62), y: y + 14 });
    const near = (k: number): Spot => ({ x: x + (k === 0 ? 62 : TDESK.w - 62), y: y - 20 });
    return { n: row * 4 + col, rect: { x, y, w: TDESK.w, h: TDESK.h }, seats: [seat(0), seat(1)], approach: [near(0), near(1)] } satisfies TDesk;
  }),
);

/** The pieces that block the way and can be in front of an orb. */
export const TPIECES = {
  shelves: { x: 24, y: 96, w: 150, h: 40 },
  corkboard: { x: 210, y: 92, w: 150, h: 34 },
  armchair: { x: 286, y: 210, w: 52, h: 42 },
  table: { x: 476, y: 170, w: 248, h: 56 },
  whiteboard: { x: 470, y: 92, w: 260, h: 30 },
  bar: { x: 832, y: 110, w: 250, h: 44 },
  fridge: { x: 1112, y: 92, w: 60, h: 66 },
  stools: { x: 860, y: 214, w: 190, h: 20 },
  headDesk: { x: 100, y: LOW + 96, w: 180, h: 44 },
  bell: { x: 576, y: LOW + 70, w: 48, h: 54 },
  board: { x: 440, y: LOW + 160, w: 320, h: 34 },
  riskDesk: { x: 900, y: LOW + 100, w: 200, h: 44 },
} satisfies Record<string, Rect>;

export type TPoiId = "bell" | "board" | "coffee" | "fridge" | "stool" | "cork" | "shelf" | "armchair" | "whiteboard" | "wall" | "risk" | "head" | "window";
export type TPoi = { id: TPoiId; approach: Spot; at: Spot; label: string; mark: string };
const P = (id: TPoiId, x: number, y: number, label: string, mark: string, at?: Spot): TPoi => ({ id, approach: { x, y }, at: at ?? { x, y }, label, mark });
export const TPOIS: TPoi[] = [
  P("bell", 600, LOW + 142, "Ringing the bell", "🔔"),
  P("board", 520, LOW + 140, "Checking the leaderboard", "🏆"),
  P("coffee", 900, 186, "Pulling an espresso", "☕"),
  P("fridge", 1100, 186, "Grabbing an energy drink", "⚡"),
  P("stool", 1000, 262, "Watching the tape", "📈"),
  P("cork", 250, 160, "Pinning a note", "📌"),
  P("shelf", 100, 172, "Reading a whitepaper", "📄"),
  P("armchair", 312, 270, "Thinking it over", "💭", { x: 312, y: 236 }),
  P("whiteboard", 600, 146, "Drawing a strategy", "✏️"),
  P("wall", 760, 330, "Staring at the wall", "👀"),
  P("risk", 1000, LOW + 76, "Checking the risk", "🛡"),
  P("head", 190, LOW + 76, "Reporting in", "📋"),
  P("window", 200, 330, "Watching the city", "🌆"),
];

const withDoor = (x: number, y: number, w: number, h: number, door: { x: number; w: number }): Rect[] => [
  { x, y, w: door.x - x, h },
  { x: door.x + door.w, y, w: x + w - door.x - door.w, h },
];
export const TBLOCKS: Rect[] = [
  { x: 0, y: 0, w: W, h: WALL + 4 },
  { x: 392, y: WALL, w: 12, h: TOP - WALL },
  { x: 796, y: WALL, w: 12, h: TOP - WALL },
  ...AREAS.filter((a) => a.rect.y === WALL).flatMap((a) => withDoor(a.rect.x, TOP - 8, a.rect.w, 8, a.door!)),
  ...AREAS.filter((a) => a.rect.y === LOW).flatMap((a) => withDoor(a.rect.x, LOW - 4, a.rect.w, 8, a.door!)),
  { x: 392, y: LOW, w: 12, h: H - LOW },
  { x: 796, y: LOW, w: 12, h: H - LOW },
  ...TDESKS.map((d) => d.rect),
  ...Object.values(TPIECES),
];

/** This floor's walking grid, in the office grid's cells (the office's `route` walks it). */
export const TGRID: Uint8Array = (() => {
  const g = new Uint8Array(GW * GH);
  for (const b of TBLOCKS)
    for (let gy = Math.max(0, Math.floor((b.y - R) / CELL)); gy < Math.min(GH, Math.ceil((b.y + b.h + R) / CELL)); gy++)
      for (let gx = Math.max(0, Math.floor((b.x - R) / CELL)); gx < Math.min(GW, Math.ceil((b.x + b.w + R) / CELL)); gx++) g[gy * GW + gx] = 1;
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) if (gx * CELL < EDGE || (gx + 1) * CELL > W - EDGE || (gy + 1) * CELL > H - EDGE + 8) g[gy * GW + gx] = 1;
  return g;
})();

/** Each of the desk's orbs' seats, in the desk's order: its head in the glass office, the rest two to a desk. */
export function deskSeats(orbs: { name: string; specialty: string }[]): Map<string, { desk: TDesk | null; seat: Spot; approach: Spot }> {
  const out = new Map<string, { desk: TDesk | null; seat: Spot; approach: Spot }>();
  let k = 0;
  for (const o of orbs) {
    if (o.specialty === "deskhead" && ![...out.values()].some((v) => v.desk === null)) {
      out.set(o.name, { desk: null, seat: { x: TPIECES.headDesk.x + 90, y: TPIECES.headDesk.y + 12 }, approach: { x: TPIECES.headDesk.x + 90, y: TPIECES.headDesk.y - 20 } });
      continue;
    }
    const d = TDESKS[Math.floor(k / 2) % TDESKS.length]!;
    const side = (k % 2) as 0 | 1;
    out.set(o.name, { desk: d, seat: d.seats[side], approach: d.approach[side] });
    k++;
  }
  return out;
}

// ── what one of the desk's orbs does next ──────────────────────────────────────────────────────────────────
export type TPlan = { kind: "desk"; label: string; mark: string } | { kind: "poi"; poi: TPoiId; label: string; mark: string };
type Traits = { Pace: number; Care: number; Curiosity: number; Humour: number; Focus: number; Calm: number; Nerve: number };

/** Where a free orb of the desk goes, by its traits (Focus back to its screens, Curiosity to the research corner and the
 * wall, Pace to the coffee, Nerve to the tape, Calm to the window, Care to the risk desk, Humour to the leaderboard). */
export function nextT(o: { traits: Traits; working: boolean }, busy: Set<TPoiId>, r: () => number): TPlan {
  if (o.working) return { kind: "desk", label: NAMES.dept, mark: "📊" };
  const t = o.traits;
  const pick: [TPoiId | "desk", number][] = [
    ["desk", 4 + t.Focus],
    ["shelf", t.Curiosity / 2], ["cork", t.Curiosity / 3], ["wall", t.Curiosity / 2 + t.Nerve / 3],
    ["coffee", t.Pace / 2], ["fridge", t.Pace / 3], ["stool", t.Nerve / 2], ["window", t.Calm / 2],
    ["armchair", t.Calm / 3], ["risk", t.Care / 3], ["board", t.Humour / 2], ["whiteboard", t.Focus / 4 + t.Curiosity / 4],
  ];
  const open = pick.filter(([id]) => id === "desk" || !busy.has(id));
  const total = open.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [id, w] of open) {
    if ((x -= w) > 0) continue;
    if (id === "desk") return { kind: "desk", label: "At the screens", mark: "📊" };
    const poi = TPOIS.find((p) => p.id === id)!;
    return { kind: "poi", poi: id, label: poi.label, mark: poi.mark };
  }
  return { kind: "desk", label: "At the screens", mark: "📊" };
}

/** What the desk's events make an orb say and do (owner, 10-10: "funny, fast professional"). */
export const LINES = {
  won: ["DING! 🔔", "Green candle!", "Called it.", "Booked it, fees and all.", "That's the setup.", "Ring it!"],
  lost: ["Stopped out. Next.", "Oof. Stop kept.", "The market had other plans.", "Coffee. Now.", "Risk did its job."],
  bought: ["In!", "Long.", "Position on.", "Buying the signal."],
  sold: ["Out!", "Taking it.", "Flat."],
  note: ["Pinned it.", "Read this one.", "Fresh research!"],
  strategy: ["New strategy on the board.", "Backtested. Looks clean.", "Fees in, no peeking."],
  ask: ["Needs your yes ✍️", "A real one: your call.", "Over to your wallet."],
} as const;
export const lineOf = (kind: keyof typeof LINES, seed: number): string => LINES[kind][Math.abs(Math.floor(seed)) % LINES[kind].length]!;

export type TMoment = { poi: TPoiId | null; line: string; ring?: boolean; flash?: "ok" | "off" };
/** What a desk event makes its orb do on the floor: where it goes (null: it stays where it is), what it says, the bell
 * rung for a trade won, its screens flashing for a fill; null for an event that is not a moment. */
export function momentOf(e: { type: string; pnl?: unknown; side?: unknown; label?: unknown; seq: number }): TMoment | null {
  const won = Number(e.pnl) > 0;
  switch (e.type) {
    case "desk.trade_closed":
      return { poi: won ? "bell" : "coffee", line: lineOf(won ? "won" : "lost", e.seq), ring: won };
    case "desk.fill":
      return { poi: null, line: lineOf(e.side === "buy" ? "bought" : "sold", e.seq), flash: e.side === "buy" ? "ok" : "off" };
    case "desk.note":
      return { poi: "cork", line: lineOf("note", e.seq) };
    case "desk.strategy_saved":
      return { poi: "whiteboard", line: lineOf("strategy", e.seq) };
    case "desk.swap_asked":
      return { poi: "head", line: lineOf("ask", e.seq) };
    // sent to a token from the war room's screen (owner, 10-11): to the screen, its name said
    case "desk.sent":
      return { poi: "whiteboard", line: `${["On it:", "Pulling up", "Looking at"][Math.abs(e.seq) % 3]} ${String(e.label ?? "it").slice(0, 16)}` };
    default:
      return null;
  }
}
