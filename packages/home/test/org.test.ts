// PLAN 5.4_t, 5.5_t (and 5.6's door), on a real home:
//   - rows go to the best fit on a fixture team (its kind of work, the XP earned there, the level);
//     each kind of work is led by its top-ranked orb, the first to join on a tie;
//   - mentoring: a Senior passes a habit to a junior of his own kind (your yes first); it answers
//     the junior's task, and its calls meet the JUNIOR's rules, not the Senior's;
//   - the night practises each orb's promotion gap first;
//   - the weekly performance card: once a week for each orb in the office, a suggestion with its
//     evidence; it never acts;
//   - let go with a hand-off: his habits answer under their new owner; rehired, he is as he was;
//   - the door: the org chart, a career page, letting go with a hand-off.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { TOOLS } from "../src/agent/tools.ts";
import type { CaseStep, StepFn } from "../src/gym/cases.ts";
import { habitDir } from "../src/gym/compile.ts";
import { Gym } from "../src/gym/night.ts";
import { habitsOf, shareHabit } from "../src/gym/share.ts";
import { promotedFor } from "../src/gym/steps.ts";
import { leadsOf, whoFits, type Member } from "../src/org.ts";
import { serve } from "../src/api.ts";
import type { Home } from "../src/home.ts";
import { agentHome } from "./helpers.ts";
import { fakeBrain } from "./fakes/openai.ts";

const DAY = 86_400_000;
const m = (id: string, specialty: Member["specialty"], level: Member["level"], createdAt: number): Member => ({ id, name: id[0]!.toUpperCase() + id.slice(1), specialty, level, createdAt });

test("rows go to the best fit: its kind of work first, then the XP earned there, then the level; each kind led by its top-ranked orb", async (t) => {
  const { home } = await agentHome(t, []);
  const team = [m("wren", "writing", "Senior", 1), m("ada", "frontend", "Junior", 2), m("bea", "frontend", "Senior", 3), m("cy", "data", "Mid", 4)];
  assert.deepEqual(whoFits(home.events, "the landing page's layout and CSS", team).map((r) => r.orb).slice(0, 2), ["bea", "ada"], "frontend work: the frontend orbs, the Senior first");
  assert.equal(whoFits(home.events, "the landing page's numbers, in sales.csv", team)[0]!.orb, "cy", "a file's kind counts first, before the words");
  assert.match(whoFits(home.events, "the landing page", team)[0]!.why, /frontend is his kind of work/);
  const leads = leadsOf([...team, m("dee", "frontend", "Senior", 0)]);
  assert.equal(leads.bySpecialty.get("frontend"), "dee", "two Seniors of a kind: the first to join leads");
  assert.equal(leads.chief, null);
  assert.equal(leadsOf([...team, m("max", "general", "Chief", 9)]).chief, "max");
});

/** Ada's habit for the bills trigger, as the night would leave it: promoted, its files in place. */
function adasHabit(home: Home): { task: string } {
  const key = "ada|trigger:t1|read_file {subject}";
  const task = "ada|trigger:t1|{subject}";
  const dir = habitDir(home.dataDir, { orb: "ada", key }, 1);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "habit.py"), "# the steps\n");
  home.events.append("habit.promoted", { kind: key, task, version: 1, runs: [1, 2, 3] }, { orb: "ada" });
  return { task };
}

