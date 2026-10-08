// The office floor (owner, 10-05: "the office should be a whole office visual of them working in an office.
// every dept is different, like a startup company would look ... see them move around the office etc. they
// sit at their desks. make it intricate and nice and fun"): the plan of the floor, where each orb's desk is,
// the ways between, and what an orb does next. Pure (no React, no DOM), so a test can walk it.
//
// The floor is seen from the front and above, as a game's office is: the back wall at the top, the rooms
// along it (the lounge, the meeting room, the kitchen), a corridor, then the departments, each a pod of
// desks behind a low partition in its own colour, and a games corner among them. Units are the plan's own;
// Floor.tsx scales them to the screen. y grows down; an orb's spot is where it stands (its feet).
//
// What an orb does is its real state first (orb/mood.ts): working, thinking, waiting for you or at the gym,
// at its desk; in a Brainstorm, at the meeting table; dozing or asleep, on the sofa. Free, it goes where its
// traits take it (orb/dna.ts): Curiosity to the bookshelf, Calm to the sofa and the window, Care to the
// plants, Humour to the ping-pong table and to a colleague's desk, Pace to the coffee, Focus back to its
// own desk. Its Pace is how fast it walks.
import type { Mood } from "../orb/mood.ts";
import type { HueName } from "../design/tokens.ts";
import { FAMILIES, type Family } from "../orb/spec.ts";

export const W = 1200;
export const H = 780;
/** The back wall's height. */
export const WALL = 84;
/** How far an orb keeps from a wall or a desk as it walks. */
const R = 7;
/** How far in from the floor's sides an orb walks. */
const EDGE = 36;
/** The walking grid's cell. */
export const CELL = 10;

export type Rect = { x: number; y: number; w: number; h: number };
export type Spot = { x: number; y: number };

// ── the rooms and the departments ─────────────────────────────────────────────────────────────────
export type Zone = { id: Family | "play"; name: string; hue: HueName; rect: Rect; door: { x: number; w: number } };
const ROW_A = 352;
const ROW_B = 584;
const ZONE_H = 196;
const COLS = [12, 420, 828] as const;
const ZONE_W = 360;
const zone = (id: Zone["id"], name: string, hue: HueName, col: number, y: number): Zone => ({ id, name, hue, rect: { x: COLS[col]!, y, w: ZONE_W, h: ZONE_H }, door: { x: COLS[col]! + ZONE_W / 2 - 45, w: 90 } });
/** The departments with a zone of their own (spec.ts FAMILIES; the Executive and Finance work beside Think and
 * Business, `zoneOf`), and the games corner among them. */
export const ZONES: Zone[] = [
  zone("build", FAMILIES.build, "cornflower", 0, ROW_A),
  zone("think", FAMILIES.think, "violet", 1, ROW_A),
  zone("make", FAMILIES.make, "coral", 2, ROW_A),
  zone("business", FAMILIES.business, "amber", 0, ROW_B),
  zone("play", "Games", "pink", 1, ROW_B),
  zone("life", FAMILIES.life, "mint", 2, ROW_B),
];
/** Each department's mark, on its sign on the floor and its branch of the org chart. */
export const MARKS: Record<Family | "play", string> = { exec: "👑", build: "🛠", think: "💡", make: "🎨", finance: "💰", business: "📈", life: "🌿", play: "🎮" };

export type Room = { id: "lounge" | "meeting" | "kitchen"; name: string; hue: HueName; rect: Rect; door: { x: number; w: number } };
const TOP_H = 300 - WALL;
export const ROOMS: Room[] = [
  { id: "lounge", name: "Lounge", hue: "iris", rect: { x: 0, y: WALL, w: 392, h: TOP_H }, door: { x: 150, w: 90 } },
  // the Board room (owner, 10-07: "Add a Board room as well for those important meetings in the office, replace the meeting
  // room because we already have sessions we can create in sessions"): its table is the board's, met when a proposal is voted
  { id: "meeting", name: "Board room", hue: "honey", rect: { x: 404, y: WALL, w: 392, h: TOP_H }, door: { x: 555, w: 90 } },
  { id: "kitchen", name: "Kitchen", hue: "apricot", rect: { x: 808, y: WALL, w: 392, h: TOP_H }, door: { x: 955, w: 90 } },
];
/** The corridor under the rooms. */
export const CORRIDOR: Rect = { x: 0, y: 300, w: W, h: ROW_A - 300 };

