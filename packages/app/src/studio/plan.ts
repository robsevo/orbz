// The game studio's floor (owner, 10-18: "one of the rooms needs to be a gaming studio"; its own floor, as the desk has;
// "games will be huge, to industry standards"). Pure (no React, no DOM), drawn by studio/art.tsx and played by
// studio/Floor.tsx, the desk floor's way: the office's size of plan, so its A* routing (floor/plan.ts `route`) walks this
// floor's own grid.
//
// From the back: the wall, with the build running on its big screen and the milestone board beside it; the audio booth,
// the motion-capture stage and the playtest lounge under it; the corridor; the four pods a studio sits in, each its
// discipline's (design, code, art, production: orb/careers.ts tracks), three rows of desks with two screens each, every
// screen showing its discipline's work; the hallway; then the studio head's office, the QA lab with its devkits and its
// bug board, and the arcade, where the ship gong is rung for work that lands.
import type { HueName } from "../design/tokens.ts";
import { CELL, GH, GW, H, W, type Rect, type Spot } from "../floor/plan.ts";
import { pathOf, type TrackId } from "../orb/careers.ts";

export { H, W };
export const WALL = 84;
const R = 7;
const EDGE = 36;
export const TOP = 300;
export const LOW = 832;

export type AreaId = "audio" | "mocap" | "playtest" | "pods" | "head" | "qa" | "arcade";
export type Area = { id: AreaId; name: string; hue: HueName; rect: Rect; door: { x: number; w: number } | null };
export const AREAS: Area[] = [
  { id: "audio", name: "Audio booth", hue: "violet", rect: { x: 0, y: WALL, w: 392, h: TOP - WALL }, door: { x: 150, w: 90 } },
  { id: "mocap", name: "Mocap stage", hue: "cyan", rect: { x: 404, y: WALL, w: 392, h: TOP - WALL }, door: { x: 555, w: 90 } },
  { id: "playtest", name: "Playtest lounge", hue: "pink", rect: { x: 808, y: WALL, w: 392, h: TOP - WALL }, door: { x: 955, w: 90 } },
  { id: "pods", name: "The pods", hue: "iris", rect: { x: 0, y: 352, w: W, h: 428 }, door: null },
  { id: "head", name: "Studio head", hue: "honey", rect: { x: 0, y: LOW, w: 392, h: H - LOW }, door: { x: 150, w: 90 } },
  { id: "qa", name: "QA lab", hue: "teal", rect: { x: 404, y: LOW, w: 392, h: H - LOW }, door: { x: 555, w: 90 } },
  { id: "arcade", name: "Arcade", hue: "lime", rect: { x: 808, y: LOW, w: 392, h: H - LOW }, door: { x: 955, w: 90 } },
];
export const areaOf = (id: AreaId): Area => AREAS.find((a) => a.id === id)!;

/** The four pods, each its discipline's, side by side across the floor. */
export type PodId = "design" | "code" | "art" | "production";
export const PODS: { id: PodId; name: string; hue: HueName; x: number }[] = [
  { id: "design", name: "Design", hue: "iris", x: 0 },
  { id: "code", name: "Code", hue: "cornflower", x: 300 },
  { id: "art", name: "Art", hue: "coral", x: 600 },
  { id: "production", name: "Production", hue: "amber", x: 900 },
];
/** Which pod each track sits in (orb/careers.ts): audio has its booth, quality its lab, the studio's head its office. */
const POD_OF: Record<TrackId, PodId | "audio" | "qa" | "head"> = {
  design: "design", engineering: "code", indie: "code", art: "art", animation: "art", production: "production", liveops: "production",
  community: "production", direction: "production", audio: "audio", quality: "qa", studio: "head",
};

