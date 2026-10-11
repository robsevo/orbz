// PLAN 3.x through the door: an orb's XP with its radar and niches, the night's candidates, and the
// morning card (none on a quiet night), all read off the same event log the home keeps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { XP } from "../src/gym/xp.ts";
import { agentHome } from "./helpers.ts";

test("through the door: an orb's XP and where it lies, the night's candidates, the morning card", async (t) => {
  const h = await agentHome(t, []);
  h.home.inbox.addOrb("pia", "Pia", "frontend");
  const e = h.home.events;
  const run = (id: number) => {
    const where = { orb: "pia", conversation: "schedule:s1" };
    e.append("run.started", { run: id, items: [id] }, where);
    e.append("trace.step", { run: id, step: 0, kind: "input", items: [{ id, source: "schedule", text: "", data: { schedule: "s1" } }] }, where);
    e.append("trace.step", { run: id, step: 1, kind: "model", text: "", tool_calls: [{ id: "c", name: "write_file", arguments: JSON.stringify({ path: "src/Card.tsx" }) }] }, where);
    e.append("trace.step", { run: id, step: 2, kind: "tool", call_id: "c", name: "write_file", result: "ok" }, where);
    e.append("run.finished", { run: id, outcome: "ok" }, where);
    h.home.feedback(id, "approve");
  };
  for (const id of [901, 902, 903]) run(id);
  const door = await serve(h.home, { port: 0 });
  t.after(() => door.close());
  const get = async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { headers: { authorization: `Bearer ${door.token}` } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const pia = (await get("/orbs/pia/xp")).json as { xp: { total: number }; radar: Record<string, { xp: number; runs: number }> };
  assert.equal(pia.xp.total, 3 * XP.job.easy);
  assert.deepEqual([pia.radar.frontend!.xp, pia.radar.frontend!.runs], [3 * XP.job.easy, 3]);
  const c = (await get("/gym/candidates")).json.candidates as { orb: string; trigger: string; runs: number[] }[];
  assert.deepEqual(c.map((x) => [x.orb, x.trigger, x.runs]), [["pia", "schedule:s1", [901, 902, 903]]]);
  assert.equal((await get("/card")).json.card, null, "all of it today: yesterday was quiet");
  assert.equal((await get("/orbs/nobody/xp")).status, 404);
});
