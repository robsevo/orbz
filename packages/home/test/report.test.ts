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
// PLAN 5.20_t (owner, 10-08: "we have to keep in mind that the user may not have any money to start with. so ask how much
// they are willing to spend on infrastructure etc."; "Lets be able to change the budget as well"):
//   - a pitch read by code: its four lines, what it costs (free, a month, to start, a year, per sale, a range), whether
//     it fits what the company can spend (control: exactly that fits; never said is nothing);
//   - the prompt carries what the company can spend, who is in the office, the ideas approved and passed;
//   - one that does not say what it costs, or costs more, is asked again once, then left out and counted (control:
//     one exactly at the budget stays); the budget kept by the home and changed through the door.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { serve } from "../src/api.ts";
import { costsOf, officeNews, overBy, peopleNotes, pitchers, pitchPrompt, readIdea, readPitch, type ReportOrb } from "../src/report.ts";
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

test("a pitch read by code: its four lines, what it costs, whether it fits what the company can spend; the prompt", () => {
  assert.deepEqual(readPitch("**Idea:** Sell a weekly digest of what the office learns to small shops.\nWho pays: small shops, about $20 a month each\nCosts: $0 to start, $0 a month\nFirst step: write the first digest this week"), {
    text: "Sell a weekly digest of what the office learns to small shops.", who: "small shops, about $20 a month each", costs: { start: 0, month: 0 }, first: "write the first digest this week",
  });
  assert.equal(readPitch("Idea:\nRun a paid workshop\non our tools.\nCosts: free")!.text, "Run a paid workshop on our tools.", "a line's words run on to the next label");
  assert.deepEqual(readPitch("Sell templates of our best plans. Each costs nothing to copy.")!.costs, { start: null, month: null }, "not in the four lines: the whole answer is the idea, its costs unknown");
  assert.equal(readPitch("Idea: ok\nCosts: $0"), null, "no idea in it");

  assert.deepEqual(costsOf("$0 to start, $0 a month"), { start: 0, month: 0 });
  assert.deepEqual(costsOf("free"), { start: 0, month: 0 });
  assert.deepEqual(costsOf("nothing to start, $15/mo for hosting"), { start: 0, month: 15 });
  assert.deepEqual(costsOf("$200 to start"), { start: 200, month: 0 }, "said for one, the other is nothing");
  assert.deepEqual(costsOf("$1,000 up front and $1.5k monthly"), { start: 1000, month: 1500 });
  assert.deepEqual(costsOf("$10-$20 a month"), { start: 0, month: 20 }, "a range: its top");
  assert.deepEqual(costsOf("$12 a year for the domain"), { start: 12, month: 0 }, "a year's is paid at the start");
  assert.deepEqual(costsOf("the card processor's $2 per sale, and $0 a month"), { start: 0, month: 0 }, "per sale comes out of what it earns");
  assert.deepEqual(costsOf("$0 to start, $0 a month; later $20 a month once it earns"), { start: 0, month: 0 }, "what it costs before it earns: the first said");
  assert.deepEqual(costsOf("a little"), { start: null, month: null });

  const at = (start: number | null, month: number | null) => ({ text: "Sell a weekly digest.", who: null, first: null, costs: { start, month } });
  assert.equal(overBy(at(50, 20), { start: 50, month: 20 }), null, "exactly what it can spend fits (control)");
  assert.match(overBy(at(51, 20), { start: 50, month: 20 })!, /^costs \$51 to start and \$20 a month, more than the company can spend$/);
  assert.match(overBy(at(0, 21), { start: 50, month: 20 })!, /\$21 a month/);
  assert.equal(overBy(at(0, 0), null), null, "never said: free fits");
  assert.match(overBy(at(1, 0), null)!, /more than the company can spend/, "never said is nothing");
  assert.equal(overBy(at(null, 0), { start: 50, month: 20 }), "does not say what it costs");

  const office = [orb("max", "ceo", 1), orb("ada", "frontend", 2)];
  const ask = (budget: { start: number; month: number } | null) => pitchPrompt({ company: "Acme Orbs", founder: "Robin", me: office[1]!, office, budget, approved: ["Sell templates"], passed: ["Run paid ads"] });
  assert.match(ask(null), /your part in it: frontend\./);
  assert.match(ask(null), /Robin has not said yet what Acme Orbs can spend, so take it as nothing\. The idea has to start free: free tools and free tiers only/);
  assert.match(ask({ start: 0, month: 0 }), /Acme Orbs has no money to spend yet\. The idea has to start free/);
  assert.match(ask({ start: 50, month: 20 }), /Acme Orbs can spend up to \$50 to start and \$20 a month in all, on hosting, tools and ads\. The idea has to fit inside that/);
  assert.match(ask(null), /The office: Max \(CEO\), Ada \(frontend\)\. Pitch work these orbs can do\./);
  assert.match(ask(null), /Robin approved these already, and the office works toward them: "Sell templates"\./);
  assert.match(ask(null), /Robin passed these, so never pitch them again: "Run paid ads"\./);
  assert.match(ask(null), /^Idea: .*\n^Who pays: .*\n^Costs: .*\n^First step: .*$/m, "the four lines");
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
  model.replies.push(
    "Idea: Sell the office's habits as a service to small shops. They already work, so each sale is nearly all profit.\nWho pays: Small shops, about $30 a month each.\nCosts: $0 to start, $0 a month.\nFirst step: List the three habits that work best.",
    "Idea: Offer founders a weekly brief. It costs us an hour.\nWho pays: Founders, $10 a month.\nCosts: nothing.\nFirst step: Write the first brief.",
    "Charge a monthly fee for bookkeeping. Steady money.", // not in the four lines: what it costs unsaid, so asked again
    "Idea: Charge a monthly fee to keep small firms' books.\nWho pays: Small firms, $50 a month.\nCosts: $0 to start, $0 a month.\nFirst step: Draft the offer.",
  );
  await home.tick();
  for (let i = 0; i < 100 && !home.events.ofType("report.made").length; i++) await new Promise((r) => setTimeout(r, 20));
  const r = home.reports.latest()!;
  assert.ok(r, "sent at 08:00");
  assert.deepEqual(r.chair, { orb: "max", name: "Max" }, "by the Chair");
  assert.deepEqual(r.ideas.map((x) => [x.orb, x.name]), [["max", "Max"], ["pip", "Pip"], ["fin", "Fin"]], "each idea an orb's: the board first");
  assert.match(r.ideas[0]!.text, /^Sell the office's habits/);
  assert.deepEqual([r.ideas[0]!.who, r.ideas[0]!.start, r.ideas[0]!.month, r.ideas[0]!.first], ["Small shops, about $30 a month each.", 0, 0, "List the three habits that work best."], "who pays, what it costs, the first step");
  const prompts = model.said.slice(-4).map((m) => String(m[0]!.content));
  assert.match(prompts[0]!, /You work at Acme Orbs[\s\S]*your part in it: CEO[\s\S]*one idea each to make the company money/);
  assert.match(prompts[0]!, /Robin has not said yet what Acme Orbs can spend, so take it as nothing\. The idea has to start free/, "never said: nothing");
  // everyone in the office by their part (in the home's order: orbs added in one millisecond fall back to their ids)
  const line = /^The office: (.*)\. Pitch work these orbs can do\.$/m.exec(prompts[0]!)?.[1] ?? "";
  assert.deepEqual(line.split(", ").sort(), ["Ada (frontend)", "Fin (CFO)", "Max (CEO)", "Pip (personal assistant)"]);
  assert.match(prompts[3]!, /Your idea, "Charge a monthly fee for bookkeeping\. Steady money\.", does not say what it costs\. Answer again in the same four lines/, "asked again, once");
  assert.equal(r.ideas[2]!.text, "Charge a monthly fee to keep small firms' books.", "and the answer that fits kept");
  assert.equal(r.left, 0);
  assert.equal(home.events.ofType("brain.spend").filter((e) => e.data.turn === "report").length, 4, "each on the cheapest brain, its cost the report's, the one asked again too");
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
  home.about.setBudget({ start: 50, month: 20 });
  model.replies.push(
    "Idea: Run a paid workshop on our tools.\nWho pays: Small teams, $40 a seat.\nCosts: $50 to start, $20 a month.\nFirst step: Write the outline.", // exactly what it can spend: kept
    "Idea: Bundle our reports for agencies.\nWho pays: Agencies, $200 a month.\nCosts: $500 to start, $20 a month.\nFirst step: Call three agencies.", // more: asked again
    "Idea: Bundle our reports for agencies, with ads.\nWho pays: Agencies.\nCosts: $0 to start, $300 a month.\nFirst step: Buy ads.", // still more: left out
    "nope",
  );
  await home.tick();
  for (let i = 0; i < 100 && home.events.ofType("report.made").length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  const next = home.reports.latest()!;
  assert.equal(next.ideas[0]!.orb, "ada", "never asked yet: Ada first");
  assert.deepEqual(next.ideas.map((x) => [x.name, x.start, x.month]), [["Ada", 50, 20]], "exactly what it can spend is kept (control); more, asked again and still more, is left out; no idea, nothing");
  assert.equal(next.left, 1, "the one left out for its cost is counted; an answer that is no idea is not");
  const day2 = model.said.slice(-4).map((m) => String(m[0]!.content));
  assert.match(day2[0]!, /Acme Orbs can spend up to \$50 to start and \$20 a month in all/, "the budget as you changed it");
  assert.match(day2[0]!, /Robin approved these already[^\n]*"Sell the office's habits/, "what you approved");
  assert.match(day2[0]!, /Robin passed these, so never pitch them again: "Offer founders a weekly brief/, "what you passed");
  assert.match(day2[2]!, /costs \$500 to start and \$20 a month, more than the company can spend/);
  assert.deepEqual(next.people.well.map((x) => x.name), ["Max"], "doing well: Max, with his idea's XP");
  assert.deepEqual(home.notices.list().filter((n) => n.kind === "report").map((n) => n.title), ["The board's report for Thursday 8 October"]);
});

test("what the company can spend: kept by the home, changed any time through the door, refused when it is not one", async (t) => {
  const { home } = await agentHome(t, []);
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const put = async (b: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}/me`, { method: "PUT", body: JSON.stringify(b), headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" } });
    return { status: r.status, json: (await r.json()) as { me?: { budget: unknown } } };
  };
  home.about.setName("Robin");
  assert.equal(home.about.get().budget, null, "never said");
  assert.deepEqual((await put({ budget: { start: 0, month: 0 } })).json.me?.budget, { start: 0, month: 0 }, "nothing is an answer");
  assert.deepEqual((await put({ budget: { start: 49.6, month: 20 } })).json.me?.budget, { start: 50, month: 20 }, "whole dollars");
  assert.equal(home.about.get().name, "Robin", "a budget alone leaves your name as it was");
  for (const bad of [{ start: -1, month: 0 }, { start: "50", month: 0 }, { month: 20 }, { start: 0, month: 20_000_000 }]) assert.equal((await put({ budget: bad })).status, 400, JSON.stringify(bad));
  assert.deepEqual(home.about.get().budget, { start: 50, month: 20 }, "a refused one changes nothing");
  assert.ok(home.events.ofType("about.changed").some((e) => JSON.stringify(e.data.budget) === JSON.stringify({ start: 50, month: 20 })), "a change is an event");
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
  model.replies.push("Idea: Sell templates of our best plans. Each costs nothing to copy.\nCosts: $0");
  assert.equal((await call("POST", "/reports")).status, 200);
  for (let i = 0; i < 100 && !home.events.ofType("report.made").length; i++) await new Promise((r) => setTimeout(r, 20));
  const { reports } = (await call("GET", "/reports")).json as { reports: { ideas: { id: string; name: string }[] }[] };
  assert.equal(reports[0]!.ideas[0]!.name, "Max");
  const id = reports[0]!.ideas[0]!.id;
  assert.equal((await call("POST", `/reports/ideas/${id}/approve`)).status, 200);
  assert.equal((await call("POST", `/reports/ideas/${id}/pass`)).status, 409, "a verdict once");
  assert.equal((await call("POST", "/reports/ideas/99.0/approve")).status, 409, "no such idea");
});