/** A desk: one seat, two screens, the orb behind it facing you. */
export type SDesk = { pod: PodId | "audio" | "qa"; n: number; rect: Rect; seat: Spot; approach: Spot };
export const SDESK = { w: 96, h: 40 } as const;
const desk = (pod: SDesk["pod"], n: number, x: number, y: number, w: number = SDESK.w): SDesk => ({
  pod, n, rect: { x, y, w, h: SDESK.h }, seat: { x: x + w / 2, y: y + 14 }, approach: { x: x + w / 2, y: y - 20 },
});
export const SDESKS: SDesk[] = [
  ...PODS.flatMap((p, k) => [0, 1, 2].flatMap((row) => [0, 1].map((col) => desk(p.id, k * 6 + row * 2 + col, p.x + 40 + col * 124, 420 + row * 120)))),
  // the audio booth's mixing desk, two at it; the QA lab's bench, four devkits along it
  desk("audio", 24, 52, 196, 100), desk("audio", 25, 158, 196, 100),
  ...[0, 1, 2, 3].map((i) => desk("qa", 26 + i, 434 + i * 82, LOW + 110, 76)),
];

/** The pieces that block the way and can be in front of an orb. */
export const SPIECES = {
  booth: { x: 300, y: 100, w: 72, h: 92 },
  speakerL: { x: 26, y: 186, w: 20, h: 50 },
  rack: { x: 744, y: 100, w: 36, h: 64 },
  camA: { x: 452, y: 104, w: 10, h: 10 },
  camB: { x: 738, y: 230, w: 10, h: 10 },
  camC: { x: 452, y: 230, w: 10, h: 10 },
  tv: { x: 918, y: 96, w: 144, h: 54 },
  couch: { x: 900, y: 214, w: 180, h: 40 },
  beanbag: { x: 1110, y: 166, w: 46, h: 32 },
  headDesk: { x: 100, y: LOW + 96, w: 180, h: 44 },
  awards: { x: 24, y: LOW + 22, w: 120, h: 30 },
  bugs: { x: 690, y: LOW + 22, w: 90, h: 30 },
  cabA: { x: 830, y: LOW + 26, w: 46, h: 62 },
  cabB: { x: 886, y: LOW + 26, w: 46, h: 62 },
  pinball: { x: 960, y: LOW + 30, w: 50, h: 66 },
  snacks: { x: 1112, y: LOW + 22, w: 62, h: 70 },
  gong: { x: 1040, y: LOW + 108, w: 52, h: 50 },
} satisfies Record<string, Rect>;

export type SPoiId = "arcade" | "pinball" | "snacks" | "gong" | "couch" | "mocap" | "booth" | "mixing" | "sprint" | "concept" | "bugs" | "head" | "build";
export type SPoi = { id: SPoiId; approach: Spot; at: Spot; label: string; mark: string };
const P = (id: SPoiId, x: number, y: number, label: string, mark: string, at?: Spot): SPoi => ({ id, approach: { x, y }, at: at ?? { x, y }, label, mark });
export const SPOIS: SPoi[] = [
  P("arcade", 880, LOW + 120, "Playing the arcade", "🕹"),
  P("pinball", 985, LOW + 124, "Playing pinball", "🎯"),
  P("snacks", 1142, LOW + 120, "Grabbing a snack", "🍕"),
  P("gong", 1066, LOW + 180, "Ringing the ship gong", "🥁"),
  P("couch", 990, 274, "Playtesting the build", "🎮", { x: 990, y: 240 }),
  P("mocap", 600, 190, "In the mocap suit", "🤸"),
  P("booth", 336, 214, "Recording foley", "🎙"),
  P("mixing", 160, 270, "Mixing the score", "🎚"),
  P("sprint", 1114, 332, "Moving cards on the milestone board", "📌"),
  P("concept", 720, 332, "Pinning up concept art", "🖼"),
  P("bugs", 735, LOW + 76, "Filing a bug", "🐞"),
  P("head", 190, LOW + 76, "Pitching to the studio head", "📋"),
  P("build", 300, 332, "Watching the build", "📺"),
];