// ── a phone's views (owner, 10-07: "for mobile ... can we make it by room on mobile and the user can switch?") ──
export type ViewId = "all" | Room["id"] | Zone["id"];
/** What a phone shows, one at a time: the whole office, each room, each department, the games corner. */
export const VIEWS: { id: ViewId; name: string; hue: HueName }[] = [
  { id: "all", name: "Whole office", hue: "azure" },
  ...ROOMS.map((r) => ({ id: r.id, name: r.name, hue: r.hue })),
  ...ZONES.map((z) => ({ id: z.id, name: z.name, hue: z.hue })),
];
/** How much floor a phone shows round a room (owner, 10-07: "a little too zoomed in on the rooms in mobile"): 50
 * to each side and 30 above and below, so a room sits among its neighbours' edges at about four fifths of the size
 * it filled the screen at. */
export const VIEW_PAD = { x: 50, y: 30 };
/** A view's part of the floor, the room and some floor round it; the whole office has none. At the floor's edge the
 * window moves in rather than shrinks, so every room is shown at the same size. */
export function viewRect(id: ViewId): Rect | null {
  const r = ROOMS.find((x) => x.id === id)?.rect ?? ZONES.find((x) => x.id === id)?.rect;
  if (!r) return null;
  const w = Math.min(W, r.w + 2 * VIEW_PAD.x);
  const h = Math.min(H, r.h + 2 * VIEW_PAD.y + 18); // and room above for the names over the orbs at its top
  const x = Math.min(Math.max(0, r.x - VIEW_PAD.x), W - w);
  const y = Math.min(Math.max(0, r.y - VIEW_PAD.y - 18), H - h);
  return { x, y, w, h };
}
/** The department most of the office sits in (a phone opens on it); the whole office when no one does. */
export function busiest(desks: Map<string, Desk>): ViewId {
  const n = new Map<Family, number>();
  for (const d of desks.values()) n.set(d.zone, (n.get(d.zone) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "all";
}

// ── desks ─────────────────────────────────────────────────────────────────────────────────────────
export const DESK = { w: 96, h: 36 } as const;
export type Desk = { zone: Family; n: number; rect: Rect; seat: Spot; approach: Spot; monitor: "left" | "right" };
/** Each department's six desks: three across, two deep; an orb sits behind its desk, facing you. */
export const DESKS: Desk[] = ZONES.filter((z) => z.id !== "play").flatMap((z) =>
  [0, 1].flatMap((row) =>
    [0, 1, 2].map((col) => {
      const x = z.rect.x + 16 + col * (DESK.w + 16);
      const y = z.rect.y + 66 + row * 84;
      return {
        zone: z.id as Family,
        n: row * 3 + col,
        rect: { x, y, w: DESK.w, h: DESK.h },
        seat: { x: x + DESK.w / 2, y: y + 14 },
        approach: { x: x + DESK.w / 2, y: y - 18 },
        monitor: (row + col) % 2 ? "left" : "right",
      } satisfies Desk;
    }),
  ),
);

// ── furniture: what blocks the way, and what can be drawn in front of an orb ──────────────────────
export type Piece = { id: string; rect: Rect };
const zr = (id: Zone["id"]): Rect => ZONES.find((z) => z.id === id)!.rect;
const play = zr("play");
export const PIECES = {
  sofa: { x: 34, y: 96, w: 200, h: 46 },
  coffeeTable: { x: 92, y: 182, w: 92, h: 30 },
  bookshelf: { x: 268, y: 88, w: 96, h: 46 },
  beanbag: { x: 286, y: 214, w: 46, h: 34 },
  meetingTable: { x: 468, y: 160, w: 264, h: 56 },
  counter: { x: 826, y: 90, w: 236, h: 42 },
  fridge: { x: 1074, y: 86, w: 52, h: 62 },
  cooler: { x: 1144, y: 98, w: 34, h: 48 },
  bistro: { x: 932, y: 206, w: 60, h: 40 },
  vending: { x: 1150, y: 196, w: 40, h: 72 },
  pingpong: { x: play.x + 105, y: play.y + 82, w: 160, h: 64 },
  arcade: { x: play.x + 14, y: play.y + 30, w: 46, h: 60 },
  rack: { x: zr("build").x + ZONE_W - 40, y: zr("build").y + 24, w: 30, h: 40 },
} satisfies Record<string, Rect>;

// ── where an orb can go when it is free ───────────────────────────────────────────────────────────
export type PoiId =
  | "coffee" | "fridge" | "cooler" | "vending" | "bistro1" | "bistro2"
  | "sofa1" | "sofa2" | "sofa3" | "beanbag" | "books" | "window"
  | "ping1" | "ping2" | "arcade" | "plant1" | "plant2" | "plant3";
export type Poi = { id: PoiId; approach: Spot; at: Spot; sit: boolean; label: string; mark: string; rest?: boolean };
const p = (id: PoiId, x: number, y: number, label: string, mark: string, o: { sit?: boolean; at?: Spot; rest?: boolean } = {}): Poi => ({ id, approach: { x, y }, at: o.at ?? { x, y }, sit: o.sit ?? false, label, mark, ...(o.rest && { rest: true }) });
const sofa = PIECES.sofa;
const pp = PIECES.pingpong;
export const POIS: Poi[] = [
  p("coffee", 880, 150, "Getting a coffee", "☕"),
  p("fridge", 1100, 162, "Looking for a snack", "🍪"),
  p("cooler", 1148, 160, "At the water cooler", "💧"),
  p("vending", 1130, 236, "At the vending machine", "🥤"),
  p("bistro1", 912, 262, "Having a snack", "🥐", { at: { x: 912, y: 240 } }),
  p("bistro2", 1012, 262, "Having a snack", "🥐", { at: { x: 1012, y: 240 } }),
  p("sofa1", sofa.x + 40, 162, "On the sofa", "🛋", { sit: true, at: { x: sofa.x + 40, y: 132 }, rest: true }),
  p("sofa2", sofa.x + 100, 162, "On the sofa", "🛋", { sit: true, at: { x: sofa.x + 100, y: 132 }, rest: true }),
  p("sofa3", sofa.x + 160, 162, "On the sofa", "🛋", { sit: true, at: { x: sofa.x + 160, y: 132 }, rest: true }),
  p("beanbag", 309, 262, "Taking five", "💭", { sit: true, at: { x: 309, y: 236 }, rest: true }),
  p("books", 316, 150, "Reading", "📖"),
  p("window", 150, 262, "Looking out of the window", "🌤"),
  p("ping1", pp.x - 18, pp.y + pp.h / 2 + 10, "Playing ping-pong", "🏓"),
  p("ping2", pp.x + pp.w + 18, pp.y + pp.h / 2 + 10, "Playing ping-pong", "🏓"),
  p("arcade", play.x + 37, play.y + 108, "Playing a game", "🕹"),
  // the plants stand in the aisles between the departments
  p("plant1", zr("make").x - 24, zr("make").y + 124, "Watering the plants", "🪴"),
  p("plant2", zr("think").x - 24, zr("think").y + 124, "Watering the plants", "🪴"),
  p("plant3", zr("life").x - 24, zr("life").y + 124, "Watering the plants", "🪴"),
];

/** The meeting table's seats: four behind it (facing you), four in front. */
export const SEATS: { approach: Spot; at: Spot }[] = [0, 1, 2, 3].flatMap((i) => {
  const x = PIECES.meetingTable.x + 40 + i * 62;
  return [
    { approach: { x, y: PIECES.meetingTable.y - 14 }, at: { x, y: PIECES.meetingTable.y + 12 } },
    { approach: { x: x + 20, y: PIECES.meetingTable.y + PIECES.meetingTable.h + 26 }, at: { x: x + 20, y: PIECES.meetingTable.y + PIECES.meetingTable.h + 22 } },
  ];
});

// ── the walking grid ──────────────────────────────────────────────────────────────────────────────
/** A wall with a door in it, as the rects either side of the door. */
const withDoor = (x: number, y: number, w: number, h: number, door: { x: number; w: number }): Rect[] => [
  { x, y, w: door.x - x, h },
  { x: door.x + door.w, y, w: x + w - door.x - door.w, h },
];
export const BLOCKS: Rect[] = [
  { x: 0, y: 0, w: W, h: WALL + 4 }, // the back wall
  { x: 392, y: WALL, w: 12, h: TOP_H }, // the lounge's wall with the meeting room
  { x: 796, y: WALL, w: 12, h: TOP_H }, // the meeting room's with the kitchen
  ...ROOMS.flatMap((r) => withDoor(r.rect.x, 292, r.rect.w, 8, r.door)), // the rooms' front walls
  ...ZONES.flatMap((z) => withDoor(z.rect.x, z.rect.y, z.rect.w, 12, z.door)), // the partitions
  ...DESKS.map((d) => d.rect),
  ...Object.values(PIECES),
];

export const GW = W / CELL;
export const GH = H / CELL;
/** Which cells an orb cannot stand in: a block, grown by how far it keeps from one. */
export const GRID: Uint8Array = (() => {
  const g = new Uint8Array(GW * GH);
  for (const b of BLOCKS)
    for (let gy = Math.max(0, Math.floor((b.y - R) / CELL)); gy < Math.min(GH, Math.ceil((b.y + b.h + R) / CELL)); gy++)
      for (let gx = Math.max(0, Math.floor((b.x - R) / CELL)); gx < Math.min(GW, Math.ceil((b.x + b.w + R) / CELL)); gx++) g[gy * GW + gx] = 1;
  // the floor's edges: an orb keeps far enough in that all of it (its glow too) stays on the floor
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) if (gx * CELL < EDGE || (gx + 1) * CELL > W - EDGE || (gy + 1) * CELL > H - EDGE + 8) g[gy * GW + gx] = 1;
  return g;
})();
export const cellOf = (s: Spot): number => Math.min(GH - 1, Math.max(0, Math.floor(s.y / CELL))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(s.x / CELL)));
export const free = (s: Spot, grid: Uint8Array = GRID): boolean => !grid[cellOf(s)];

