// PLAN 3.7_t, the specialty map, on fixture traces:
//   - An orb that only does .tsx/CSS work comes out frontend-heavy; tags come from the files it
//     touched and the tools it used, by code.
//   - Thirty approved Stripe invoices show "invoices" as a niche, for that orb and not another.
//   - The radar matches the ledger exactly (XP per area is the XP its runs earned, a correction
//     included); its pass rate is approved over judged.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { nichesOf, radarOf, tagRun } from "../src/gym/specialty.ts";
import { ledger, Xp, XP } from "../src/gym/xp.ts";
import { tempDir } from "./helpers.ts";

function office(t: Parameters<typeof tempDir>[0]) {
  const clock = new FakeClock("2026-10-02T09:00:00");
  const db = openDb(tempDir(t));
  t.after(() => db.close());
  const events = new EventLog(db, clock);
  const xp = new Xp(events, { planOrb: () => null });
  t.after(() => xp.close());
  let n = 0;
  const run = (orb: string, calls: { name: string; args: Record<string, unknown> }[], verdict: "approve" | "correct" | null = "approve"): number => {
    const id = ++n;
    const where = { orb, conversation: `chat:${orb}` };
    events.append("run.started", { run: id, items: [id] }, where);
    events.append("trace.step", { run: id, step: 1, kind: "model", text: "", tool_calls: calls.map((c, i) => ({ id: `c${i}`, name: c.name, arguments: JSON.stringify(c.args) })) }, where);
    calls.forEach((c, i) => events.append("trace.step", { run: id, step: 2 + i, kind: "tool", call_id: `c${i}`, name: c.name, result: "ok" }, where));
    events.append("run.finished", { run: id, outcome: "ok" }, where);
    if (verdict) events.append("trace.feedback", { run: id, verdict, note: "" });
    clock.suspend(24 * 3_600_000); // a day each: the daily cap stays out of it
    return id;
  };
  return { events, run };
}

const ui = (i: number) => [{ name: "write_file", args: { path: `src/components/Card${i}.tsx`, content: "x" } }, { name: "write_file", args: { path: `src/styles/card${i}.css`, content: "x" } }];
const bill = (i: number) => [{ name: "web_fetch", args: { url: `https://api.stripe.com/v1/invoices?customer=c${i}` } }, { name: "write_file", args: { path: `books/invoices/acme-${i}.csv`, content: "x" } }];

test("an orb that only does .tsx and CSS work comes out frontend-heavy", (t) => {
  const o = office(t);
  for (let i = 0; i < 10; i++) o.run("pia", ui(i));
  const radar = radarOf(o.events, "pia");
  assert.equal(radar.frontend.runs, 10);
  assert.equal(radar.frontend.passRate, 1);
  assert.ok(radar.frontend.xp > 0);
  for (const [area, r] of Object.entries(radar)) if (area !== "frontend") assert.deepEqual(r, { xp: 0, passRate: null, runs: 0 }, area);
  assert.equal(tagRun(o.events, o.run("pia", [{ name: "shell", args: { command: "echo hi" } }])).area, null, "no sign of an area: untagged");
  assert.equal(tagRun(o.events, o.run("gus", [{ name: "shell", args: { command: "docker compose up -d" } }])).area, "devops");
});

test("thirty approved Stripe invoices show 'invoices' as a niche, for that orb and not another", (t) => {
  const o = office(t);
  for (let i = 0; i < 30; i++) o.run("ada", bill(i));
  for (let i = 0; i < 10; i++) o.run("pia", ui(i));
  o.run("pia", bill(99)); // one invoice is not a tendency
  const ada = nichesOf(o.events, "ada").map((n) => n.word);
  assert.ok(ada.includes("invoices") && ada.includes("stripe"), `ada's niches: ${ada.join(", ")}`);
  assert.ok(!nichesOf(o.events, "pia").some((n) => n.word === "invoices"), "not pia's");
  assert.equal(radarOf(o.events, "ada").finance.runs, 30, "and her work is finance");
});

test("the radar matches the ledger exactly, a correction included; the pass rate is approved over judged", (t) => {
  const o = office(t);
  o.run("pia", ui(1));
  o.run("pia", ui(2));
  const wrong = o.run("pia", ui(3));
  o.events.append("trace.feedback", { run: wrong, verdict: "correct", note: "the wrong colour" });
  o.run("pia", ui(4), null); // never judged: not in the pass rate
  o.run("pia", bill(1));
  const radar = radarOf(o.events, "pia");
  const onRuns = ledger(o.events).filter((x) => x.orb === "pia").reduce((s, x) => s + x.amount, 0);
  assert.equal(Object.values(radar).reduce((s, r) => s + r.xp, 0), onRuns, "every XP on the ledger, in one area each");
  assert.equal(radar.frontend.xp, 2 * XP.job.standard, "the corrected job's XP was taken back, from the same area (two files each: standard)");
  assert.equal(radar.frontend.passRate, 2 / 3);
  assert.equal(radar.frontend.runs, 4);
  assert.equal(radar.finance.xp, XP.job.easy, "an invoice fetched and one file: an easy finance job");
});
