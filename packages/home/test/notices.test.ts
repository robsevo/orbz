// PLAN 2.11_t, the notification centre on the home, on a fake clock (local time):
//   - A bill comes up three days ahead, once: not every hour after; a reminder at its time; one
//     already up when it is kept says so at once; a day that does not exist is refused.
//   - The home's timer wakes for the next one to come up.
//   - An approval waiting is a notice until it is answered; work finished is one, the newest per
//     conversation.
//   - The `remind` tool keeps a bill for the person.
//   - Through the door: what is out, putting one away (for every device: an event says so), all.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { serve } from "../src/api.ts";
import { comesUpAt } from "../src/notices.ts";
import { agentHome } from "./helpers.ts";

const local = (s: string): number => new Date(s).getTime(); // "2026-10-03T00:30" without a zone is local time
const titles = (h: Awaited<ReturnType<typeof agentHome>>) => h.home.notices.list().map((n) => `${n.kind}: ${n.title}${n.detail ? ` (${n.detail})` : ""}`);

test("a bill comes up three days ahead, once; a reminder at its time; a day that is not there is refused", async (t) => {
  const clock = new FakeClock(local("2026-10-01T08:00"));
  const h = await agentHome(t, [], { clock });
  h.home.notices.remind({ orb: "juniper", kind: "bill", title: "Rent", due: "2026-10-06", amount: "$1,200" });
  h.home.notices.remind({ orb: "juniper", kind: "reminder", title: "Call the dentist", due: "2026-10-03T15:00" });
  assert.deepEqual(titles(h), [], "nothing has come up yet");
  assert.equal(h.home.notices.nextDueAt(), local("2026-10-03T00:00"), "the home wakes when the rent comes up");

  clock.suspend(local("2026-10-02T23:59") - clock.now());
  await h.home.tick();
  assert.deepEqual(titles(h), [], "not a minute early");
  clock.suspend(local("2026-10-03T00:30") - clock.now());
  await h.home.tick();
  assert.deepEqual(titles(h), ["bill: Rent is due in 3 days ($1,200)"]);
  for (let hour = 0; hour < 24; hour++) {
    clock.suspend(3_600_000);
    await h.home.tick();
  }
  assert.deepEqual(titles(h), ["reminder: Call the dentist", "bill: Rent is due in 3 days ($1,200)"], "the rent once, not every hour; the dentist at three");
  assert.equal(h.home.notices.nextDueAt(), null, "nothing else waiting");

  h.home.notices.remind({ orb: "juniper", kind: "reminder", title: "Water the plants", due: "2026-10-01" });
  assert.equal(titles(h)[0], "reminder: Water the plants", "one already up says so when it is kept");
  for (const bad of ["2026-02-30", "next friday", "2026-10-05T25:00"]) {
    assert.throws(() => h.home.notices.remind({ orb: "juniper", kind: "bill", title: "x", due: bad }), /no 2026|a due date is a day/, bad);
  }
  assert.throws(() => h.home.notices.remind({ orb: "juniper", kind: "bill", title: "  ", due: "2026-10-09" }), /needs a title/);
  assert.equal(comesUpAt("2026-10-06", 3), local("2026-10-03T00:00"));
});