const withDoor = (x: number, y: number, w: number, h: number, door: { x: number; w: number }): Rect[] => [
  { x, y, w: door.x - x, h },
  { x: door.x + door.w, y, w: x + w - door.x - door.w, h },
];
export const SBLOCKS: Rect[] = [
  { x: 0, y: 0, w: W, h: WALL + 4 },
  { x: 392, y: WALL, w: 12, h: TOP - WALL },
  { x: 796, y: WALL, w: 12, h: TOP - WALL },
  ...AREAS.filter((a) => a.rect.y === WALL).flatMap((a) => withDoor(a.rect.x, TOP - 8, a.rect.w, 8, a.door!)),
  ...AREAS.filter((a) => a.rect.y === LOW).flatMap((a) => withDoor(a.rect.x, LOW - 4, a.rect.w, 8, a.door!)),
  { x: 392, y: LOW, w: 12, h: H - LOW },
  { x: 796, y: LOW, w: 12, h: H - LOW },
  ...SDESKS.map((d) => d.rect),
  ...Object.values(SPIECES),
];

/** This floor's walking grid, in the office grid's cells (the office's `route` walks it). */
export const SGRID: Uint8Array = (() => {
  const g = new Uint8Array(GW * GH);
  for (const b of SBLOCKS)
    for (let gy = Math.max(0, Math.floor((b.y - R) / CELL)); gy < Math.min(GH, Math.ceil((b.y + b.h + R) / CELL)); gy++)
      for (let gx = Math.max(0, Math.floor((b.x - R) / CELL)); gx < Math.min(GW, Math.ceil((b.x + b.w + R) / CELL)); gx++) g[gy * GW + gx] = 1;
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) if (gx * CELL < EDGE || (gx + 1) * CELL > W - EDGE || (gy + 1) * CELL > H - EDGE + 8) g[gy * GW + gx] = 1;
  return g;
})();

/** Where a studio job sits: its track's pod, booth, lab or office. */
export const podOf = (specialty: string): PodId | "audio" | "qa" | "head" => POD_OF[pathOf(specialty)?.track ?? "indie"];

export type Seat = { desk: SDesk | null; seat: Spot; approach: Spot };
/** Each of the studio's orbs' seats, in the studio's order: the head in its office, everyone else at a desk in its own
 * discipline's place, and past those, the first desk free anywhere. */
export function studioSeats(orbs: { name: string; specialty: string }[]): Map<string, Seat> {
  const out = new Map<string, Seat>();
  const taken = new Set<SDesk>();
  const later: { name: string; specialty: string }[] = [];
  let head = false;
  for (const o of orbs) {
    const where = podOf(o.specialty);
    if (where === "head" && !head) {
      head = true;
      out.set(o.name, { desk: null, seat: { x: SPIECES.headDesk.x + 90, y: SPIECES.headDesk.y + 12 }, approach: { x: SPIECES.headDesk.x + 90, y: SPIECES.headDesk.y - 20 } });
      continue;
    }
    const d = SDESKS.find((x) => x.pod === where && !taken.has(x));
    if (!d) {
      later.push(o);
      continue;
    }
    taken.add(d);
    out.set(o.name, { desk: d, seat: d.seat, approach: d.approach });
  }
  for (const o of later) {
    const d = SDESKS.find((x) => x.pod !== "audio" && x.pod !== "qa" && !taken.has(x)) ?? SDESKS.find((x) => !taken.has(x)) ?? SDESKS[out.size % SDESKS.length]!;
    taken.add(d);
    out.set(o.name, { desk: d, seat: d.seat, approach: d.approach });
  }
  return out;
}

// ── what one of the studio's orbs does next ──────────────────────────────────────────────────────────────────
export type SPlan = { kind: "desk"; label: string; mark: string } | { kind: "poi"; poi: SPoiId; label: string; mark: string };
type Traits = { Pace: number; Care: number; Curiosity: number; Humour: number; Focus: number; Calm: number; Nerve: number };

/** Where each job leans when it is free, times what its traits say: animators to the mocap stage, audio to its booth and
 * its desk, UX and QA to playtests, QA to its bug board, artists to the concept wall, producers to the milestone board,
 * the engine's programmers back to their screens. */
