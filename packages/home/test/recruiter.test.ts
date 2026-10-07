// PLAN 5.8_t, the recruiter, on a real home:
//   - only the positions you tick get applicants; one day's are the same however often you look (and
//     on any device: the home keeps the seeds);
//   - the list turns over once a day (owner, 10-06): at midnight yesterday's unanswered applicants take
//     other jobs and today's apply, new people, by the home's own tick with no one looking; one you
//     have begun to interview waits through the turn, a week at most; Pass sends one on;
//   - an interview: the brain answers as the applicant, told it can only talk, asked only when you
//     speak, its cost recorded; hired, the interview is the new orb's first chat;
//   - the orbs you let go apply again for an open position, the most qualified first;
//   - several positions at once (owner, 10-07: "an all filter ... and also give them groups"): every
//     kind of work, or a department's, in one go, each opened once; a wrong name in the list changes none;
//   - the door's routes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { PER_DAY, WAIT_DAYS } from "../src/recruiter.ts";
import { levelOf } from "../src/gym/levels.ts";
import { SPECIALTY_FAMILIES } from "../src/brain/constitution.ts";
import { serve } from "../src/api.ts";
import { agentHome } from "./helpers.ts";

const DAY = 86_400_000;

test("only ticked positions get applicants; a day's are the same however often you look; each day the list turns over, new people", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 3, 9, 0).getTime());
  const { home } = await agentHome(t, [], { clock });
  assert.deepEqual(home.recruiting().applicants, [], "no position ticked: no one applies");
  home.recruiter.setPosition("frontend", true);
  const first = home.recruiting().applicants;
  assert.equal(first.length, PER_DAY);
  assert.ok(first.every((a) => a.specialty === "frontend" && a.startsAs === "Senior"), "the first of a kind would start as the Senior");
  assert.deepEqual(home.recruiting().applicants, first, "looking again the same day: the same applicants");
  assert.throws(() => home.recruiter.setPosition("wizardry", true), /not a kind of work/);
  home.inbox.addOrb("ada", "Ada", "frontend");
  assert.ok(home.recruiting().applicants.every((a) => a.startsAs === "Junior"), "with a frontend orb in the office: a Junior");

  const seen = new Set(first.map((a) => a.seed));
  let yesterday = first;
  for (let d = 1; d <= 3; d++) {
    clock.suspend(DAY);
    const today = home.recruiting().applicants;
    assert.equal(today.length, PER_DAY, `day ${d + 1}: today's applicants only`);
    assert.ok(!today.some((a) => yesterday.some((y) => y.id === a.id)), `day ${d + 1}: yesterday's took other jobs`);
    assert.ok(today.every((a) => !seen.has(a.seed)), `day ${d + 1}: new people`);
    today.forEach((a) => seen.add(a.seed));
    yesterday = today;
  }
  assert.equal(home.events.ofType("applicant.gone").length, 3 * PER_DAY, "each day's left unanswered went at the turn");

  // unticked, the position's applicants are out of sight; ticked again the same day, the same people
  home.recruiter.setPosition("frontend", false);
  assert.deepEqual(home.recruiting().applicants, []);
  home.recruiter.setPosition("frontend", true);
  assert.deepEqual(home.recruiting().applicants.map((a) => a.id), yesterday.map((a) => a.id), "the same day: the same people");
});

test("the list turns over at midnight by the home's own tick, with no one looking; one you have begun to interview waits a week", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 3, 21, 0).getTime());
  // a heartbeat of a day: only the recruiter's own wake-up at midnight can tick the home before 03:00
  const { home, model } = await agentHome(t, [], { clock, heartbeatMs: DAY });
  home.start();
  home.recruiter.setPosition("design", true);
  const [kept, other] = home.recruiting().applicants;
  model.replies.push("Colour is how I think.");
  await home.interview(kept!.id, { name: "Iris", title: "Designer", focus: "looks", tone: "calm" }, "Why design?");
  assert.equal(home.recruiter.nextAt(), new Date(2026, 9, 4).getTime(), "the next turn: midnight");

  const applied = home.events.ofType("applicant.applied").length;
  await clock.advance(3 * 3_600_000 + 60_000); // the home stays awake past midnight; no one opens the Recruiter
  assert.equal(home.events.ofType("applicant.applied").length, applied + PER_DAY, "today's applied at the turn, by the tick");
  assert.ok(home.events.ofType("applicant.gone").some((e) => e.data.applicant === other!.id), "yesterday's unanswered one took another job at the turn");

  const now = home.recruiting().applicants.map((a) => a.id);
  assert.ok(now.includes(kept!.id), "the one you began to interview waits for your answer");
  assert.ok(!now.includes(other!.id));
  assert.equal(now.length, PER_DAY + 1);
  for (let d = 0; d < WAIT_DAYS; d++) clock.suspend(DAY);
  assert.ok(!home.recruiting().applicants.some((a) => a.id === kept!.id), `after a week (${WAIT_DAYS} days), even an interviewed one takes another job`);
});