/** The way from one spot to another, as the corners to walk through (A* on the grid, then straightened);
 * null when there is none. */
export function route(from: Spot, to: Spot, grid: Uint8Array = GRID): Spot[] | null {
  const GRID_ = grid;
  const start = nearestFree(cellOf(from), grid);
  const goal = nearestFree(cellOf(to), grid);
  if (start === null || goal === null) return null;
  const g = new Float32Array(GW * GH).fill(Infinity);
  const came = new Int32Array(GW * GH).fill(-1);
  const open: number[] = [start];
  const f = new Float32Array(GW * GH).fill(Infinity);
  const h = (c: number): number => {
    const dx = Math.abs((c % GW) - (goal % GW));
    const dy = Math.abs(Math.floor(c / GW) - Math.floor(goal / GW));
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  g[start] = 0;
  f[start] = h(start);
  const closed = new Uint8Array(GW * GH);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]!]! < f[open[bi]!]!) bi = i;
    const c = open[bi]!;
    open[bi] = open[open.length - 1]!;
    open.pop();
    if (c === goal) break;
    if (closed[c]) continue;
    closed[c] = 1;
    const cx = c % GW;
    const cy = Math.floor(c / GW);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const n = ny * GW + nx;
        if (GRID_[n] || closed[n]) continue;
        if (dx && dy && (GRID_[cy * GW + nx] || GRID_[ny * GW + cx])) continue; // never cut a corner
        const ng = g[c]! + (dx && dy ? 1.414 : 1);
        if (ng < g[n]!) {
          g[n] = ng;
          f[n] = ng + h(n);
          came[n] = c;
          open.push(n);
        }
      }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = c === start ? -1 : came[c]!) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: (c % GW) * CELL + CELL / 2, y: Math.floor(c / GW) * CELL + CELL / 2 }));
  // straightened: from each corner, as far along as the way is clear
  const out: Spot[] = [from];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(out[out.length - 1]!, pts[j]!, grid)) j--;
    out.push(pts[j]!);
    i = j;
  }
  out.push(to);
  return out;
}