test("an approval waiting is a notice until it is answered; finished work is one, the newest per conversation", async (t) => {
  const h = await agentHome(t, [
    { calls: [{ name: "shell", args: { command: "echo hi" } }] },
    { chunks: ["Done it."] },
    { chunks: ["Done the second one too."] },
  ], { agent: { decide: (def) => (def.name === "shell" ? "ask" : "allow") } });
  h.home.inbox.send("juniper", "chat:juniper", "say hi in the shell");
  await h.home.inbox.idle();
  const card = h.home.conversations.openCard("chat:juniper")!;
  assert.ok(card);
  assert.deepEqual(h.home.notices.list().map((n) => [n.kind, n.card, n.conversation]), [["approval", card.id, "chat:juniper"]]);
  h.home.answerCard(card.id, "approve");
  for (let i = 0; i < 20 && !h.home.notices.list().some((n) => n.kind === "done"); i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.deepEqual(titles(h), ["done: Juniper finished (Done it.)"], "the answered card is put away; the finished work is out");
  h.home.inbox.send("juniper", "chat:juniper", "and again");
  for (let i = 0; i < 20 && !titles(h).some((l) => l.includes("second")); i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.deepEqual(titles(h), ["done: Juniper finished (Done the second one too.)"], "only the newest, per conversation");
});

test("the remind tool keeps a bill for the person, and says when it comes up", async (t) => {
  const h = await agentHome(t, [
    { calls: [{ name: "remind", args: { kind: "bill", title: "Car insurance", due: "2030-03-20", amount: "€310", ahead_days: 7 } }] },
    { chunks: ["I'll remind you a week before."] },
  ]);
  h.home.inbox.addOrb("ada", "Ada", "accountant");
  h.home.inbox.send("ada", "chat:ada", "my car insurance renews on 20 March 2030, €310");
  for (let i = 0; i < 20 && h.model.agent.length < 2; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.deepEqual(h.home.notices.reminders().map((r) => [r.orb, r.kind, r.title, r.due, r.amount, r.aheadDays, r.conversation]), [["ada", "bill", "Car insurance", "2030-03-20", "€310", 7, "chat:ada"]]);
  const said = h.home.conversations.list("chat:ada").find((m) => m.role === "tool")!.content;
  assert.match(said, /^Kept \(bill \d+\)\. It comes up 13 Mar 2030/);
});

test("through the door: what is out, putting one away for every device, putting all away", async (t) => {
  const clock = new FakeClock(local("2026-10-05T09:00"));
  const h = await agentHome(t, [], { clock });
  for (const title of ["Rent", "Phone", "Gym"]) h.home.notices.remind({ orb: "juniper", kind: "bill", title, due: "2026-10-06" });
  const door = await serve(h.home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}` } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const out = (await call("GET", "/notices")).json.notices as { id: number; title: string }[];
  assert.deepEqual(out.map((n) => n.title).sort(), ["Gym is due tomorrow", "Phone is due tomorrow", "Rent is due tomorrow"]);
  const seq = h.home.events.head();
  assert.equal((await call("POST", `/notices/${out[0]!.id}/put-away`)).status, 200);
  assert.deepEqual(h.home.events.since(seq).filter((e) => e.type === "notice.put_away").map((e) => e.data.notices), [[out[0]!.id]], "every device hears it");
  assert.equal(((await call("GET", "/notices")).json.notices as unknown[]).length, 2);
  assert.equal((await call("POST", `/notices/${out[0]!.id}/put-away`)).status, 404, "away already");
  assert.equal((await call("POST", "/notices/put-away")).json.put, 2);
  assert.deepEqual((await call("GET", "/notices")).json.notices, []);
  assert.equal(((await call("GET", "/reminders")).json.reminders as unknown[]).length, 3, "the reminders are still kept (the calendar's)");
});

test("an orb's reminder is handed to the person's assistant, who plans everything; it says so", async (t) => {
  // owner, 10-04: "hand off the planning notif to the persons assistant orb, which should always be the case, even in the code"
  const h = await agentHome(t, [
    { calls: [{ name: "remind", args: { kind: "reminder", title: "Water on for dinner", due: "2030-03-20T18:15" } }] },
    { chunks: ["Maya has it: water on at 6:15."] },
  ]);
  h.home.inbox.addOrb("maya", "Maya", "assistant");
  h.home.inbox.addOrb("basil", "Basil", "chef");
  h.home.inbox.send("basil", "chat:basil", "remind me to start dinner at 6:15 on 20 March 2030");
  for (let i = 0; i < 20 && h.model.agent.length < 2; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.deepEqual(h.home.notices.reminders().map((r) => [r.orb, r.title, r.conversation]), [["maya", "Water on for dinner", "chat:basil"]], "kept by Maya, made in Basil's chat");
  const said = h.home.conversations.list("chat:basil").find((m) => m.role === "tool")!.content;
  assert.match(said, /^Handed to Maya, the person's assistant/);
  // who keeps what: the assistant its own; an accountant its bills, but not its reminders; with no assistant, the orb itself
  h.home.inbox.addOrb("penny", "Penny", "accountant");
  assert.equal(h.home.plannerFor("maya", "reminder").id, "maya");
  assert.equal(h.home.plannerFor("penny", "bill").id, "penny", "the accountant holds the bills");
  assert.equal(h.home.plannerFor("penny", "reminder").id, "maya", "and hands over the rest");
  assert.equal(h.home.plannerFor("basil", "bill").id, "maya");
  await h.home.letGo("maya");
  assert.deepEqual(h.home.inbox.orbs().filter((o) => o.specialty === "assistant"), [], "Maya let go");
  assert.equal(h.home.plannerFor("basil", "reminder").id, "basil", "control: with no assistant here, the orb keeps it");
});
