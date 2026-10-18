// The game studio's floor plan, pure (studio/plan.ts; owner, 10-18: "one of the rooms needs to be a gaming studio", its
// own floor): its rooms apart and on the floor; every desk's seat and every place an orb goes on a free spot, reached
// from the corridor on the floor's own grid (a room with its door shut is not: the control); a seat for each orb in its
// discipline's place, the head's in its office; a free orb goes only where it is free to, each job leaning where its
// work is; and the home's events as moments: work that lands rings the ship gong.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CELL, GW, route, type Spot } from "../src/floor/plan.ts";
import { AREAS, H, LINES, momentOf, nextS, podOf, PODS, SDESKS, SGRID, SPOIS, studioSeats, W, type SPoiId } from "../src/studio/plan.ts";
import { SPECIALTIES } from "../src/orb/spec.ts";

const ENTRY = { x: 600, y: 330 }; // where an orb comes onto the floor (studio/Floor.tsx)
const traits = { Pace: 10, Care: 10, Curiosity: 10, Humour: 10, Focus: 10, Calm: 10, Nerve: 10 };
const studio = Object.entries(SPECIALTIES).filter(([, v]) => (v as { family: string }).family === "studio").map(([k]) => k);

test("its rooms are apart and on the floor; every seat and every place to go is reached from the corridor", () => {
  for (const a of AREAS) assert.ok(a.rect.x >= 0 && a.rect.y >= 0 && a.rect.x + a.rect.w <= W && a.rect.y + a.rect.h <= H, `${a.id} on the floor`);
  for (const [i, a] of AREAS.entries())
    for (const b of AREAS.slice(i + 1)) {
      const apart = a.rect.x + a.rect.w <= b.rect.x || b.rect.x + b.rect.w <= a.rect.x || a.rect.y + a.rect.h <= b.rect.y || b.rect.y + b.rect.h <= a.rect.y;
      assert.ok(apart, `${a.id} and ${b.id} do not overlap`);
    }
  assert.equal(SDESKS.length, 30, "four pods of six, two at the mixing desk, four at the QA bench");
  assert.equal(new Set(SDESKS.map((d) => d.n)).size, SDESKS.length);
  const free = (p: Spot): boolean => SGRID[Math.floor(p.y / CELL) * GW + Math.floor(p.x / CELL)] === 0;
  const reached = (p: Spot, grid = SGRID): boolean => route(ENTRY, p, grid) !== null;
  for (const d of SDESKS) assert.ok(free(d.approach) && reached(d.approach), `desk ${d.pod}${d.n}'s seat is reached`);
  for (const p of SPOIS) {
    assert.ok(p.approach.y < H - 30, `${p.id} is on the floor`);
    assert.ok(free(p.approach) && reached(p.approach), `${p.id} is reached`);
  }
  // the control: the arcade's door shut, the gong is not reached
  const arcade = AREAS.find((a) => a.id === "arcade")!;
  const shut = SGRID.slice();
  for (let gy = Math.floor((arcade.rect.y - 12) / CELL); gy <= Math.ceil((arcade.rect.y + 12) / CELL); gy++)
    for (let gx = Math.floor(arcade.door!.x / CELL) - 1; gx <= Math.ceil((arcade.door!.x + arcade.door!.w) / CELL) + 1; gx++) shut[gy * GW + gx] = 1;
  const gong = SPOIS.find((p) => p.id === "gong")!.approach;
  assert.ok(reached(gong) && !reached(gong, shut));
});

test("every studio job sits in its discipline's place: designers in Design, programmers in Code, audio in its booth, QA in its lab", () => {
  for (const s of studio) assert.ok(["design", "code", "art", "production", "audio", "qa", "head"].includes(podOf(s)), s);
  assert.equal(podOf("leveldesign"), "design");
  assert.equal(podOf("netcode"), "code");
  assert.equal(podOf("games"), "code");
  assert.equal(podOf("animator"), "art");
  assert.equal(podOf("liveops"), "production");
  assert.equal(podOf("composer"), "audio");
  assert.equal(podOf("gameqa"), "qa");
  assert.equal(podOf("studiohead"), "head");
  assert.equal(PODS.length, 4);
});