function nearestFree(c: number, grid: Uint8Array): number | null {
  if (!grid[c]) return c;
  const cx = c % GW;
  const cy = Math.floor(c / GW);
  for (let r = 1; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < GW && ny < GH && !grid[ny * GW + nx]) return ny * GW + nx;
      }
  return null;
}

/** Whether the straight way between two spots is clear (sampled every half cell). */
export function clear(a: Spot, b: Spot, grid: Uint8Array = GRID): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 2));
  for (let i = 1; i < n; i++) if (grid[cellOf({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n })]) return false;
  return true;
}

// ── who sits where ────────────────────────────────────────────────────────────────────────────────
/** Where a department works on the floor: its own zone; the Executive with Think and Finance with Business, until the
 * Board room and their own places come (PLAN 5.17). */
export const zoneOf = (f: Family): Family => (f === "exec" ? "think" : f === "finance" ? "business" : f);

/** Each orb's desk: in its department, in the office's order; past six, the first desk free anywhere. */
export function seating(orbs: { name: string; family: Family }[]): Map<string, Desk> {
  const out = new Map<string, Desk>();
  const taken = new Set<Desk>();
  const later: { name: string; family: Family }[] = [];
  for (const o of orbs) {
    const d = DESKS.find((x) => x.zone === zoneOf(o.family) && !taken.has(x));
    if (d) {
      out.set(o.name, d);
      taken.add(d);
    } else later.push(o);
  }
  for (const o of later) {
    const d = DESKS.find((x) => !taken.has(x));
    if (!d) break; // thirty orbs at their desks: the rest stand
    out.set(o.name, d);
    taken.add(d);
  }
  return out;
}