test("mentoring: a Senior's habit passed to a junior of his kind answers the junior's task, under the junior's own rules", async (t) => {
  const asked: string[] = [];
  const step: StepFn = async (_input, done: CaseStep[]) => (done.length ? { output: "Kept it." } : { call: { name: "read_file", args: { path: "bills.csv" } } });
  let home!: Home;
  ({ home } = await agentHome(t, [{ chunks: ["the brain"] }, { chunks: ["the brain"] }], {
    agent: {
      // no stand-in for the rules: each orb's own decide his calls
      habits: { find: (orb: string, task: string) => promotedFor(home.events, home.dataDir, orb, task), step: async (h, input, done) => (asked.push(h.task), step(input, done)) },
    },
  }));
  home.inbox.addOrb("ada", "Ada", "frontend");
  home.inbox.addOrb("bea", "Bea", "frontend");
  const { task } = adasHabit(home);
  const tools = (name: string) => home.agent!.toolNamed(name)!;
  const share = tools("share_habit");
  const ctx = (orb: string) => ({ orb, conversation: `chat:${orb}`, workspace: home.agent!.workspace(orb), background: undefined as never });
  assert.equal(share.decision, "ask", "your yes first");
  assert.match(share.precheck!({ to: "Bea" }, ctx("ada")) ?? "", /Name the task\. Your habits: ada\|trigger:t1/);
  assert.match(share.precheck!({ to: "Ada", task }, ctx("bea")) ?? "", /a Senior's/, "a junior has no habits to pass on yet");
  assert.equal(share.precheck!({ to: "Bea", task }, ctx("ada")), null);
  await share.run!({ to: "Bea", task }, ctx("ada"));
  assert.deepEqual(habitsOf(home.events, home.dataDir, "bea").map((h) => h.task), ["bea|trigger:t1|{subject}"], "it is Bea's now, keyed to his task");
  assert.deepEqual(habitsOf(home.events, home.dataDir, "ada").map((h) => h.task), [task], "and Ada keeps hers");

  // Bea's own rule: reading a file asks. The habit answers his run, and its read waits for your OK
  const read = TOOLS.find((d) => d.name === "read_file")!;
  home.rules.add({ orb: "bea", text: "ask: read bills.csv", decision: "ask", action: read.describe({ path: "bills.csv" }), source: "owner" });
  for (const orb of ["ada", "bea"]) {
    const ws = home.agent!.workspace(orb);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "bills.csv"), "rent,1200\n");
    home.inbox.enqueue(orb, `trigger:${orb}`, "trigger", "[Trigger: bills] New email: Rent", { data: { trigger: "t1", subject: "Rent" }, fresh: true });
  }
  await home.inbox.idle();
  assert.deepEqual([...new Set(asked)].sort(), ["ada|trigger:t1|{subject}", "bea|trigger:t1|{subject}"], "the habit answered each one's run");
  assert.ok(home.conversations.openCard("trigger:bea"), "under Bea's rules: his read waits for your OK");
  assert.equal(home.conversations.openCard("trigger:ada"), undefined, "CONTROL: under Ada's, it does not");
});

test("let go with a hand-off: his habits answer under their new owner; rehired, he comes back as he was", async (t) => {
  const { home } = await agentHome(t, []);
  home.inbox.addOrb("ada", "Ada", "frontend", { hue: "amber" });
  home.inbox.addOrb("bea", "Bea", "frontend");
  const { task } = adasHabit(home);
  home.learned.add("ada", "Invoices go out on the 1st.");
  const before = { orb: home.inbox.orb("ada")!, learned: readFileSync(join(home.dataDir, "orbs", "ada", "learned.md"), "utf8") };
  home.inbox.rehire("ada");
  assert.equal(home.events.ofType("orb.rehired").length, 0, "rehiring someone in the office changes nothing: his days in the company go on");
  const r = home.letGo("ada", "bea");
  assert.deepEqual(r.handed, ["bea|trigger:t1|{subject}"]);
  assert.deepEqual(home.letGo("ada", "bea").handed, [], "let go twice: nothing handed twice");
  assert.ok(promotedFor(home.events, home.dataDir, "bea", "bea|trigger:t1|{subject}"), "the habit answers Bea's task now");
  assert.throws(() => home.letGo("bea", "ada"), /cannot take his habits/, "an orb let go takes nothing");
  home.inbox.rehire("ada");
  const back = home.inbox.orb("ada")!;
  assert.deepEqual({ ...back, status: before.orb.status }, before.orb, "rehired: the same orb, field by field");
  assert.equal(readFileSync(join(home.dataDir, "orbs", "ada", "learned.md"), "utf8"), before.learned, "what he learned, byte for byte");
  assert.ok(promotedFor(home.events, home.dataDir, "ada", task), "and his own habit still answers");
});