const LEANS: Record<string, Partial<Record<SPoiId | "desk", number>>> = {
  animator: { mocap: 4 }, sounddesign: { booth: 4, mixing: 2 }, composer: { mixing: 4 },
  gameux: { couch: 3 }, gameqa: { couch: 2, bugs: 4 }, gamedesign: { couch: 2, build: 1.5 }, leveldesign: { couch: 2, build: 2 },
  concept: { concept: 4 }, charart: { concept: 2 }, envart: { concept: 2 }, vfx: { build: 2 }, techart: { build: 2, mocap: 1.5 },
  producer: { sprint: 4 }, gamedirector: { sprint: 2, couch: 2, build: 2 }, studiohead: { sprint: 2 }, liveops: { sprint: 2, couch: 1.5 },
  community: { couch: 2, arcade: 2 }, gameplay: { couch: 1.5, arcade: 1.5 }, gameai: { couch: 1.5 },
  engine: { desk: 1.6 }, graphics: { desk: 1.4, build: 1.5 }, netcode: { desk: 1.6 }, tools: { desk: 1.6 },
};

/** Where a free orb of the studio goes, by its traits (Focus back to its screens, Humour to the arcade and pinball, Pace
 * to the snacks, Curiosity to the build and the concept wall, Calm to the booth, Nerve to the mocap stage, Care to the bug
 * board) and its job's lean. */
export function nextS(o: { traits: Traits; working: boolean; job?: string }, busy: Set<SPoiId>, r: () => number): SPlan {
  if (o.working) return { kind: "desk", label: "Making the game", mark: "🎮" };
  const t = o.traits;
  const pick: [SPoiId | "desk", number][] = [
    ["desk", 4 + t.Focus],
    ["arcade", t.Humour / 2], ["pinball", t.Humour / 3], ["snacks", t.Pace / 2], ["couch", t.Curiosity / 3 + t.Humour / 4],
    ["build", t.Curiosity / 3], ["concept", t.Curiosity / 4], ["booth", t.Calm / 4], ["mixing", t.Calm / 4], ["mocap", t.Nerve / 3],
    ["bugs", t.Care / 3], ["sprint", t.Focus / 4 + t.Care / 4], ["head", t.Nerve / 5],
  ];
  const lean = LEANS[o.job ?? ""] ?? {};
  const open = pick.filter(([id]) => id === "desk" || !busy.has(id)).map(([id, w]): [SPoiId | "desk", number] => [id, w * (lean[id] ?? 1)]);
  const total = open.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [id, w] of open) {
    if ((x -= w) > 0) continue;
    if (id === "desk") return { kind: "desk", label: "At the desk", mark: "🖥" };
    const poi = SPOIS.find((p) => p.id === id)!;
    return { kind: "poi", poi: id, label: poi.label, mark: poi.mark };
  }
  return { kind: "desk", label: "At the desk", mark: "🖥" };
}

/** What the home's events make a studio orb say and do (a studio's floor: loud when something lands). */
export const LINES = {
  shipped: ["Build's green! 🥁", "Ship it!", "Gold master.", "That's going in the trailer.", "Merged. No crunch.", "It's fun now!"],
  stopped: ["Back to the whiteboard.", "Cut for scope.", "Bug bash time.", "That one needs a rethink."],
  ask: ["Needs your yes ✍️", "Greenlight?", "Your call, boss."],
  promoted: ["Promoted! 🎉", "New title, same coffee.", "Leveled up IRL."],
  started: ["Prototyping.", "Blocking it out.", "Compiling…", "First pass."],
} as const;
export const lineOf = (kind: keyof typeof LINES, seed: number): string => LINES[kind][Math.abs(Math.floor(seed)) % LINES[kind].length]!;

export type SMoment = { poi: SPoiId | null; line: string; gong?: boolean };
/** What one of the home's events makes its studio orb do on the floor: where it goes (null: it stays where it is), what
 * it says, the gong rung for work that lands; null for an event that is not a moment. */
export function momentOf(e: { type: string; outcome?: unknown; seq: number }): SMoment | null {
  switch (e.type) {
    case "run.finished":
      if (e.outcome === "ok") return { poi: "gong", line: lineOf("shipped", e.seq), gong: true };
      return e.outcome === "failed" ? { poi: "sprint", line: lineOf("stopped", e.seq) } : null;
    case "run.started":
      return { poi: null, line: lineOf("started", e.seq) };
    case "card.opened":
      return { poi: "head", line: lineOf("ask", e.seq) };
    case "orb.promoted":
      return { poi: "gong", line: lineOf("promoted", e.seq), gong: true };
    default:
      return null;
  }
}