// ── what an orb does next ─────────────────────────────────────────────────────────────────────────
export type Traits = { Pace: number; Care: number; Curiosity: number; Humour: number; Focus: number; Calm: number; Nerve: number };
export type Plan =
  | { kind: "desk"; why: "work" | "think" | "wait" | "gym" | "tidy"; label: string; mark: string }
  | { kind: "meeting"; seat: number; label: string; mark: string }
  | { kind: "poi"; poi: PoiId; label: string; mark: string; with?: string }
  | { kind: "visit"; who: string; label: string; mark: string }
  /** A meeting the home decided (PLAN 5.9): the two go to its place together, side 0 and side 1; a moment's (owner, 10-07)
   * also says a line and makes a gesture there, `after` ms once it has arrived. */
  | { kind: "meet"; with: string; place: MeetPlace; side: 0 | 1; until: number; label: string; mark: string; say?: { line: string; gesture: string; after: number } };

/** Where the home's meetings happen (home/src/social/rules.ts Place). */
export type MeetPlace = "coffee" | "cooler" | "bistro1" | "bistro2" | "pingpong" | "arcade" | "desk" | "fridge" | "plant1" | "plant2" | "plant3";
export type MeetKind = "coffee" | "ideas" | "game" | "lesson";

/** Where one side of a meeting stands at a spot (not a desk: that is the teacher's own): the two ends of
 * the ping-pong table, or side by side, kept inside the floor (a spot by a wall puts both on its inner side). */
export function meetSpot(place: Exclude<MeetPlace, "desk">, side: 0 | 1): { approach: Spot; at: Spot } {
  if (place === "pingpong") {
    const end = POIS.find((q) => q.id === (side ? "ping2" : "ping1"))!;
    return { approach: end.approach, at: end.at };
  }
  const spot = POIS.find((q) => q.id === place)!;
  const inside = (x: number): number => Math.min(W - 48, Math.max(48, x));
  const toward = spot.at.x > W - 90 ? -1 : spot.at.x < 90 ? 1 : 0;
  const dx = toward ? toward * (side ? 46 : 12) : side ? 22 : -22;
  return { approach: { x: inside(spot.approach.x + dx), y: spot.approach.y }, at: { x: inside(spot.at.x + dx), y: spot.at.y } };
}

/** One orb's part in a meeting the home decided: where it stands and what its tag says. `a` started it
 * (for a lesson, the one who teaches); `until` is when it ends, by the wall clock. */
export function meetPlan(m: { a: string; b: string; kind: MeetKind; place: MeetPlace; winner: string | null; until: number }, me: string): Extract<Plan, { kind: "meet" }> {
  const side: 0 | 1 = me === m.a ? 0 : 1;
  const other = side === 0 ? m.b : m.a;
  const base = { kind: "meet" as const, with: other, place: m.place, side, until: m.until };
  if (m.kind === "lesson") return { ...base, label: side === 0 ? `Showing ${other} something` : `Learning from ${other}`, mark: "📚" };
  if (m.kind === "ideas") return { ...base, label: `Swapping ideas with ${other}`, mark: "💡" };
  if (m.kind === "game") return { ...base, label: m.place === "arcade" ? `At the arcade with ${other}` : `Playing ping-pong with ${other}`, mark: m.place === "arcade" ? "🕹" : "🏓" };
  return { ...base, label: m.place === "cooler" ? `At the cooler with ${other}` : `Having a coffee with ${other}`, mark: "☕" };
}

