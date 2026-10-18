// The office floor's plan (floor/plan.ts; owner, 10-05: "the office should be a whole office visual of them
// working in an office. every dept is different ... see them move around the office etc. they sit at their
// desks"):
//   - every desk, meeting seat and place to go can be walked to from the corridor, and no way crosses
//     a wall or a desk; control: wall off the corridor and the departments are out of reach;
//   - what an orb's state sends it to: working, thinking or waiting for you, its desk; the night's gym, the gym
//     (its desk once the gym is full); a Brainstorm, the meeting table (waiting outranks it); dozing or asleep,
//     the sofa; idle, free;
//   - the bottom rooms (owner, 10-08: "Gym, Classroom, Library and Interview room"): each reached by its door
//     on the second hallway (walled off, they are not); a lesson between friends taught in the classroom;
//     Pace takes a free orb to the gym, Curiosity to the library;
//   - free, it never takes a spot someone holds, and a player waiting at the ping-pong table draws
//     the next one to the other end; Pace is its walking speed;
//   - each orb's desk is in its department, six to a department, the seventh at a free desk elsewhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CELL, CLASS_DESKS, CORRIDOR, DESKS, FOOD, GH, GRID, GW, GYM, HALL, POIS, ROOMS, SEATS, W, ZONES, clear, dice, dwell, isMeeting, meetPlan, meetSpot, momentPlan, next, route, seating, sentBy, speed, type MomentKind, type Plan, type PoiId, type Traits } from "../src/floor/plan.ts";
import { FLOOR_ORB, walkWobble } from "../src/floor/motion.ts";

const corridor = { x: 600, y: CORRIDOR.y + CORRIDOR.h / 2 };
const spots = [...DESKS.map((d) => [`desk ${d.zone}${d.n}`, d.approach] as const), ...SEATS.map((s, i) => [`seat ${i}`, s.approach] as const), ...POIS.map((p) => [`${p.id}`, p.approach] as const), ...CLASS_DESKS.map((d, i) => [`class desk ${i}`, d.approach] as const)];
const even: Traits = { Pace: 10, Care: 10, Curiosity: 10, Humour: 10, Focus: 10, Calm: 10, Nerve: 10 };

test("floor orbs are solid and bigger than they were (owner, 10-18: \"like ghosts\"), and giggle side to side while they walk", () => {
  assert.equal(FLOOR_ORB.solid, true);
  assert.ok(FLOOR_ORB.size > 84, "bigger than the office's 84");
  const a = walkWobble(Math.PI / 2, 1);
  const b = walkWobble(Math.PI * 1.5, 1);
  assert.match(a, /translate\([^,]+, -6\.0px\) rotate\(7\.0deg\) scaleY\(/);
  assert.match(b, /translate\([^,]+, -6\.0px\) rotate\(-7\.0deg\) scaleY\(/);
  assert.notEqual(a, b, "the wobble changes side as its step changes");
});

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
  // and the bottom rooms are reached only by the second hallway: walled off, none of their spots is in reach
  const hall = GRID.slice();
  for (let gy = Math.floor(HALL.y / CELL); gy < Math.ceil((HALL.y + HALL.h) / CELL); gy++) for (let gx = 0; gx < GW; gx++) hall[gy * GW + gx] = 1;
  const low = [...POIS.filter((q) => q.approach.y > HALL.y + HALL.h).map((q) => q.approach), ...CLASS_DESKS.map((d) => d.approach)];
  assert.ok(low.length >= 12, `control: the bottom rooms have their spots (${low.length})`);
  assert.deepEqual(low.filter((at) => route(corridor, at, hall)), [], "with the second hallway walled off, nothing in the bottom rooms is in reach");
  assert.ok(ROOMS.filter((r) => r.wall > HALL.y).every((r) => r.door.x >= r.rect.x && r.door.x + r.door.w <= r.rect.x + r.rect.w), "each bottom room's door is in its own wall");
});

