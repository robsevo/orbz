// PLAN 3.8_t (levels and promotion cards), on a home's own log over three days:
//   - With the XP but no exam passed in its specialty, an orb is not proposed; with both, the night
//     proposes it once, as a notice carrying the evidence. It stays where it is until you say yes.
//   - Only the next level, and only on the evidence: a regression lately, or work outside its
//     specialty, is not evidence.
//   - A Senior's rank never lowers the floor: sending an email still waits for your OK.
//   - The first of his kind in the office starts as the Senior (owner, 10-02), the next a Junior;
//     with the last of a kind let go, the next one hired leads it again; rehired, he is what he was.
//   - His age counts from the day he was made and never restarts; his days in the company restart
//     when he is rehired, and stand still while he is away.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { Gym } from "../src/gym/night.ts";
import { levelOf, nextFor } from "../src/gym/levels.ts";
import { approved } from "./fixtures/bills.ts";
import { agentHome } from "./helpers.ts";

const BILLS = "dana|trigger:t1|read_file>remind {subject}";
/** A day's bills: ten easy jobs (one bill each, PLAN 3.13), 10 XP each. */
const BILL_DAY = ["Rent", "Gym", "Water", "Phone", "Car", "Power", "Net", "Tax", "Card", "Loan"];

test("XP without an exam passed is not proposed; with both the night proposes it once; only your yes promotes", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 1, 9, 0).getTime());
  const { home } = await agentHome(t, [], { clock });
  home.inbox.addOrb("lee", "Lee", "data"); // Lee came first, so leads data work: Dana starts a Junior
  home.inbox.addOrb("dana", "Dana", "data");
  for (let day = 0; day < 3; day++) {
    approved(home.events, "dana", BILL_DAY.map((s) => `${s} ${day}`), 100 + day * 10); // 100 XP a day: the cap is 150
    clock.suspend(86_400_000);
  }
  const gym = new Gym({ events: home.events, clock, dataDir: home.dataDir, kit: async () => ({}), teacher: () => null, orbs: () => [{ id: "dana", specialty: "data" }] });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, b?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(b !== undefined && { body: JSON.stringify(b) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };

  const before = nextFor(home.events, "dana", { specialty: "data", now: clock.now() })!;
  assert.deepEqual([before.to, before.evidence.xp.has, before.ready, before.missing], ["Mid", 300, false, ["1 more task learned in its specialty"]]);
  assert.deepEqual((await gym.night()).proposed, [], "the XP, but no exam passed: not proposed");
  assert.equal((await call("POST", "/orbs/dana/promote", { to: "Mid" })).status, 409, "nor can you promote it past the evidence");

  home.events.append("habit.promoted", { kind: BILLS, task: "dana|trigger:t1|{subject}", version: 1, runs: [100, 101, 102] }, { orb: "dana" });
  assert.deepEqual((await gym.night()).proposed, ["dana"]);
  assert.deepEqual((await gym.night()).proposed, [], "proposed once");
  assert.equal(levelOf(home.events, "dana"), "Junior", "proposed is not promoted");
  const notice = home.notices.list().find((n) => n.kind === "promotion")!;
  assert.match(notice.title, /Dana is ready for Mid/);
  assert.match(notice.detail, /325 XP; 1 task learned/);

  assert.equal((await call("POST", "/orbs/dana/promote", { to: "Senior" })).status, 409, "only the next level");
  assert.deepEqual((await call("POST", "/orbs/dana/promote", { to: "Mid" })).json, { level: "Mid" });
  assert.deepEqual(((await call("GET", "/orbs/dana/level")).json as { level: string; next: { to: string } }).next.to, "Senior");
  assert.ok(!home.notices.list().some((n) => n.kind === "promotion"), "answered: put away");
});

