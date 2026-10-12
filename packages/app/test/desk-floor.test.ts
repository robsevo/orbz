// The desk floor's plan, pure (desk/plan.ts, PLAN 5.22): its rooms apart and on the floor; every desk's seats and
// every place an orb goes on a free spot, reached from the corridor on the floor's own grid (a room with its door shut
// is not: the control);
// a seat for each orb, its head's in the glass office; a free orb goes only where it is free to; and what
// the desk really does is each orb's moment: a trade won rings the bell, a loss is a coffee, a fill flashes its screens.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CELL, GW, route, type Spot } from "../src/floor/plan.ts";
import { AREAS, H, LINES, momentOf, nextT, TDESKS, TGRID, TPOIS, deskSeats, W, type TPoiId } from "../src/desk/plan.ts";

const ENTRY = { x: 600, y: 330 }; // where an orb comes onto the floor (desk/Floor.tsx)
const traits = { Pace: 10, Care: 10, Curiosity: 10, Humour: 10, Focus: 10, Calm: 10, Nerve: 10 };

test("its rooms are apart and on the floor; every seat and every place to go is reached from the corridor", () => {
  for (const a of AREAS) assert.ok(a.rect.x >= 0 && a.rect.y >= 0 && a.rect.x + a.rect.w <= W && a.rect.y + a.rect.h <= H, `${a.id} on the floor`);
  for (const [i, a] of AREAS.entries())
    for (const b of AREAS.slice(i + 1)) {
      const apart = a.rect.x + a.rect.w <= b.rect.x || b.rect.x + b.rect.w <= a.rect.x || a.rect.y + a.rect.h <= b.rect.y || b.rect.y + b.rect.h <= a.rect.y;
      assert.ok(apart, `${a.id} and ${b.id} do not overlap`);
    }
  assert.equal(TDESKS.length, 12);
  const free = (p: Spot): boolean => TGRID[Math.floor(p.y / CELL) * GW + Math.floor(p.x / CELL)] === 0;
  const reached = (p: Spot, grid = TGRID): boolean => route(ENTRY, p, grid) !== null;
  for (const d of TDESKS) for (const spot of d.approach) assert.ok(free(spot) && reached(spot), `desk ${d.n}'s seat is reached`);
  for (const p of TPOIS) assert.ok(free(p.approach) && reached(p.approach), `${p.id} is reached`);
  // the control: the head's door shut, the room is not reached
  const head = AREAS.find((a) => a.id === "head")!;
  const shut = TGRID.slice();
  for (let gy = Math.floor((head.rect.y - 12) / CELL); gy <= Math.ceil((head.rect.y + 12) / CELL); gy++)
    for (let gx = Math.floor(head.door!.x / CELL) - 1; gx <= Math.ceil((head.door!.x + head.door!.w) / CELL) + 1; gx++) shut[gy * GW + gx] = 1;
  const inside = TPOIS.find((p) => p.id === "head")!.approach;
  assert.ok(reached(inside) && !reached(inside, shut));
});

test("a seat for each of the desk's orbs, its head's in the glass office", () => {
  const crew = [
    { name: "Kit", specialty: "dealer" }, { name: "Vic", specialty: "deskhead" }, { name: "Quinn", specialty: "quant" },
    { name: "Oz", specialty: "onchain" }, { name: "Rae", specialty: "risk" }, { name: "Ana", specialty: "deskhead" },
  ];
  const seats = deskSeats(crew);
  assert.equal(seats.size, crew.length);
  assert.equal(seats.get("Vic")!.desk, null, "the first head in the glass office");
  assert.ok(seats.get("Ana")!.desk, "a second one at a desk");
  const at = [...seats.values()].map((s) => `${s.seat.x},${s.seat.y}`);
  assert.equal(new Set(at).size, at.length, "no two in one seat");
  for (const s of seats.values()) assert.ok(route(ENTRY, s.approach, TGRID));
});

test("a free orb goes only where it is free to; working, it is at its screens", () => {
  let n = 0;
  const r = (): number => ((n = (n * 9301 + 49297) % 233280) / 233280);
  assert.equal(nextT({ traits, working: true }, new Set(), r).kind, "desk");
  const busy = new Set<TPoiId>(["coffee", "bell", "board", "wall"]);
  const went = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const p = nextT({ traits, working: false }, busy, r);
    went.add(p.kind === "desk" ? "desk" : p.poi);
    if (p.kind === "poi") assert.ok(!busy.has(p.poi), `${p.poi} is taken`);
  }
  assert.ok(went.size >= 6, `it goes about the floor: ${[...went].join(", ")}`);
});

test("each job leans where its work is (PLAN 5.40): the two on risk to the risk desk, research to the shelf and the whiteboard, development to its screens", () => {
  let n = 7;
  const r = (): number => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const where = (job: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < 2_000; i++) {
      const p = nextT({ traits, working: false, job }, new Set(), r);
      const k = p.kind === "desk" ? "desk" : p.poi;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const [dealer, analyst, researcher, developer] = ["dealer", "riskanalyst", "quantres", "quantdev"].map(where) as Map<string, number>[];
  assert.ok(analyst!.get("risk")! > 2 * (dealer!.get("risk") ?? 0), `the risk desk: ${analyst!.get("risk")} against ${dealer!.get("risk")}`);
  assert.ok(researcher!.get("shelf")! + researcher!.get("whiteboard")! > 2 * ((dealer!.get("shelf") ?? 0) + (dealer!.get("whiteboard") ?? 0)), "the shelf and the whiteboard");
  assert.ok(developer!.get("desk")! > dealer!.get("desk")!, "its screens");
});

test("the desk's events as moments: a win rings the bell, a loss is a coffee, a fill flashes, a note is pinned, an ask goes to the head", () => {
  const won = momentOf({ type: "desk.trade_closed", pnl: 12.5, seq: 3 })!;
  assert.deepEqual([won.poi, won.ring], ["bell", true]);
  assert.ok((LINES.won as readonly string[]).includes(won.line));
  const lost = momentOf({ type: "desk.trade_closed", pnl: -4, seq: 4 })!;
  assert.deepEqual([lost.poi, lost.ring], ["coffee", false]);
  assert.ok((LINES.lost as readonly string[]).includes(lost.line));
  assert.deepEqual(momentOf({ type: "desk.fill", side: "buy", seq: 1 }), { poi: null, line: LINES.bought[1 % LINES.bought.length], flash: "ok" });
  assert.equal(momentOf({ type: "desk.fill", side: "sell", seq: 1 })!.flash, "off");
  assert.equal(momentOf({ type: "desk.note", seq: 1 })!.poi, "cork");
  assert.equal(momentOf({ type: "desk.strategy_saved", seq: 1 })!.poi, "whiteboard");
  assert.equal(momentOf({ type: "desk.swap_asked", seq: 1 })!.poi, "head");
  assert.equal(momentOf({ type: "desk.swap_settled", seq: 1 }), null, "not every event is a moment");
  // every place a moment sends an orb is a place on the floor
  for (const p of ["bell", "coffee", "cork", "whiteboard", "head"] as const) assert.ok(TPOIS.some((x) => x.id === p));
});