test("every side of every meeting place (office life, PLAN 5.9) is inside the floor and reachable, the two apart", () => {
  for (const place of ["coffee", "cooler", "bistro1", "bistro2", "pingpong", "arcade", "fridge", "plant1", "plant2", "plant3", "classroom"] as const) {
    const [a, b] = [meetSpot(place, 0), meetSpot(place, 1)];
    for (const [side, x] of [[0, a], [1, b]] as const) {
      for (const p of [x.approach, x.at]) assert.ok(p.x >= 48 && p.x <= W - 48, `${place}, side ${side}: inside the floor (x ${p.x})`);
      assert.ok(route(corridor, x.approach), `${place}, side ${side}: reachable`);
    }
    assert.ok(Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) >= 30, `${place}: the two stand apart`);
  }
});

test("what an orb's state sends it to", () => {
  assert.equal(sentBy("working", false), "desk");
  assert.equal(sentBy("thinking", false), "desk");
  assert.equal(sentBy("gym", false), "gym", "the night's gym: the gym, not its desk (owner, 10-08)");
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
  // the gym: a free spot in it, said as learning; full, its desk, as before there was a gym
  const g = next({ name: "A", mood: "gym", meeting: false, traits: even }, { ...none, pois: new Set<PoiId>(["tread1"]) }, [], r);
  assert.ok(g.kind === "poi" && g.by === "gym" && g.poi !== "tread1" && GYM.includes(g.poi), JSON.stringify(g));
  assert.equal(g.label, "At the gym, learning habits");
  const full = next({ name: "A", mood: "gym", meeting: false, traits: even }, { ...none, pois: new Set<PoiId>(GYM) }, [], r);
  assert.ok(full.kind === "desk" && full.why === "gym", "the gym full: learning at its desk");
});