test("the night practises each orb's promotion gap first; once a week a performance card per orb in the office, that never acts", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 1, 9, 0).getTime());
  const { home } = await agentHome(t, [], { clock });
  home.inbox.addOrb("ada", "Ada", "data", {}, "Junior");
  home.inbox.addOrb("cy", "Cy", "writing");
  home.inbox.addOrb("dee", "Dee", "writing", {}, "Junior");
  home.inbox.letGo("dee");
  // Ada's work: a lot of writing, a little data; his next level wants a task learned in his specialty (data)
  const run = (orb: string, n: number, path: string, subject: string) => {
    const where = { orb, conversation: `trigger:${orb}` };
    home.events.append("run.started", { run: n, items: [n] }, where);
    home.events.append("trace.step", { run: n, step: 0, kind: "input", items: [{ id: n, source: "trigger", text: `[Trigger] ${subject}`, data: { trigger: path.endsWith(".csv") ? "t2" : "t1", subject } }] }, where);
    home.events.append("trace.step", { run: n, step: 1, kind: "model", text: "", tool_calls: [{ id: "a", name: "read_file", arguments: JSON.stringify({ path }) }] }, where);
    home.events.append("trace.step", { run: n, step: 2, kind: "tool", call_id: "a", name: "read_file", result: "ok" }, where);
    home.events.append("trace.step", { run: n, step: 3, kind: "model", text: `Done ${subject}.`, tool_calls: [] }, where);
    home.events.append("run.finished", { run: n, outcome: "ok" }, where);
    home.events.append("trace.feedback", { run: n, verdict: "approve" }, where);
  };
  for (let i = 0; i < 5; i++) run("ada", 100 + i, "notes.md", `essay ${i}`);
  for (let i = 0; i < 3; i++) run("ada", 200 + i, "numbers.csv", `sheet ${i}`);
  const teacher = await fakeBrain(t, [{ text: "no habit tonight" }, { text: "no habit tonight" }]);
  let checks = 0;
  const gym = new Gym({
    events: home.events, clock, dataDir: home.dataDir,
    kit: async () => ({ ok: false, why: "a stand-in kit" }),
    teacher: () => ({ name: "teacher", baseUrl: teacher.baseUrl, model: "t", retries: 0 }),
    // the cap: one candidate tonight, so the one tried first is the one tried
    spend: { check: () => { if (checks++ >= 1) throw new Error("over the cap"); }, record: () => {} } as never,
    everyone: () => home.inbox.orbs({ all: true }).map((o) => ({ id: o.id, specialty: o.specialty, hired: o.createdAt, away: o.letGoAt !== null })),
  });
  await gym.night();
  assert.equal(teacher.requests.length, 1, "one candidate tonight");
  const brief = JSON.stringify(teacher.requests[0]!.body);
  assert.match(brief, /numbers\.csv/, "his gap first: data work, though he did more writing");
  assert.doesNotMatch(brief, /notes\.md/);

  clock.suspend(8 * DAY);
  await gym.night();
  const cards = home.events.ofType("performance.card").map((e) => e.orb).sort();
  assert.deepEqual(cards, ["ada", "cy", "juniper"], "a card for each orb in the office (juniper is the helper's), none for one away");
  assert.equal(home.events.ofType("orb.promoted").length + home.events.ofType("orb.let_go").length, 1, "it never acts (the one let-go is yours)");
  const ada = home.events.ofType("performance.card").find((e) => e.orb === "ada")!.data as { suggest: string; why: string };
  assert.match(ada.why, /XP this week/);
  assert.ok(["promote", "keep", "retrain", "let go"].includes(ada.suggest));
  assert.ok(home.notices.list().some((n) => n.kind === "performance" && /Ada's week/.test(n.title)), "the card is a notice for you");
});

test("the door: the org chart, a career page, letting go with a hand-off", async (t) => {
  const { home } = await agentHome(t, []);
  home.inbox.addOrb("ada", "Ada", "frontend");
  home.inbox.addOrb("bea", "Bea", "frontend");
  adasHabit(home);
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}` } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const org = (await call("GET", "/org")).json as { leads: Record<string, string>; orbs: { id: string; level: string }[]; away: unknown[] };
  assert.equal(org.leads.frontend, "ada", "the first of his kind leads frontend");
  assert.deepEqual(org.orbs.find((o) => o.id === "bea")!.level, "Junior");
  const career = (await call("GET", "/orbs/ada/career")).json as { level: string; habits: { task: string }[]; born: number; reviews: { given: number } };
  assert.deepEqual([career.level, career.habits.map((h) => h.task), typeof career.born, career.reviews.given], ["Senior", ["ada|trigger:t1|{subject}"], "number", 0]);
  assert.equal((await call("DELETE", "/orbs/ada?handTo=nobody")).status, 409, "a hand-off to no one in the office is refused");
  const gone = (await call("DELETE", "/orbs/ada?handTo=bea")).json as { handed: string[] };
  assert.deepEqual(gone.handed, ["bea|trigger:t1|{subject}"]);
  assert.equal(((await call("GET", "/org")).json as { away: { id: string }[] }).away[0]!.id, "ada", "away, to rehire");
});