/** A moment the home decided (owner, 10-07: "more micro interactions and situations between orbs ... goofy and funny as
 * well. fun to watch"; home/src/social/rules.ts pickMoment): where the two run into each other, what each tag says, and
 * the line each says there, the second a beat after the first, with a gesture each. A bump, a high five or a trip is in
 * an aisle by a plant; the last cookie at the fridge, a mug at the coffee, a dance at the cooler; a joke or a sticky note
 * at the first one's desk. */
export type MomentKind = "bump" | "highfive" | "cookie" | "joke" | "mug" | "sticky" | "trip" | "dance";
export const MOMENT_MARK: Record<MomentKind, string> = { bump: "💥", highfive: "✋", cookie: "🍪", joke: "😂", mug: "☕", sticky: "📝", trip: "🌀", dance: "🕺" };
export function momentPlan(m: { a: string; b: string; kind: MomentKind; lines: [string, string]; gestures: [string, string]; at: number; until: number }, me: string): Extract<Plan, { kind: "meet" }> {
  const side: 0 | 1 = me === m.a ? 0 : 1;
  const other = side === 0 ? m.b : m.a;
  const aisle = (["plant1", "plant2", "plant3"] as const)[Math.floor(m.at / 1000) % 3]!;
  const place: MeetPlace = { bump: aisle, highfive: aisle, trip: aisle, cookie: "fridge", mug: "coffee", dance: "cooler", joke: "desk", sticky: "desk" }[m.kind] as MeetPlace;
  const label = {
    bump: `Bumped into ${other}`,
    highfive: `A high five with ${other}`,
    trip: side === 0 ? "Tripped!" : `Helping ${other} up`,
    cookie: `The last cookie, with ${other}`,
    mug: side === 0 ? "Looking for a mug" : `Helping ${other} find a mug`,
    dance: `A kitchen dance with ${other}`,
    joke: side === 0 ? `Telling ${other} a joke` : `Hearing ${other}'s joke`,
    sticky: side === 0 ? "A note on the screen" : `Owning up to ${other}`,
  }[m.kind];
  return { kind: "meet", with: other, place, side, until: m.until, label, mark: MOMENT_MARK[m.kind], say: { line: m.lines[side], gesture: m.gestures[side], after: side === 0 ? 0 : 1600 } };
}

const AT_DESK: Partial<Record<Mood, Extract<Plan, { kind: "desk" }>>> = {
  working: { kind: "desk", why: "work", label: "Working", mark: "⌨" },
  thinking: { kind: "desk", why: "think", label: "Thinking", mark: "…" },
  waiting: { kind: "desk", why: "wait", label: "Needs your OK", mark: "!" },
  gym: { kind: "desk", why: "gym", label: "At the gym, learning habits", mark: "🏋" },
};

/** Where its state sends it, whatever its traits say: its desk, the meeting, the sofa; null when it is free. */
export function sentBy(mood: Mood, meeting: boolean): "desk" | "meeting" | "rest" | null {
  if (mood === "waiting") return "desk"; // it waits for you where you will find it
  if (meeting) return "meeting";
  if (AT_DESK[mood]) return "desk";
  if (mood === "dozing" || mood === "asleep") return "rest";
  return null;
}

/** Where food and drink are: the kitchen's spots, the snack tables, the water cooler. */
export const FOOD: ReadonlySet<PoiId> = new Set<PoiId>(["coffee", "fridge", "cooler", "vending", "bistro1", "bistro2"]);

/** What it does now. `busy` are the spots others hold (a POI, a meeting seat), `idle` the others free to
 * visit (with their desks), `r` the dice; `prev` what it did last. A calmer office (owner, 10-07: "slow down the amount of
 * things they do it seems like they go eat a lot then do something else then do another thing, its too much. lively pace
 * please"): food and drink are a small share of what a free orb does and never twice running; after an outing it is
 * likelier to go back to its desk, so the day has a home base. */
