// PLAN 5.18_t, the board's daily report (owner, 10-07: "The board also sends you a status report every day about ideas
// they think are great for the startup to make money, news around the world, news around the office, if we feel like
// someones not a fit or if theyre doing good. best new candidates to hire for the day ... we need to know where the idea
// comes from too as well(which orb in the office, so they get xp if we approve it)"):
//   - from 08:00, once a day (never before, never twice), sent by the Chair; a notice says it came, today's only;
//   - ideas, each from a named orb on the cheapest brain, a few orbs a day in turn (the board first, then whoever was
//     asked longest ago); one you approve gives its orb XP, once, and every orb hears it; one you pass gives nothing;
//   - the world from the reading library, with the orb who follows it; the office by code; who is doing well and who
//     may not be a fit, from each orb's week; today's applicants; the money, the CFO's, with the bills coming up;
//   - the door: the reports, one made now, a verdict (twice is refused).
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { serve } from "../src/api.ts";
import { officeNews, peopleNotes, pitchers, readIdea, type ReportOrb } from "../src/report.ts";
import { XP } from "../src/gym/xp.ts";
import { agentHome } from "./helpers.ts";

const orb = (id: string, specialty: string, createdAt = 0): ReportOrb => ({ id, name: id[0]!.toUpperCase() + id.slice(1), specialty, createdAt });

test("an idea read as a pitch; who pitches, in turn; the office's news and its people, by code", () => {
  assert.equal(readIdea('Idea: "Sell a weekly digest of what the office learns to small shops."'), "Sell a weekly digest of what the office learns to small shops.");
  assert.equal(readIdea("ok"), null, "nothing to pitch");
  assert.equal(readIdea(null), null);
  assert.ok(readIdea("a ".repeat(400))!.length <= 400);

  const office = [orb("max", "ceo", 1), orb("pip", "assistant", 2), orb("ada", "frontend", 3), orb("bo", "design", 4)];
  const never = pitchers(office, ["max", "pip"], () => 0);
  assert.deepEqual(never.map((o) => o.id), ["max", "pip", "ada"], "never asked: the board first, then who joined first");
  const asked: Record<string, number> = { max: 10, pip: 10, ada: 10 };
  assert.deepEqual(pitchers(office, ["max", "pip"], (id) => asked[id] ?? 0).map((o) => o.id), ["bo", "max", "pip"], "then whoever was asked longest ago");

  const ev = (type: string, data: Record<string, unknown>, o?: string) => ({ seq: 0, at: 0, type, data, orb: o ?? null, conversation: null }) as never;
  const news = officeNews([ev("orb.added", { level: "Senior" }, "ada"), ev("run.finished", { outcome: "ok" }, "ada"), ev("run.finished", { outcome: "ok" }, "ada"), ev("run.finished", { outcome: "error" }, "bo"),
    ev("board.decided", { carried: true, yes: 2, no: 1 }), ev("social.friends", { names: ["Ada", "Bo"] }), ev("orb.let_go", { name: "Cy" }, "cy")], (id) => id[0]!.toUpperCase() + id.slice(1));
  assert.deepEqual(news.map((n) => n.text), ["Ada joined as a Senior", "The board carried a proposal, 2–1", "Ada and Bo became good friends", "Cy was let go", "Ada finished 2 jobs"], "a failed run is no job done");

  const weeks: Record<string, { xp: number; suggest: string }> = { max: { xp: 40, suggest: "keep" }, pip: { xp: 0, suggest: "promote" }, ada: { xp: 5, suggest: "retrain" }, bo: { xp: 0, suggest: "let go" } };
  const p = peopleNotes(office, (o) => ({ ...weeks[o.id]!, approved: 0, judged: 0, why: `${weeks[o.id]!.xp} XP this week` }));
  assert.deepEqual(p.well.map((x) => x.name), ["Max", "Pip"]);
  assert.match(p.well[1]!.why, /^ready for a promotion/);
  assert.deepEqual(p.fit.map((x) => [x.name, x.why.split(":")[0]]), [["Ada", "work sent back"], ["Bo", "no work lately"]]);
});

