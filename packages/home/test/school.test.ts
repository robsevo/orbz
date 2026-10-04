// PLAN 5.7_t, school, on a real home with a brain scripted by what it is asked:
//   - only an orb you let go goes to school; rehiring ends the term, the report card kept;
//   - maths, the fixture subject, graded by code: the starting exam, then a class a night; a note
//     is kept only when the exam sat with it scores higher; the mark twice in a row is a diploma;
//   - no exam question is ever in a lesson, a practice or a note's prompt, even when the teacher
//     writes one into a lesson;
//   - a diploma never promotes and earns no XP, and a graduate ranks above an equal orb for a row
//     in its subject (and not for another);
//   - no class runs past the spend cap; Talking with you waits for your thumbs; a teacher's verdict
//     that is missing is no evidence; your own subject's exam is the teacher's, kept from lessons;
//   - C++ compiled and run in the kit's sandbox; the door.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { serve } from "../src/api.ts";
import { levelOf } from "../src/gym/levels.ts";
import { whoFits, type Member } from "../src/org.ts";
import { seedOf } from "../src/school/school.ts";
import { examOf, mathsExam } from "../src/school/subjects.ts";
import { agentHome } from "./helpers.ts";

const DAY = 86_400_000;
type Msg = { role?: string; content?: unknown };
const text = (msgs: Record<string, unknown>[]): { system: string; user: string } => ({
  system: String((msgs as Msg[]).find((m) => m.role === "system")?.content ?? ""),
  user: String((msgs as Msg[]).findLast((m) => m.role === "user")?.content ?? ""),
});

/** A brain scripted by what it is asked: the syllabus, a lesson (with `leak` in it), practice, a
 * note ("Note 1", "Note 2", ...), and the maths exam, answered right `right(notebook)` times. */