test("a seat for each of the studio's orbs, in its own place; the head in its office; past a place's desks, a free one elsewhere", () => {
  const crew = [
    { name: "Lia", specialty: "studiohead" }, { name: "Gil", specialty: "gameplay" }, { name: "Mo", specialty: "leveldesign" },
    { name: "Zed", specialty: "composer" }, { name: "Tess", specialty: "gameqa" }, { name: "Ana", specialty: "studiohead" },
    ...Array.from({ length: 7 }, (_, i) => ({ name: `Coder${i}`, specialty: "engine" })),
  ];
  const seats = studioSeats(crew);
  assert.equal(seats.size, crew.length);
  assert.equal(seats.get("Lia")!.desk, null, "the first head in its office");
  assert.ok(seats.get("Ana")!.desk, "a second one at a desk");
  assert.equal(seats.get("Gil")!.desk!.pod, "code");
  assert.equal(seats.get("Mo")!.desk!.pod, "design");
  assert.equal(seats.get("Zed")!.desk!.pod, "audio");
  assert.equal(seats.get("Tess")!.desk!.pod, "qa");
  // the code pod holds six: Gil and five coders; the last two are seated elsewhere, never on someone's lap
  assert.equal([...seats.values()].filter((s) => s.desk?.pod === "code").length, 6);
  const at = [...seats.values()].map((s) => `${s.seat.x},${s.seat.y}`);
  assert.equal(new Set(at).size, at.length, "no two in one seat");
  for (const s of seats.values()) assert.ok(route(ENTRY, s.approach, SGRID));
});

test("a free orb goes only where it is free to; working, it is at its desk", () => {
  let n = 0;
  const r = (): number => ((n = (n * 9301 + 49297) % 233280) / 233280);
  assert.equal(nextS({ traits, working: true }, new Set(), r).kind, "desk");
  const busy = new Set<SPoiId>(["arcade", "couch", "snacks", "gong"]);
  const went = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const p = nextS({ traits, working: false }, busy, r);
    went.add(p.kind === "desk" ? "desk" : p.poi);
    if (p.kind === "poi") assert.ok(!busy.has(p.poi), `${p.poi} is taken`);
  }
  assert.ok(went.size >= 6, `it goes about the floor: ${[...went].join(", ")}`);
});

test("each job leans where its work is: animators to mocap, audio to its booth, QA to the bug board, producers to the milestone board", () => {
  let n = 7;
  const r = (): number => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const where = (job: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < 2_000; i++) {
      const p = nextS({ traits, working: false, job }, new Set(), r);
      const k = p.kind === "desk" ? "desk" : p.poi;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const [base, animator, sound, qa, producer, engine] = ["economy", "animator", "sounddesign", "gameqa", "producer", "engine"].map(where) as Map<string, number>[];
  const more = (m: Map<string, number>, k: string): void => assert.ok(m.get(k)! > 2 * (base!.get(k) ?? 0), `${k}: ${m.get(k)} against ${base!.get(k)}`);
  more(animator!, "mocap");
  more(sound!, "booth");
  more(qa!, "bugs");
  more(producer!, "sprint");
  assert.ok(engine!.get("desk")! > base!.get("desk")!, "the engine's programmers back to their screens");
});

test("the home's events as moments: work that lands rings the gong, work that stops goes back to the board, an ask goes to the head", () => {
  const shipped = momentOf({ type: "run.finished", outcome: "ok", seq: 3 })!;
  assert.deepEqual([shipped.poi, shipped.gong], ["gong", true]);
  assert.ok((LINES.shipped as readonly string[]).includes(shipped.line));
  const stopped = momentOf({ type: "run.finished", outcome: "failed", seq: 4 })!;
  assert.deepEqual([stopped.poi, stopped.gong], ["sprint", undefined]);
  assert.equal(momentOf({ type: "run.finished", outcome: "cancelled", seq: 4 }), null);
  assert.deepEqual(momentOf({ type: "run.started", seq: 1 }), { poi: null, line: LINES.started[1] });
  assert.equal(momentOf({ type: "card.opened", seq: 1 })!.poi, "head");
  assert.equal(momentOf({ type: "orb.promoted", seq: 1 })!.gong, true);
  assert.equal(momentOf({ type: "xp.earned", seq: 1 }), null, "not every event is a moment");
  for (const p of ["gong", "sprint", "head"] as const) assert.ok(SPOIS.some((x) => x.id === p));
});
