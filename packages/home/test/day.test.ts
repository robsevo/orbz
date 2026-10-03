// PLAN 4.5_t (the day), in London's time, through the real kit (Ash's carried day, on what the
// home hands in):
//   - The brief says today's events and the orbs' bills in Ash's words; what clashes is named: two
//     that overlap, and two too close to get between when the place changes; the replies you owe.
//   - An orb asks about your day in plain words and is answered from it; a booking is never made.
//   - With no kit the day says why, rather than an empty day.
process.env.TZ = "Europe/London";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { _setAddressPolicy, blockedAddress } from "../src/agent/net.ts";
import { serve } from "../src/api.ts";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { FakeClock } from "../src/clock.ts";
import { agentHome } from "./helpers.ts";
import { fakeImap } from "./fakes/imap.ts";

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:standup", "DTSTART:20261005T090000", "DTEND:20261005T093000", "SUMMARY:Standup", "LOCATION:Office", "END:VEVENT",
  "BEGIN:VEVENT", "UID:dentist", "DTSTART:20261005T093500", "DTEND:20261005T100000", "SUMMARY:Dentist", "LOCATION:Smile Clinic", "END:VEVENT",
  "BEGIN:VEVENT", "UID:lunch", "DTSTART:20261005T120000", "DTEND:20261005T130000", "SUMMARY:Lunch", "END:VEVENT",
  "BEGIN:VEVENT", "UID:call", "DTSTART:20261005T123000", "DTEND:20261005T130000", "SUMMARY:Call with Sam", "END:VEVENT",
  "END:VCALENDAR", "",
].join("\r\n");

async function feed(t: TestContext): Promise<string> {
  const server = createServer((_req, res) => void res.writeHead(200, { "content-type": "text/calendar" }).end(ICS));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const prev = _setAddressPolicy((ip) => (ip === "127.0.0.1" ? false : blockedAddress(ip)));
  t.after(() => {
    _setAddressPolicy(prev);
    return new Promise<void>((r) => server.close(() => r()));
  });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/work.ics`;
}

test("the brief says your day and the orbs' bills in Ash's words; what clashes is named", { timeout: 90_000 }, async (t) => {
  const address = await feed(t);
  const clock = new FakeClock(new Date("2026-10-05T08:00").getTime());
  const { home } = await agentHome(t, [], { kit: true, clock, connectors: { store: new MemoryStore() } });
  await home.calendars.add("work", "Work", address);
  home.notices.remind({ orb: "juniper", kind: "bill", title: "Rent", due: "2026-10-05", amount: "$1,200" });
  const imap = await fakeImap(t, { user: "robin@example.com", password: "pw-not-real-5678" });
  imap.deliver("From: Dana Reyes <dana@example.com>\r\nSubject: Lunch Thursday?\r\nDate: Sat, 03 Oct 2026 10:00:00 +0000\r\n\r\nAre you free?\r\n");
  await home.mail.add("home", { host: "127.0.0.1", port: imap.port, tls: false, user: "robin@example.com" }, "pw-not-real-5678");
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const r = await fetch(`http://127.0.0.1:${door.port}/day`, { headers: { authorization: `Bearer ${door.token}` } });
  const day = (await r.json()) as { brief: string; clashes: { kind: string; said: string }[]; owedSaid: string | null };
  assert.equal(r.status, 200, JSON.stringify(day));
  assert.match(day.brief ?? JSON.stringify(day), /Standup at 9 am/, "today's events, as Ash says them");
  assert.match(day.brief, /Rent \(\$1,200\)/, "and the bill the orb keeps for you");
  assert.deepEqual(day.clashes.map((c) => c.said), [
    "5 min to get from Standup to Dentist, somewhere else (Mon 09:35)",
    "Lunch and Call with Sam overlap (Mon 12:30)",
  ]);
  assert.equal(day.owedSaid, 'One email waits for your reply: Dana Reyes ("Lunch Thursday?").', "and the reply you owe");
});

test("he asks about your day in plain words and is answered from it; a booking is never made", { timeout: 90_000 }, async (t) => {
  const address = await feed(t);
  const clock = new FakeClock(new Date("2026-10-05T08:00").getTime());
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "ask_day", args: { question: "what's next" } }] },
    { calls: [{ name: "ask_day", args: { question: "book lunch with Sam tomorrow at 1" } }] },
    { chunks: ["Standup at nine."] },
  ], { kit: true, clock, connectors: { store: new MemoryStore() } });
  await home.calendars.add("work", "Work", address);
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "what's next for me?");
  await home.inbox.idle();
  const seen = JSON.stringify(model.agent.slice(1));
  assert.match(seen, /Standup, today at 9 am/, "answered from your calendar, by Ash's day");
  assert.match(seen, /I can't change your calendar from here/, "and a booking is not made: it says so");
  assert.deepEqual(home.events.ofType("trace.step").filter((e) => e.data.kind === "tool").map((e) => e.data.name), ["ask_day", "ask_day"]);
});

test("with no kit the day says why, rather than an empty day", async (t) => {
  const { home } = await agentHome(t, []);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const day = (await (await fetch(`http://127.0.0.1:${door.port}/day`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as { why?: string };
  assert.match(day.why ?? "", /kit is not running/);
});