function scripted(o: { right: (system: string) => number; exam: { ask: string; answer?: string }[]; leak?: () => string }) {
  let notes = 0;
  const asked: { system: string; user: string }[] = [];
  const answer = (msgs: Record<string, unknown>[]): string | undefined => {
    const m = text(msgs);
    asked.push(m);
    if (/Write a syllabus/.test(m.user)) return "1. Fractions\n2. Percentages\n3. Equations\n4. Rates\n5. Means";
    if (/Today's topic/.test(m.user)) return `Today: ${/Today's topic: (.+?)\./.exec(m.user)?.[1]}.\nWork slowly and check each step.\n${o.leak?.() ?? ""}`;
    if (/^Practice:/m.test(m.user)) return "ANSWER 1: 1\nANSWER 2: 2\nANSWER 3: 3";
    if (/Write ONE note/.test(m.user)) return `Note ${++notes}: check the sum twice.`;
    if (/sitting your Mathematics exam/.test(m.system)) {
      const right = o.right(m.system);
      return o.exam.map((q, i) => `ANSWER ${i + 1}: ${i < right ? q.answer : "999"}`).join("\n");
    }
    return undefined;
  };
  return { answer, asked };
}

test("only an orb you let go goes to school; maths, night by night: a note kept only when it raises the exam, a diploma at the mark twice; no exam in any lesson", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 3, 12, 0).getTime());
  const { home, model } = await agentHome(t, [], { clock });
  home.inbox.addOrb("ada", "Ada", "accountant");
  assert.throws(() => home.sendToSchool("ada", [{ kind: "maths" }], 0.8), /only an orb you let go goes to school/i);
  home.inbox.letGo("ada");
  assert.throws(() => home.sendToSchool("ada", [{ kind: "maths" }], 0.75), /pass mark/);
  assert.throws(() => home.sendToSchool("ada", [], 0.8), /pick 1 to/);

  const exam = mathsExam(seedOf("ada", 1, "maths", "Mathematics"));
  // the starting exam 4 of 10; with Note 1, 6; with Note 3, 9 (Note 2 and 4 add nothing)
  const brain = scripted({ exam, right: (s) => (s.includes("Note 3") ? 9 : s.includes("Note 1") ? 6 : 4), leak: () => exam[2]!.ask });
  model.answer = brain.answer;
  home.sendToSchool("ada", [{ kind: "maths" }], 0.8);
  await home.school.start("ada");
  let card = home.school.report("ada");
  assert.equal(card.atSchool, true);
  assert.deepEqual(card.subjects[0]!.syllabus, ["Fractions", "Percentages", "Equations", "Rates", "Means"]);
  assert.equal(card.subjects[0]!.started, 0.4, "the starting exam, sat with an empty notebook");

  for (let night = 1; night <= 4; night++) {
    clock.suspend(DAY);
    await home.school.night();
  }
  card = home.school.report("ada");
  const maths = card.subjects[0]!;
  assert.deepEqual(maths.notes.map((n) => n.text), ["Note 1: check the sum twice.", "Note 3: check the sum twice."], "a note is kept only when the exam sat with it scored higher");
  assert.deepEqual(maths.sittings.map((s) => [s.score, s.kept]), [[0.4, null], [0.6, true], [0.6, false], [0.9, true], [0.9, false]]);
  assert.equal(maths.now, 0.9);
  assert.ok(maths.graduatedAt, "the mark, twice in a row: a diploma");
  assert.deepEqual(home.school.diplomas("ada").map((d) => [d.name, d.score]), [["Mathematics", 0.9]]);
  assert.equal(maths.lessons, 4);

  // no exam question in anything but the exam: the teacher wrote one into each lesson, and it was cut
  const asks = exam.map((q) => q.ask);
  const notExam = brain.asked.filter((m) => !/sitting your Mathematics exam/.test(m.system));
  assert.ok(notExam.length >= 4 * 3, "lessons, practice and notes were asked");
  for (const m of notExam) for (const a of asks) assert.ok(!`${m.system}\n${m.user}`.includes(a), `an exam question reached a prompt: ${a}`);
  assert.ok(brain.asked.some((m) => /Today's lesson:/.test(m.user)), "the orb saw the lessons");

  // a diploma never promotes and earns no XP
  assert.equal(levelOf(home.events, "ada"), "Senior", "as hired: the first of its kind");
  assert.equal(home.xp.of("ada", clock.now()).total, 0);
  assert.equal(home.events.ofType("promotion.proposed").length, 0);

  // a graduated subject has no more classes
  const lessonsBefore = brain.asked.filter((m) => /Today's topic/.test(m.user)).length;
  clock.suspend(DAY);
  await home.school.night();
  assert.equal(brain.asked.filter((m) => /Today's topic/.test(m.user)).length, lessonsBefore);

  // rehiring ends the term; the report card, the notebook and the diploma stay, and the notebook goes to work
  home.rehire("ada");
  assert.equal(home.school.term("ada"), null);
  card = home.school.report("ada");
  assert.equal(card.atSchool, false);
  assert.equal(card.subjects[0]!.notes.length, 2);
  assert.equal(home.school.diplomas("ada").length, 1);
  home.inbox.send("ada", "chat:ada", "what did you learn?");
  await home.inbox.idle();
  const system = String((model.agent.at(-1)![0] as { content?: unknown }).content ?? "");
  assert.match(system, /What you learned at school \(your notebook\):\n- Mathematics: Note 3: check the sum twice/, "the notebook goes to work with it, newest first");
});

test("a graduate ranks above an equal orb for a row in its subject, and not for another", () => {
  const team: Member[] = [
    { id: "bo", name: "Bo", specialty: "accountant", level: "Senior", createdAt: 1 },
    { id: "ada", name: "Ada", specialty: "accountant", level: "Senior", createdAt: 2 },
  ];
  const diplomas = (orb: string) => (orb === "ada" ? [{ kind: "maths" as const, name: "Mathematics", at: 5, score: 0.9 }] : []);
  const none = { ofType: () => [] } as unknown as Parameters<typeof whoFits>[0];
  const maths = whoFits(none, "Work out the averages for the budget sheet", team, diplomas);
  assert.deepEqual(maths.map((r) => r.orb), ["ada", "bo"]);
  assert.match(maths[0]!.why, /a diploma in Mathematics/);
  assert.deepEqual(whoFits(none, "Pay the supplier invoices", team, diplomas).map((r) => r.orb), ["bo", "ada"], "not its subject: the first to join, as before");
});

test("no class runs past the spend cap; Talking with you waits for your thumbs; a missing verdict is no evidence", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 3, 12, 0).getTime());
  const { home, model } = await agentHome(t, [], { clock, spendCapUsd: 1 });
  home.inbox.addOrb("cy", "Cy", "support");
  home.inbox.letGo("cy");
  const situations = examOf("talking", seedOf("cy", 1, "talking", "Talking with you"))!;
  let verdictsGiven = "";
  model.answer = (msgs) => {
    const m = text(msgs);
    if (/Write a syllabus/.test(m.user)) return "1. Listening\n2. Honesty\n3. Short replies\n4. Asking";
    if (/final exam/.test(m.user)) return Array.from({ length: 5 }, (_, i) => `Q: What does a calm reply ${i + 1} need?\nP: kind words\nP: a next step`).join("\n\n");
    if (/For each answer, say whether/.test(m.user)) return verdictsGiven;
    if (/Today's topic/.test(m.user)) return "Today: listening.\nPRACTICE: Reply to a worried person.";
    if (/Write ONE note/.test(m.user)) return "Name the feeling first.";
    if (/In two or three sentences/.test(m.user)) return "Warm, but too long.";
    return "I hear you. Let's take it one step at a time.";
  };
  home.sendToSchool("cy", [{ kind: "talking" }, { kind: "custom", name: "Calm" }], 0.8);
  verdictsGiven = "1: yes\n2: no\n3: yes"; // two of five not rated: the sitting is void
  await home.school.start("cy");
  let card = home.school.report("cy");
  const talking = card.subjects.find((s) => s.kind === "talking")!;
  assert.deepEqual(talking.rate!.answers.map((a) => a.ask), situations.map((q) => q.ask), "the starting exam's answers wait for your thumbs");
  assert.equal(talking.started, null);
  const calm = card.subjects.find((s) => s.kind === "custom")!;
  assert.deepEqual([calm.name, calm.sittings[0]!.state, calm.started], ["Calm", "void", null], "a verdict missing: no evidence either way");

  // the night: Talking with you waits; Calm has its class
  clock.suspend(DAY);
  verdictsGiven = "1: yes\n2: yes\n3: no\n4: yes\n5: yes";
  const n1 = await home.school.night();
  assert.equal(n1.classes, 1, "only Calm: Talking with you waits for your thumbs");
  card = home.school.report("cy");
  assert.equal(card.subjects.find((s) => s.kind === "talking")!.trouble, "waiting for your thumbs on its answers");

  // your thumbs grade it: 4 of 5
  for (const a of talking.rate!.answers) home.school.thumb(talking.rate!.sitting, a.n, a.n !== 2);
  card = home.school.report("cy");
  assert.equal(card.subjects.find((s) => s.kind === "talking")!.started, 0.8);
  assert.throws(() => home.school.thumb(talking.rate!.sitting, 1, true), /no answers wait/);

  // over the cap (a day's cap: spent on the night's own day): no class at all, and it says so
  clock.suspend(DAY);
  home.spend.record({ tier: "big", model: "m", costUsd: 5, costSource: "reported", promptTokens: 1, completionTokens: 1 });
  const before = model.said.length;
  const n2 = await home.school.night();
  assert.equal(n2.classes, 0);
  assert.match(String(n2.stopped), /cap/);
  assert.equal(model.said.length, before, "no brain asked past the cap");
});

test("a class that reaches the spend cap part way stops there: nothing more is asked", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 3, 12, 0).getTime());
  const { home, model } = await agentHome(t, [], { clock, spendCapUsd: 1 });
  home.inbox.addOrb("eve", "Eve", "data");
  home.inbox.letGo("eve");
  const exam = mathsExam(seedOf("eve", 1, "maths", "Mathematics"));
  const brain = scripted({ exam, right: () => 5 });
  model.answer = (msgs) => {
    const reply = brain.answer(msgs);
    if (/Today's topic/.test(text(msgs).user)) home.spend.record({ tier: "teacher", model: "m", costUsd: 5, costSource: "reported", promptTokens: 1, completionTokens: 1 });
    return reply;
  };
  home.sendToSchool("eve", [{ kind: "maths" }], 0.8);
  await home.school.start("eve");
  clock.suspend(DAY);
  const n = await home.school.night();
  assert.equal(n.classes, 0);
  assert.match(String(n.stopped), /cap/);
  const after = brain.asked.slice(brain.asked.findIndex((m) => /Today's topic/.test(m.user)) + 1);
  assert.deepEqual(after, [], "after the lesson that reached the cap: no practice, no note, no exam");
  assert.equal(home.school.report("eve").subjects[0]!.sittings.length, 1, "only the starting exam");
});

test("a night takes only its share of the brain, each orb's first subject before anyone's second", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 3, 12, 0).getTime());
  const { home, model } = await agentHome(t, [], { clock, school: { asksANight: 6 } });
  for (const [id, name] of [["ada", "Ada"], ["bo", "Bo"]] as const) {
    home.inbox.addOrb(id, name, "data");
    home.inbox.letGo(id);
  }
  const lessons: string[] = [];
  model.answer = (msgs) => {
    const m = text(msgs);
    if (/Write a syllabus/.test(m.user)) return "1. One\n2. Two\n3. Three\n4. Four";
    if (/final exam/.test(m.user)) return Array.from({ length: 5 }, (_, i) => `Q: What is idea number ${i + 1}?\nP: point one\nP: point two`).join("\n\n");
    if (/For each answer, say whether/.test(m.user)) return "1: yes\n2: yes\n3: yes\n4: no\n5: no";
    const who = /^You are (\w+)'s teacher in ([\w ]+?) at/.exec(m.user);
    if (who) lessons.push(`${who[1]} ${who[2]}`);
    if (/Today's topic/.test(m.user)) return "Today: one idea.";
    if (/Write ONE note/.test(m.user)) return "A note.";
    if (/sitting your Mathematics exam/.test(m.system)) return "ANSWER 1: 0";
    return "An answer.";
  };
  home.sendToSchool("ada", [{ kind: "maths" }, { kind: "custom", name: "Calm" }], 0.8);
  home.sendToSchool("bo", [{ kind: "maths" }, { kind: "custom", name: "Calm" }], 0.8);
  await Promise.all([home.school.start("ada"), home.school.start("bo")]);
  clock.suspend(DAY);
  const n = await home.school.night();
  assert.deepEqual(lessons, ["Ada Mathematics", "Bo Mathematics"], "each orb's first subject, in turn, then the share ran out");
  assert.deepEqual([n.classes, n.left], [2, 2]);
  assert.match(String(n.stopped), /share of the brain/);
});

test("the door: send to school, the report card, the syllabus you change, your thumbs", async (t) => {
  const { home, model } = await agentHome(t, []);
  home.inbox.addOrb("di", "Di", "writing");
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.equal((await call("POST", "/orbs/di/school", { subjects: [{ kind: "talking" }], passMark: 0.8 })).status, 409, "in the office: not yet");
  home.inbox.letGo("di");
  model.answer = (msgs) => (/Write a syllabus/.test(text(msgs).user) ? "1. One\n2. Two\n3. Three\n4. Four" : "Sure, happy to help.");
  assert.equal((await call("POST", "/orbs/di/school", { subjects: [{ kind: "talking" }], passMark: 0.8 })).status, 200);
  await home.school.start("di");
  const card = (await call("GET", "/orbs/di/school")).json as { subjects: { id: number; rate: { sitting: number; answers: { n: number }[] } }[] };
  const s = card.subjects[0]!;
  assert.equal((await call("PUT", `/school/subjects/${s.id}/syllabus`, { topics: ["Listening", "Kindness"] })).status, 200);
  assert.deepEqual(home.school.report("di").subjects[0]!.syllabus, ["Listening", "Kindness"]);
  assert.equal((await call("POST", `/school/sittings/${s.rate.sitting}/answers/1`, { up: true })).status, 200);
  assert.equal(home.school.report("di").subjects[0]!.rate!.answers[0]!.up, true);
  assert.equal((await call("POST", "/orbs/di/school", { subjects: [{ kind: "wizardry" }], passMark: 0.8 })).status, 409, "already at school");
});
