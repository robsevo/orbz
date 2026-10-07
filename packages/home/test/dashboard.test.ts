// The home page's look at the office (owner, 10-07: "a nice home page the app can default to ... with a nice
// dashboard and stats"), on a real home at a fixed noon, read by code:
//   - who is working (a run under way) and who waits for you (a card open); a run never heard to finish, hours ago,
//     is not work, a finished run and an answered card are nothing (controls);
//   - XP today and this week (what was taken back counts against it; ten days ago is not this week), and the brain's
//     tokens and requests today and this week;
//   - the top of the office, what was finished lately (the whole office's, not an orb let go), the sessions most
//     lately spoken in, the office's latest meetings, what is coming in the next two days (not what has passed, not
//     next week), who is applying;
//   - the door's /dashboard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { dashboardOf, STALE_RUN_MS } from "../src/dashboard.ts";
import { serve } from "../src/api.ts";
import { tabConversation } from "../src/team.ts";
import { agentHome } from "./helpers.ts";

const H = 3_600_000;
const DAY = 24 * H;
const day = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("one look at the office, by code: working and waiting, XP and the brain, the top, the latest work, sessions, meetings, what is coming, who applies", async (t) => {
  const now = new Date(2026, 9, 7, 12, 0).getTime();
  const clock = new FakeClock(now - 11 * DAY); // the clock only moves on: it walks through the days to noon
  const { home } = await agentHome(t, [], { clock });
  home.about.setName("Robin");
  for (const [id, name, sp] of [["ada", "Ada", "frontend"], ["bea", "Bea", "research"], ["cy", "Cy", "writing"], ["dot", "Dot", "data"]] as const) home.inbox.addOrb(id, name, sp);
  const to = (at: number): void => {
    assert.ok(at >= clock.now(), "in order");
    clock.suspend(at - clock.now());
  };
  const ev = (type: string, data: Record<string, unknown>, orb: string | null): number => home.events.append(type, data, { orb });
  const spend = (orb: string, prompt: number, completion: number): number => ev("brain.spend", { tier: "big", model: "m", cost_usd: null, cost_source: "none", prompt_tokens: prompt, completion_tokens: completion }, orb);
  to(now - 10 * DAY);
  ev("xp.earned", { amount: 100, reason: "a run you approved", source: 1, at: clock.now() }, "cy"); // not this week
  to(now - 9 * DAY);
  spend("cy", 5000, 0); // not this week
  to(now - 3 * DAY);
  ev("xp.earned", { amount: 15, reason: "a plan row", source: 2, at: clock.now() }, "ada");
  to(now - 2 * DAY);
  spend("bea", 1000, 0);
  to(now - STALE_RUN_MS - H);
  ev("run.started", { run: 2 }, "bea"); // the home stopped under it
  to(now - 2 * H);
  ev("run.started", { run: 3 }, "cy");
  // a meeting with ideas traded
  ev("social.met", { a: "ada", b: "bea", kind: "ideas", place: "bistro1", word: "Colleagues", delta: 2, ideas: [{ orb: "ada", text: "A pricing page with three plans." }] }, null);
  to(now - H);
  ev("run.started", { run: 1 }, "ada");
  ev("run.finished", { run: 3, outcome: "ok", summary: "Wrote the launch post. It is in the workspace." }, "cy");
  ev("card.opened", { card: 1 }, "bea");
  ev("card.opened", { card: 2 }, "cy");
  ev("xp.earned", { amount: 40, reason: "a run you approved", source: 3, at: clock.now() }, "bea");
  ev("xp.lost", { amount: -5, reason: "a card you denied", source: 4, at: clock.now() }, "bea");
  spend("ada", 100, 20);
  to(now - H / 2);
  ev("card.resolved", { card: 2, status: "approved" }, "cy");
  to(now - H / 4);
  ev("run.finished", { run: 9, outcome: "ok", summary: "Cleaned the sales sheet." }, "dot"); // then let go: not the office's
  home.inbox.letGo("dot");
  to(now);
  // sessions: the one spoken in last first
  const older = home.team.create("Spring launch", { brainstorm: ["ada", "bea"] });
  const newer = home.team.create("Mystery night", { brainstorm: ["cy"], floor: ["ada"] });
  clock.suspend(1000);
  home.conversations.add({ conversation: tabConversation(older.id, "brainstorm"), orb: "ada", role: "assistant", content: "Let us start." });
  // what is coming: this afternoon, tomorrow; next week is not
  home.notices.remind({ orb: "ada", kind: "reminder", title: "Call the venue", due: `${day(now)}T15:00` });
  home.notices.remind({ orb: "ada", kind: "bill", title: "Rent", due: day(now + DAY), amount: "$1,200" });
  home.notices.remind({ orb: "ada", kind: "bill", title: "Insurance", due: day(now + 5 * DAY), amount: "$90" });
  home.recruiter.setPosition("design", true);

  const d = dashboardOf(home);
  assert.equal(d.name, "Robin");
  assert.equal(d.orbs, home.inbox.orbs().length, "everyone in the office");
  assert.deepEqual(d.working, ["ada"], "a run under way; not one never heard to finish hours ago, nor a finished one");
  assert.deepEqual(d.waiting, ["bea"], "a card open; not an answered one");
  assert.deepEqual([d.xp.today, d.xp.week], [35, 50], "what was taken back counts against it; ten days ago is not this week");
  assert.deepEqual(d.xp.top.slice(0, 2).map((r) => [r.orb, r.xp]), [["cy", 100], ["bea", 35]], "the top: all-time XP");
  assert.deepEqual(d.brain, { today: { tokens: 120, requests: 1 }, week: { tokens: 1120, requests: 2 } });
  assert.deepEqual(d.lately.map((w) => [w.name, w.summary]), [["Cy", "Wrote the launch post."]], "the office's latest work, its first sentence; not an orb let go");
  assert.deepEqual(d.sessions.map((s) => [s.title, s.orbs]), [["Spring launch", 2], ["Mystery night", 2]], "the one spoken in last first");
  assert.ok(newer.id > older.id);
  assert.deepEqual(d.meetings.map((m) => [m.a, m.b, m.kind, m.idea]), [["Ada", "Bea", "ideas", "A pricing page with three plans."]]);
  assert.deepEqual(d.coming.map((c) => c.title), ["Call the venue", "Rent"], "this afternoon, then tomorrow; not next week");
  assert.deepEqual(d.hiring, { positions: 1, applicants: 2 });

  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const r = await fetch(`http://127.0.0.1:${door.port}/dashboard`, { headers: { authorization: `Bearer ${door.token}` } });
  const got = (await r.json()) as { working: string[]; xp: { week: number } };
  assert.deepEqual([r.status, got.working, got.xp.week], [200, ["ada"], 50], "through the door");
});