test("the bottom rooms (owner, 10-08): a lesson between friends in the classroom, the teacher at the lectern; Pace takes a free orb to the gym, Curiosity to the library", () => {
  const lesson = { a: "Ada", b: "Bo", kind: "lesson" as const, place: "desk" as const, winner: null, until: 60_000 };
  const [teacher, learner] = [meetPlan(lesson, "Ada"), meetPlan(lesson, "Bo")];
  assert.deepEqual([teacher.place, learner.place], ["classroom", "classroom"], "wherever the home said, a lesson is taught in the classroom");
  assert.deepEqual([teacher.label, learner.label], ["Teaching Bo", "Learning from Ada"]);
  assert.notDeepEqual(meetSpot("classroom", 0).at, meetSpot("classroom", 1).at, "the two in their own places");
  assert.equal(meetPlan({ ...lesson, kind: "coffee", place: "coffee" }, "Ada").place, "coffee", "control: a coffee stays where it was said");
  const none = { pois: new Set<PoiId>(), seats: new Set<number>(), waitingAt: null };
  const where = (traits: Traits, seed: string, f: (p: Plan) => boolean): number => {
    const rr = dice(seed);
    let n = 0;
    for (let i = 0; i < 4000; i++) if (f(next({ name: "A", mood: "idle", meeting: false, traits }, none, ["B"], rr))) n++;
    return n;
  };
  const gym = (p: Plan): boolean => p.kind === "poi" && GYM.includes(p.poi) && p.by === undefined;
  const library = (p: Plan): boolean => p.kind === "poi" && ["books", "read1", "read2", "armchair"].includes(p.poi);
  const [quick, slow] = [where({ ...even, Pace: 18 }, "gym", gym), where({ ...even, Pace: 2 }, "gym", gym)];
  assert.ok(quick > slow * 1.5 && slow > 0, `Pace works out more (${quick} vs ${slow} of 4000), and anyone may`);
  const [curious, not] = [where({ ...even, Curiosity: 18 }, "lib", library), where({ ...even, Curiosity: 2 }, "lib", library)];
  assert.ok(curious > not * 1.5 && not > 0, `Curiosity reads more (${curious} vs ${not} of 4000)`);
  const free = new Set<string>();
  const rr = dice("free gym");
  for (let i = 0; i < 2000; i++) {
    const p = next({ name: "A", mood: "idle", meeting: false, traits: even }, none, [], rr);
    if (p.kind === "poi" && GYM.includes(p.poi)) free.add(p.label);
  }
  assert.ok(free.size > 0 && ![...free].includes("At the gym, learning habits"), `a free workout never says it is learning (${[...free].join(", ")})`);
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

test("a moment (owner, 10-07: \"micro interactions ... goofy and funny\"): each kind at its spot, the two tags naming each other, a line each, the second a beat after the first", () => {
  const kinds: MomentKind[] = ["bump", "highfive", "cookie", "joke", "mug", "sticky", "trip", "dance"];
  for (const [i, kind] of kinds.entries()) {
    const m = { a: "Ada", b: "Bo", kind, lines: ["first line", "second line"] as [string, string], gestures: ["hop", "nod"] as [string, string], at: 1_000 * i, until: 30_000 };
    const [pa, pb] = [momentPlan(m, "Ada"), momentPlan(m, "Bo")];
    assert.equal(pa.place, pb.place, `${kind}: one place for the two`);
    assert.deepEqual([pa.side, pb.side, pa.with, pb.with], [0, 1, "Bo", "Ada"]);
    assert.deepEqual([pa.say, pb.say], [{ line: "first line", gesture: "hop", after: 0 }, { line: "second line", gesture: "nod", after: 1600 }], `${kind}: a line each, the reply a beat later`);
    assert.ok(pa.mark && pa.label && pb.label && pa.label !== "" && (pa.label.includes("Bo") || kind === "trip" || kind === "mug" || kind === "sticky"), `${kind}: ${pa.label} / ${pb.label}`);
    if (["bump", "highfive", "trip"].includes(kind)) assert.match(pa.place, /^plant[123]$/, `${kind}: in an aisle`);
    if (["joke", "sticky"].includes(kind)) assert.equal(pa.place, "desk", `${kind}: at the first one's desk`);
  }
});

test("a calmer office (owner, 10-07: \"slow down the amount of things they do ... they go eat a lot\"): 20 to 60 s a stay; food and drink a small share and never twice running; back to its desk more after an outing", () => {
  const r = dice("pace");
  for (let i = 0; i < 300; i++) {
    const d = dwell(even, r);
    assert.ok(d >= 20_000 && d <= 60_000, `a stay of ${d} ms`);
  }
  assert.ok(dwell({ ...even, Calm: 20 }, () => 0.5) > dwell({ ...even, Calm: 4 }, () => 0.5), "longer the calmer");
  const none = { pois: new Set<PoiId>(), seats: new Set<number>(), waitingAt: null };
  const desk: Plan = { kind: "desk", why: "tidy", label: "At the desk", mark: "🗂" };
  const draw = (prev: Plan | null, n = 4000): Plan[] => {
    const rr = dice(`draw:${prev?.kind ?? "none"}:${prev?.kind === "poi" ? prev.poi : ""}`);
    return Array.from({ length: n }, () => next({ name: "A", mood: "idle", meeting: false, traits: even }, none, ["B"], rr, prev));
  };
  const share = (ps: Plan[], f: (p: Plan) => boolean): number => ps.filter(f).length / ps.length;
  const food = (p: Plan): boolean => p.kind === "poi" && FOOD.has(p.poi);
  const fromDesk = draw(desk);
  assert.ok(share(fromDesk, food) <= 0.25, `food and drink a small share (${share(fromDesk, food).toFixed(2)})`);
  assert.ok(share(fromDesk, food) >= 0.05, "control: a coffee still happens");
  assert.equal(share(draw({ kind: "poi", poi: "coffee", label: "Getting a coffee", mark: "☕" }), food), 0, "never two in a row");
  const fromBooks = draw({ kind: "poi", poi: "books", label: "Reading", mark: "📖" });
  const atDesk = (p: Plan): boolean => p.kind === "desk";
  assert.ok(share(fromBooks, atDesk) > share(fromDesk, atDesk) * 1.5, `back to its desk after an outing (${share(fromBooks, atDesk).toFixed(2)} vs ${share(fromDesk, atDesk).toFixed(2)})`);
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