export function next(o: { name: string; mood: Mood; meeting: boolean; traits: Traits }, busy: { pois: Set<PoiId>; seats: Set<number>; waitingAt: PoiId | null }, others: string[], r: () => number, prev: Plan | null = null): Plan {
  const sent = sentBy(o.mood, o.meeting);
  if (sent === "desk") return AT_DESK[o.mood] ?? AT_DESK.working!;
  if (sent === "meeting") {
    const seat = SEATS.findIndex((_, i) => !busy.seats.has(i));
    return seat >= 0 ? { kind: "meeting", seat, label: "In a meeting", mark: "💬" } : { kind: "desk", why: "work", label: "In a meeting", mark: "💬" };
  }
  if (sent === "rest") {
    const spot = POIS.find((x) => x.rest && !busy.pois.has(x.id));
    return spot ? { kind: "poi", poi: spot.id, label: o.mood === "asleep" ? "Asleep" : "Dozing", mark: "💤" } : { kind: "desk", why: "tidy", label: o.mood === "asleep" ? "Asleep at the desk" : "Dozing at the desk", mark: "💤" };
  }
  // free: where its traits take it
  const t = o.traits;
  const pull: [Plan, number][] = [];
  const ate = prev?.kind === "poi" && FOOD.has(prev.poi);
  const poi = (id: PoiId, w: number): void => {
    if (busy.pois.has(id) || (ate && FOOD.has(id))) return;
    const x = POIS.find((q) => q.id === id)!;
    pull.push([{ kind: "poi", poi: id, label: x.label, mark: x.mark }, w]);
  };
  poi("coffee", 1.2 + t.Pace * 0.05);
  poi("cooler", 0.4 + t.Humour * 0.02);
  poi("fridge", 0.15 + t.Humour * 0.01);
  poi("vending", 0.1 + t.Pace * 0.01);
  poi(r() < 0.5 ? "bistro1" : "bistro2", 0.2 + t.Calm * 0.01);
  poi("books", 0.4 + t.Curiosity * 0.16);
  poi("window", 0.3 + t.Calm * 0.08);
  poi(["sofa1", "sofa2", "sofa3"][Math.floor(r() * 3)] as PoiId, 0.3 + t.Calm * 0.1);
  poi("beanbag", 0.2 + t.Calm * 0.06);
  poi("arcade", 0.3 + t.Humour * 0.1);
  poi((["plant1", "plant2", "plant3"] as const)[Math.floor(r() * 3)]!, 0.2 + t.Care * 0.12);
  // ping-pong takes two: someone waiting at one end makes the other end far likelier
  const end = busy.waitingAt === "ping1" ? "ping2" : busy.waitingAt === "ping2" ? "ping1" : !busy.pois.has("ping1") ? "ping1" : null;
  if (end && !busy.pois.has(end)) poi(end, busy.waitingAt ? 6 + t.Humour * 0.3 : (0.3 + t.Humour * 0.14) * (others.length ? 1 : 0));
  if (others.length) {
    const who = others[Math.floor(r() * others.length)]!;
    pull.push([{ kind: "visit", who, label: `Chatting with ${who}`, mark: "💬" }, 0.4 + t.Humour * 0.06 + t.Care * 0.06]);
  }
  // its desk, the day's home base: more so after an outing
  const out = prev !== null && prev.kind !== "desk";
  pull.push([{ kind: "desk", why: "tidy", label: "At the desk", mark: "🗂" }, (1.5 + t.Focus * 0.2) * (out ? 2 : 1)]);
  const sum = pull.reduce((n, [, w]) => n + w, 0);
  let x = r() * sum;
  for (const [plan, w] of pull) if ((x -= w) <= 0) return plan;
  return pull[pull.length - 1]![0];
}

/** How long it stays, in ms: 20 to 45 s, longer the calmer (owner, 10-07: "slow down the amount of things they do"; it
 * was 7 to 18 s, a new errand every few seconds). */
export const dwell = (traits: Traits, r: () => number): number => Math.round((20 + r() * 25) * (0.8 + traits.Calm / 30) * 1000);
/** How fast it walks, in plan units a second: quicker the more Pace it has. */
export const speed = (traits: Traits): number => 52 + traits.Pace * 3.4;

/** Dice for one orb: the same orb, the same day, the same walk (mulberry32). */
export function dice(seed: string): () => number {
  let a = 0;
  for (const ch of seed) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whether a conversation is a session's Brainstorm (team.ts: team:<id>:brainstorm). */
export const isMeeting = (conversation: string | null | undefined): boolean => Boolean(conversation && /^team:\d+:brainstorm$/.test(conversation));