test("Pass sends an applicant on; an interview answers as the applicant, with no tools, and hired, it is the first chat", async (t) => {
  const { home, model } = await agentHome(t, []);
  home.recruiter.setPosition("writing", true);
  const [a, b] = home.recruiting().applicants;
  home.recruiter.pass(a!.id);
  assert.deepEqual(home.recruiting().applicants.map((x) => x.id), [b!.id], "passed: gone");
  assert.throws(() => home.recruiter.pass(a!.id), /no one by that number is waiting/);

  model.replies.push("Words are my favourite tools.", "Tuesdays, mostly.");
  const who = { name: "Wren", title: "Wordsmith", focus: "docs, posts, emails and clear words", tone: "bright and warm" };
  assert.equal(model.said.length, 0, "no brain is asked while no one interviews");
  assert.equal(await home.interview(b!.id, who, "Why writing?"), "Words are my favourite tools.");
  assert.equal(await home.interview(b!.id, who, "When are you at your best?"), "Tuesdays, mostly.");
  const second = model.said[1]!.map((m) => String((m as { content?: unknown }).content));
  assert.match(second[0]!, /You are Wren, an orb .* applying for a job as a Wordsmith/);
  assert.match(second[0]!, /no tools/, "told it can only talk");
  assert.deepEqual(second.slice(1), ["Why writing?", "Words are my favourite tools.", "When are you at your best?"], "the interview so far goes with each question");
  assert.equal(home.events.ofType("brain.spend").length, 2, "its cost is recorded, once a question");
  await assert.rejects(home.interview(b!.id, who, "   "), /say something first/);

  const shown = home.recruiting().applicants.find((x) => x.id === b!.id)!.startsAs;
  assert.equal(shown, "Senior", "no writer in the office: the first of a kind starts as the Senior");
  const hired = home.hireApplicant(b!.id, { id: "wren", name: "Wren", look: { hue: "rose", shape: "drop" } });
  assert.equal(hired.specialty, "writing", "as applied: the position's kind of work");
  assert.deepEqual(hired.look, { hue: "rose", shape: "drop" }, "as the dice made it");
  assert.equal(levelOf(home.events, "wren"), shown, "at the level the recruiter showed");
  assert.deepEqual(home.conversations.history("chat:wren").map((m) => [m.role, m.content]), [
    ["user", "Why writing?"], ["assistant", "Words are my favourite tools."], ["user", "When are you at your best?"], ["assistant", "Tuesdays, mostly."],
  ], "the interview is Wren's first chat");
  assert.throws(() => home.hireApplicant(b!.id, { id: "wren2", name: "Wren", look: {} }), /no one by that number is waiting/, "hired once");
});

test("the orbs you let go apply again for an open position, the most qualified first; the door", async (t) => {
  const { home, model } = await agentHome(t, []);
  home.inbox.addOrb("ada", "Ada", "data");
  home.inbox.addOrb("bo", "Bo", "data");
  home.events.append("orb.promoted", { from: "Junior", to: "Mid" }, { orb: "bo" });
  home.inbox.letGo("ada");
  home.inbox.letGo("bo");
  assert.deepEqual(home.recruiting().returning, [], "no position open: no one applies again");
  home.recruiter.setPosition("data", true);
  const back = home.recruiting().returning;
  assert.deepEqual(back.map((r) => [r.id, r.level]), [["ada", "Senior"], ["bo", "Mid"]], "the most qualified first");

  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.deepEqual((await call("PUT", "/recruiter/positions/design", { open: true })).json.positions, ["data", "design"]);
  const state = (await call("GET", "/recruiter")).json as { applicants: { id: number; specialty: string }[] };
  const one = state.applicants.find((a) => a.specialty === "design")!;
  model.replies.push("Colour is how I think.");
  const asked = await call("POST", `/applicants/${one.id}/interview`, { text: "Why design?", name: "Iris", title: "Designer", focus: "looks", tone: "calm" });
  assert.equal(asked.json.answer, "Colour is how I think.");
  assert.deepEqual(((await call("GET", `/applicants/${one.id}/interview`)).json.said as { role: string }[]).map((l) => l.role), ["you", "orb"]);
  assert.equal((await call("POST", `/applicants/${one.id}/hire`, { id: "iris", name: "Iris", look: {} })).status, 200);
  assert.equal(home.inbox.orb("iris")?.specialty, "design");
  assert.equal((await call("POST", `/applicants/${one.id}/pass`)).status, 409, "hired already: no one by that number is waiting");
  assert.equal((await call("PUT", "/recruiter/positions/wizardry", { open: true })).status, 400);
});

test("several positions at once: every kind of work, or a department's, each opened once; a wrong name changes none; the door", async (t) => {
  const { home } = await agentHome(t, []);
  const every = Object.keys(SPECIALTY_FAMILIES);
  home.recruiter.setPosition("design", true);
  assert.deepEqual(new Set(home.recruiter.setPositions(every, true)), new Set(every), "every kind of work, in one go");
  assert.equal(home.events.ofType("position.opened").length, every.length, "each opened once (design was open already)");
  assert.equal(home.recruiting().applicants.length, every.length * PER_DAY, "and today's applicants for each");
  assert.throws(() => home.recruiter.setPositions(["frontend", "wizardry"], false), /"wizardry" is not a kind of work/);
  assert.equal(home.recruiter.positions().length, every.length, "a wrong name in the list: none closed");
  const business = every.filter((k) => SPECIALTY_FAMILIES[k as keyof typeof SPECIALTY_FAMILIES] === "finance"); // a department's all: Finance's
  assert.ok(business.includes("fundamentals"), "the fundamental analyst is Finance's (owner, 10-07)");
  home.recruiter.setPositions(business, false);
  assert.deepEqual(home.recruiter.positions().filter((k) => business.includes(k)), [], "a department closed in one go");
  assert.equal(home.recruiter.positions().length, every.length - business.length, "and only it");

  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const put = async (body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}/recruiter/positions`, { method: "PUT", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as { positions?: string[] } };
  };
  assert.deepEqual((await put({ specialties: business, open: true })).json.positions?.length, every.length, "Business open again, through the door");
  assert.equal((await put({ specialties: "business", open: true })).status, 400, "not a list");
  assert.equal((await put({ specialties: ["fundamentals", "wizardry"], open: false })).status, 400, "a wrong name");
  assert.ok(home.recruiter.positions().includes("fundamentals"), "and nothing closed by it");
});