test("the home sends it from 08:00 once a day; each idea is an orb's, its XP yours to give; the world, the office, people, hiring and money in it", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 7, 7, 30).getTime());
  const { home, model } = await agentHome(t, [{ chunks: ["ok"] }], { clock, reports: { on: true } });
  home.inbox.letGo("juniper");
  home.about.setName("Robin");
  home.about.setCompany("Acme Orbs");
  for (const [id, name, sp] of [["max", "Max", "ceo"], ["pip", "Pip", "assistant"], ["fin", "Fin", "cfo"], ["ada", "Ada", "frontend"]] as const) home.inbox.addOrb(id, name, sp);
  await home.tick(); // the board is elected
  // the day so far: Ada's work, a friendship, her reading, a bill, what the brain cost
  for (let i = 0; i < 2; i++) home.events.append("run.finished", { outcome: "ok", run: 100 + i }, { orb: "ada" });
  for (let i = 0; i < 3; i++) home.events.append("trace.feedback", { run: 200 + i, verdict: "wrong" }, { orb: "ada" });
  home.events.append("social.friends", { a: "ada", b: "pip", names: ["Ada", "Pip"] });
  home.events.append("reading.read", { source: 1, host: "news.example", changedPages: [{ title: "Rates held at 4%", url: "https://news.example/rates" }] }, { orb: "ada" });
  home.notices.remind({ orb: "fin", kind: "bill", title: "Hosting", due: "2026-10-09", amount: "$12" });
  home.events.append("brain.spend", { tier: "big", cost_usd: 0.25 });

  await home.tick();
  assert.equal(home.events.ofType("report.made").length, 0, "not before 08:00");
  assert.equal(home.reports.nextAt(), new Date(2026, 9, 7, 8, 0).getTime());

  clock.suspend(30 * 60_000);
  model.replies.push("Sell the office's habits as a service to small shops. They already work, so each sale is nearly all profit.", "Offer founders a weekly brief. It costs us an hour.", "Charge a monthly fee for bookkeeping. Steady money.");
  await home.tick();
  for (let i = 0; i < 100 && !home.events.ofType("report.made").length; i++) await new Promise((r) => setTimeout(r, 20));
  const r = home.reports.latest()!;
  assert.ok(r, "sent at 08:00");
  assert.deepEqual(r.chair, { orb: "max", name: "Max" }, "by the Chair");
  assert.deepEqual(r.ideas.map((x) => [x.orb, x.name]), [["max", "Max"], ["pip", "Pip"], ["fin", "Fin"]], "each idea an orb's: the board first");
  assert.match(r.ideas[0]!.text, /^Sell the office's habits/);
  assert.match(String(model.said.at(-3)![0]!.content), /You work at Acme Orbs[\s\S]*as its ceo[\s\S]*one idea each to make the company money/);
  assert.equal(home.events.ofType("brain.spend").filter((e) => e.data.turn === "report").length, 3, "each on the cheapest brain, its cost the report's");
  assert.deepEqual(r.world, [{ title: "Rates held at 4%", url: "https://news.example/rates", host: "news.example", orb: "ada", name: "Ada" }], "the world, with who follows it");
  const office = r.office.map((x) => x.text);
  assert.ok(office.includes("Ada finished 2 jobs") && office.includes("Ada and Pip became good friends"), office.join(" | "));
  assert.deepEqual(r.people.fit.map((x) => x.name), ["Ada"], "three runs you judged wrong: may not be a fit");
  assert.deepEqual([r.money.treasurer, r.money.bills.map((b) => b.title)], ["Fin", ["Hosting"]], "the CFO's books: the bill coming up");
  assert.ok(Math.abs(r.money.weekUsd - 0.25) < 1e-9);
  assert.deepEqual(r.hiring.positions, []);
  const notices = home.notices.list().filter((n) => n.kind === "report");
  assert.deepEqual(notices.map((n) => n.title), ["The board's report for Wednesday 7 October"]);
  assert.match(notices[0]!.detail, /3 ideas to make money · 1 from the world · \d+ from the office/);

  // never twice a day
  await home.tick();
  assert.equal(home.events.ofType("report.made").length, 1);

  // your verdicts: Max's approved (his XP), Pip's passed (nothing); once each
  const before = home.xp.of("max", clock.now()).total;
  home.reports.judge(r.ideas[0]!.id, "approved");
  assert.equal(home.xp.of("max", clock.now()).total - before, XP.ideaApproved, "an approved idea's XP, to the orb whose idea it was");
  const pip = home.xp.of("pip", clock.now()).total;
  home.reports.judge(r.ideas[1]!.id, "passed");
  assert.equal(home.xp.of("pip", clock.now()).total, pip, "a passed idea gives nothing");
  assert.throws(() => home.reports.judge(r.ideas[0]!.id, "approved"), /already approved/);
  assert.deepEqual(home.reports.latest()!.ideas.map((x) => x.verdict), ["approved", "passed", null]);
  // every orb hears what you approved
  home.inbox.send("ada", "chat:ada", "hi");
  await home.inbox.idle();
  assert.match(String(model.agent[0]![0]!.content), /Robin approved these ideas from the board's report: Max's "Sell the office's habits/);

  // the next day: whoever was asked longest ago pitches first; yesterday's notice put away by today's
  clock.suspend(24 * 3_600_000);
  model.replies.push("Run a paid workshop on our tools. People pay to learn.", "Bundle our reports for agencies. Recurring revenue.", "nope");
  await home.tick();
  for (let i = 0; i < 100 && home.events.ofType("report.made").length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  const next = home.reports.latest()!;
  assert.equal(next.ideas[0]!.orb, "ada", "never asked yet: Ada first");
  assert.equal(next.ideas.length, 2, "an answer that is no idea is left out");
  assert.deepEqual(next.people.well.map((x) => x.name), ["Max"], "doing well: Max, with his idea's XP");
  assert.deepEqual(home.notices.list().filter((n) => n.kind === "report").map((n) => n.title), ["The board's report for Thursday 8 October"]);
});

test("the door: the reports, one made now, a verdict once", async (t) => {
  const { home, model } = await agentHome(t, []);
  home.inbox.letGo("juniper");
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.equal((await call("POST", "/reports")).status, 409, "no one to report yet");
  home.inbox.addOrb("max", "Max", "ceo");
  model.replies.push("Sell templates of our best plans. Each costs nothing to copy.");
  assert.equal((await call("POST", "/reports")).status, 200);
  for (let i = 0; i < 100 && !home.events.ofType("report.made").length; i++) await new Promise((r) => setTimeout(r, 20));
  const { reports } = (await call("GET", "/reports")).json as { reports: { ideas: { id: string; name: string }[] }[] };
  assert.equal(reports[0]!.ideas[0]!.name, "Max");
  const id = reports[0]!.ideas[0]!.id;
  assert.equal((await call("POST", `/reports/ideas/${id}/approve`)).status, 200);
  assert.equal((await call("POST", `/reports/ideas/${id}/pass`)).status, 409, "a verdict once");
  assert.equal((await call("POST", "/reports/ideas/99.0/approve")).status, 409, "no such idea");
});
