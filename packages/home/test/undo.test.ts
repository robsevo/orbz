// PLAN 3.5_t (the morning card's one-tap undo), through the door, on the real kit:
//   - Undo a habit: the version before it answers again, its code byte for byte as it was proved;
//     the one taken back is no longer offered; the XP its promotion gave is taken back, exactly,
//     and nothing more (an undo is not a rollback).
//   - Undo a lesson: the line is gone, its XP with it; a second tap on the same card is refused.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { casesOf } from "../src/gym/cases.ts";
import { compile } from "../src/gym/compile.ts";
import { findHotPaths } from "../src/gym/finder.ts";
import { promotedFor } from "../src/gym/steps.ts";
import { XP } from "../src/gym/xp.ts";
import { approved, GOOD, reply } from "./fixtures/bills.ts";
import { agentHome } from "./helpers.ts";

const TASK = "juniper|trigger:t1|{subject}";

test("one tap takes a habit back to the version before, byte for byte, and its XP exactly; a lesson too", { timeout: 120_000 }, async (t) => {
  const { home } = await agentHome(t, [], { kit: true });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, b?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, {
      method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(b !== undefined && { body: JSON.stringify(b) }),
    });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const kit = (tool: string, args: Record<string, unknown>) => home.kit!.call(tool, args);
  const night = async (code: string, version: number) => {
    const [c] = findHotPaths(home.events, { since: 0 });
    return compile({ candidate: c!, cases: casesOf(home.events, c!.runs), version, teacher: async () => reply(code), kit, dataDir: home.dataDir, events: home.events });
  };
  approved(home.events, "juniper");
  const v1 = await night(GOOD, 1);
  if (/no habit sandbox/.test(v1.why ?? "")) return t.diagnostic("no habit sandbox on this machine");
  assert.equal(v1.promoted, true);
  approved(home.events, "juniper", ["Phone"], 104);
  const before = home.xp.of("juniper", home.clock.now()).total;
  const v2 = await night(`# v2: the same, written again\n${GOOD}`, 2);
  assert.equal(v2.promoted, true);
  assert.equal(promotedFor(home.events, home.dataDir, "juniper", TASK)?.version, 2);
  assert.equal(home.xp.of("juniper", home.clock.now()).total, before + XP.habitPromoted);

  const card = (await call("POST", "/card/undo", { kind: "habit", orb: "juniper", habit: v2.key, version: 2 })).json.card as { orbs: { undo: { kind: string; version?: number }[] }[] } | null;
  const now = promotedFor(home.events, home.dataDir, "juniper", TASK)!;
  assert.equal(now.version, 1, "the version before answers again");
  assert.equal(readFileSync(join(now.dir, "habit.py"), "utf8"), GOOD, "byte for byte as it was proved");
  assert.match(readFileSync(join(v2.dir, "habit.py"), "utf8"), /^# v2/, "the one taken back is kept, not answering");
  assert.equal(home.xp.of("juniper", home.clock.now()).total, before, "exactly what its promotion gave, and nothing more");
  for (const n of card?.orbs ?? []) assert.ok(!n.undo.some((u) => u.kind === "habit" && u.version === 2), "no longer offered");
  await call("POST", "/card/undo", { kind: "habit", orb: "juniper", habit: v2.key, version: 2 });
  assert.equal(home.xp.of("juniper", home.clock.now()).total, before, "a second tap takes nothing more");

  home.learned.add("juniper", "Invoices go out on the 1st.");
  const withLesson = home.xp.of("juniper", home.clock.now()).total;
  const lesson = { kind: "lesson", orb: "juniper", line: "Invoices go out on the 1st.", index: 0 };
  assert.equal((await call("POST", "/card/undo", lesson)).status, 200);
  assert.deepEqual(home.learned.list("juniper"), []);
  assert.equal(home.xp.of("juniper", home.clock.now()).total, withLesson - XP.lessonKept);
  assert.equal((await call("POST", "/card/undo", lesson)).status, 409, "the same tap again: it is not there to take");
  assert.equal((await call("POST", "/card/undo", { kind: "nothing" })).status, 400);
});