test("only on the evidence: a regression lately, or work outside its specialty, is not", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 1, 9, 0).getTime());
  const { home } = await agentHome(t, [], { clock });
  for (let day = 0; day < 3; day++) {
    approved(home.events, "dana", BILL_DAY.map((s) => `${s} ${day}`), 100 + day * 10);
    clock.suspend(86_400_000);
  }
  home.events.append("habit.promoted", { kind: BILLS, task: "dana|trigger:t1|{subject}", version: 1, runs: [100, 101, 102] }, { orb: "dana" });
  assert.equal(nextFor(home.events, "dana", { specialty: "data", now: clock.now() })!.ready, true);
  assert.deepEqual(nextFor(home.events, "dana", { specialty: "writing", now: clock.now() })!.missing, ["1 more task learned in its specialty"], "bills are data work, not writing");
  home.events.append("playbook.refused", { kind: "dana|schedule:s1|web_search {}", version: "p2" }, { orb: "dana" });
  clock.suspend(86_400_000);
  assert.deepEqual(nextFor(home.events, "dana", { specialty: "data", now: clock.now() })!.missing, ["no regression for 14 days"], "a day on, still too recent");
  clock.suspend(14 * 86_400_000);
  assert.equal(nextFor(home.events, "dana", { specialty: "data", now: clock.now() })!.ready, true, "a fortnight on, it has held");
  home.events.append("habit.undone", { kind: BILLS, version: 1 }, { orb: "dana" });
  assert.equal(nextFor(home.events, "dana", { specialty: "data", now: clock.now() })!.ready, false, "a habit you took back is not evidence");
});

test("a Senior's rank never lowers the floor: sending an email still waits for your OK", async (t) => {
  const { home } = await agentHome(t, [{ calls: [{ name: "shell", args: { command: "mail -s 'Your invoice' bob@example.com < invoice.txt" } }] }], {
    agent: { decide: () => "allow" }, // even with your rules allowing every call
  });
  home.events.append("orb.promoted", { from: "Junior", to: "Mid" }, { orb: "juniper" });
  home.events.append("orb.promoted", { from: "Mid", to: "Senior" }, { orb: "juniper" });
  assert.equal(levelOf(home.events, "juniper"), "Senior");
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "send Bob his invoice");
  await home.inbox.idle();
  const card = home.conversations.openCard("chat:juniper");
  assert.ok(card, "a card, whatever the rank");
  assert.deepEqual(card!.meta.floor, [{ category: "messaging", why: "messaging someone always asks" }]);
});

test("the first of his kind starts as the Senior, the next a Junior; with the last of a kind let go, the next leads it again", async (t) => {
  const { home } = await agentHome(t, []);
  home.inbox.addOrb("ada", "Ada", "frontend");
  home.inbox.addOrb("bea", "Bea", "frontend");
  home.inbox.addOrb("cy", "Cy", "writing");
  assert.deepEqual(["ada", "bea", "cy"].map((o) => levelOf(home.events, o)), ["Senior", "Junior", "Senior"], "Ada leads frontend work, and Cy, the first writer, writing");
  home.inbox.letGo("ada");
  home.inbox.addOrb("dee", "Dee", "frontend");
  assert.equal(levelOf(home.events, "dee"), "Junior", "Bea is still in the office: frontend has someone");
  home.inbox.letGo("bea");
  home.inbox.letGo("dee");
  home.inbox.addOrb("eli", "Eli", "frontend");
  assert.equal(levelOf(home.events, "eli"), "Senior", "nobody of his kind in the office: Eli leads it");
  home.inbox.rehire("bea");
  home.inbox.rehire("ada");
  assert.deepEqual([levelOf(home.events, "bea"), levelOf(home.events, "ada")], ["Junior", "Senior"], "rehired, each is what he was");
  const next = nextFor(home.events, "ada", { specialty: "frontend", now: home.clock.now() })!;
  assert.equal(next.to, "Staff", "a Senior's next level is Staff, on the same evidence as anyone's");
});

test("his age never restarts; his days in the company restart when he is rehired, and stand still while he is away", async (t) => {
  const DAY = 86_400_000;
  const clock = new FakeClock(new Date(2026, 9, 1, 9, 0).getTime());
  const made = clock.now();
  const { home } = await agentHome(t, [], { clock });
  home.inbox.addOrb("ada", "Ada", "frontend");
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const level = async () =>
    (await (await fetch(`http://127.0.0.1:${door.port}/orbs/ada/level`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as { born: number; hired: number; left: number | null; now: number };
  clock.suspend(40 * DAY);
  home.inbox.letGo("ada");
  clock.suspend(10 * DAY);
  const away = await level();
  assert.deepEqual([away.born, away.hired, away.left, away.now], [made, made, made + 40 * DAY, made + 50 * DAY], "away: 50 days old, 40 days in the company");
  home.inbox.rehire("ada");
  clock.suspend(5 * DAY);
  const back = await level();
  assert.deepEqual([back.born, back.hired, back.left, back.now], [made, made + 50 * DAY, null, made + 55 * DAY], "back: 55 days old, 5 days in the company");
});
