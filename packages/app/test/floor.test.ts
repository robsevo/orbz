// The office floor's plan (floor/plan.ts; owner, 10-05: "the office should be a whole office visual of them
// working in an office. every dept is different ... see them move around the office etc. they sit at their
// desks"):
//   - every desk, meeting seat and place to go can be walked to from the corridor, and no way crosses
//     a wall or a desk; control: wall off the corridor and the departments are out of reach;
//   - what an orb's state sends it to: working, thinking, waiting for you or at the gym, its desk; a
//     Brainstorm, the meeting table (waiting outranks it); dozing or asleep, the sofa; idle, free;
//   - free, it never takes a spot someone holds, and a player waiting at the ping-pong table draws
//     the next one to the other end; Pace is its walking speed;
//   - each orb's desk is in its department, six to a department, the seventh at a free desk elsewhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CELL, CORRIDOR, DESKS, GH, GRID, GW, POIS, SEATS, ZONES, clear, dice, isMeeting, next, route, seating, sentBy, speed, type PoiId, type Traits } from "../src/floor/plan.ts";

const corridor = { x: 600, y: CORRIDOR.y + CORRIDOR.h / 2 };
const spots = [...DESKS.map((d) => [`desk ${d.zone}${d.n}`, d.approach] as const), ...SEATS.map((s, i) => [`seat ${i}`, s.approach] as const), ...POIS.map((p) => [`${p.id}`, p.approach] as const)];
const even: Traits = { Pace: 10, Care: 10, Curiosity: 10, Humour: 10, Focus: 10, Calm: 10, Nerve: 10 };

test("every desk, seat and place to go is reachable from the corridor, and no way crosses a wall; walled off, they are not", () => {
  for (const [what, at] of spots) {
    const way = route(corridor, at);
    assert.ok(way, `${what} is reachable`);
    for (let i = 1; i < way.length - 1; i++) assert.ok(clear(way[i - 1]!, way[i]!), `${what}: the way's leg ${i} is clear`);
  }
  // control: a wall across the corridor's width, both rows of departments behind it
  const walled = GRID.slice();
  for (let gy = Math.floor(CORRIDOR.y / CELL); gy < Math.ceil((CORRIDOR.y + CORRIDOR.h) / CELL); gy++) for (let gx = 0; gx < GW; gx++) walled[gy * GW + gx] = 1;
  const top = { x: 600, y: 240 }; // in the meeting room
  assert.ok(route(top, SEATS[0]!.approach, walled), "the walled grid still routes: the meeting room reaches its own seats");
  const cut = DESKS.filter((d) => !route(top, d.approach, walled));
  assert.equal(cut.length, DESKS.length, "with the corridor walled off, no desk is in reach of the rooms");
  assert.equal(walled.length, GW * GH);
});

test("what an orb's state sends it to", () => {
  assert.equal(sentBy("working", false), "desk");
  assert.equal(sentBy("thinking", false), "desk");
  assert.equal(sentBy("gym", false), "desk");
  assert.equal(sentBy("waiting", true), "desk", "waiting for you outranks a meeting: it waits where you find it");
  assert.equal(sentBy("thinking", true), "meeting");
  assert.equal(sentBy("dozing", false), "rest");
  assert.equal(sentBy("asleep", false), "rest");
  assert.equal(sentBy("idle", false), null, "free");
  assert.ok(isMeeting("team:4:brainstorm") && !isMeeting("team:4:floor") && !isMeeting("chat:ash") && !isMeeting(null));
  const r = dice("x");
  const none = { pois: new Set<PoiId>(), seats: new Set<number>(), waitingAt: null };
  assert.equal(next({ name: "A", mood: "working", meeting: false, traits: even }, none, [], r).kind, "desk");
  const m = next({ name: "A", mood: "thinking", meeting: true, traits: even }, { ...none, seats: new Set([0, 1]) }, [], r);
  assert.ok(m.kind === "meeting" && m.seat === 2, "the first free seat at the table");
  const z = next({ name: "A", mood: "asleep", meeting: false, traits: even }, { ...none, pois: new Set<PoiId>(["sofa1"]) }, [], r);
  assert.ok(z.kind === "poi" && z.poi !== "sofa1" && POIS.find((p) => p.id === z.poi)!.rest, "a free sofa seat, or the beanbag");
});

test("free, it never takes a spot someone holds; someone waiting at the ping-pong table draws a partner; Pace is speed", () => {
  const held = new Set<PoiId>(POIS.map((p) => p.id).filter((id) => id !== "books" && id !== "coffee"));
  const r = dice("free");
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const p = next({ name: "A", mood: "idle", meeting: false, traits: even }, { pois: held, seats: new Set(), waitingAt: null }, [], r);
    if (p.kind === "poi") assert.ok(!held.has(p.poi), `never ${p.poi}, which is held`);
    seen.add(p.kind === "poi" ? p.poi : p.kind);
  }
  assert.ok(seen.has("books") && seen.has("coffee") && seen.has("desk"), [...seen].join());
  // a player waiting at one end: the other end comes up far more often than alone
  const count = (waitingAt: PoiId | null, pois: Set<PoiId>): number => {
    const rr = dice("ping");
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const p = next({ name: "B", mood: "idle", meeting: false, traits: even }, { pois, seats: new Set(), waitingAt }, ["A"], rr);
      if (p.kind === "poi" && p.poi === "ping2") n++;
    }
    return n;
  };
  const drawn = count("ping1", new Set<PoiId>(["ping1"]));
  assert.ok(drawn > 400, `with a player waiting, the other end often (${drawn} of 2000)`);
  assert.ok(speed({ ...even, Pace: 16 }) > speed({ ...even, Pace: 4 }));
});

test("each orb's desk is in its department, six to one; the seventh sits at a free desk elsewhere", () => {
  const orbs = [...Array.from({ length: 7 }, (_, i) => ({ name: `B${i}`, family: "build" as const })), { name: "L", family: "life" as const }];
  const s = seating(orbs);
  for (let i = 0; i < 6; i++) assert.equal(s.get(`B${i}`)!.zone, "build");
  assert.notEqual(s.get("B6")!.zone, "build", "the seventh: a desk elsewhere");
  assert.equal(s.get("L")!.zone, "life");
  assert.equal(new Set(s.values()).size, orbs.length, "no desk twice");
  assert.equal(ZONES.filter((z) => z.id !== "play").length, 5, "the five departments");
});
