// PLAN 5.16_t, the company's board (owner, 10-07: "on your board, you also need to have it always be an odd number for
// voting proposals ... Chairperson(CEO), Vice Chair(Best Employee), Secretary(Personal Assistant), Treasurer(CFO) ...
// Employees and Board Vote for best employee(s)/orbs to be on the board as well, as the company grows, so does the board";
// "Each thinks, cheap brain"):
//   - its seats are always odd and never more than the office has, growing with it;
//   - the officers by their posts, then the elected: the Vice Chair, then directors;
//   - everyone votes, by code: never for itself, the officers not candidates; the fortnight's work wins, how two get
//     on tips it; the home holds an election when the board has three to seat, again when its size changes, and weekly;
//   - a proposal: each member votes on the cheapest brain, one line why; a majority of the votes cast carries it; what
//     is carried every orb hears; a vote's cost recorded as the board's; through the door too.
import assert from "node:assert/strict";
import { test } from "node:test";
import { election, readVote, seat, seatsFor, ELECT_EVERY_MS, type Member } from "../src/boardroom.ts";
import { FakeClock } from "../src/clock.ts";
import { serve } from "../src/api.ts";
import { agentHome } from "./helpers.ts";

const m = (id: string, specialty: string, xp = 0, createdAt = 0, rank = 0): Member => ({ id, name: id[0]!.toUpperCase() + id.slice(1), specialty, xp, rank, createdAt });

test("its seats are always odd and never more than the office, growing with it", () => {
  for (let n = 1; n <= 40; n++) {
    const s = seatsFor(n);
    assert.equal(s % 2, 1, `${n} orbs: ${s} seats, odd`);
    assert.ok(s <= n, `${n} orbs: no more seats than orbs`);
  }
  assert.deepEqual([1, 2, 3, 5, 6, 11, 12, 17, 18].map(seatsFor), [1, 1, 3, 3, 5, 5, 7, 7, 9], "three, five from six, two more for every six more");
  assert.equal(seatsFor(0), 0);
});

test("the officers by their posts, then the elected: the Vice Chair, then directors; everyone votes, never for itself", () => {
  const office = [m("max", "ceo", 50, 1), m("pip", "assistant", 40, 2), m("fin", "cfo", 30, 3), m("ada", "frontend", 90, 4), m("bo", "design", 20, 5), m("cy", "writing", 60, 6), m("di", "data", 10, 7)];
  // the CFO had the best fortnight of all: were the officers candidates, the votes would go to Fin
  const recent: Record<string, number> = { fin: 90, ada: 40, cy: 25, bo: 5, di: 0 };
  const r = election(office, { recent: (id) => recent[id] ?? 0, gets: () => 0 });
  assert.equal(r.votes.length, office.length, "everyone votes");
  assert.ok(r.votes.every((v) => v.voter !== v.for), "never for itself");
  assert.ok(r.votes.every((v) => !["max", "pip", "fin"].includes(v.for)), "the officers sit by their posts, not by vote");
  assert.equal(r.votes.find((v) => v.voter === "ada")!.for, "cy", "ada cannot vote for herself: the next best");
  assert.deepEqual(r.ranking.slice(0, 2), ["ada", "cy"], "the fortnight's work wins");
  const seats = seat(office, r.ranking);
  assert.deepEqual(seats.map((s) => [s.orb, s.post]), [["max", "chair"], ["pip", "secretary"], ["fin", "treasurer"], ["ada", "vice"], ["cy", "director"]], "seven orbs, five seats");
  // how two get on tips a close call: with bo's fortnight as good as cy's, ada (who gets on with bo) votes bo
  const close: Record<string, number> = { ...recent, bo: 25 };
  const tipped = election(office, { recent: (id) => close[id] ?? 0, gets: (v, o) => (v === "ada" && o === "bo" ? 100 : 0) });
  assert.equal(tipped.votes.find((v) => v.voter === "ada")!.for, "bo", "a friend's vote, where the work is level");
  assert.equal(election(office, { recent: (id) => close[id] ?? 0, gets: () => 0 }).votes.find((v) => v.voter === "ada")!.for, "cy", "control: without it, the all-time XP decides (cy's 60 over bo's 20)");
  assert.equal(tipped.votes.find((v) => v.voter === "max")!.for, "ada", "and the fortnight's work still counts first");
  // a small office: three seats, the officers first
  assert.deepEqual(seat(office.slice(0, 4), r.ranking).map((s) => s.post), ["chair", "secretary", "treasurer"]);
  assert.deepEqual(seat([m("max", "ceo"), m("pip", "assistant")], []).map((s) => s.post), ["chair"], "two orbs: one seat, the Chair's");
});

test("a member's answer read: yes or no first, then why; anything else abstains", () => {
  assert.deepEqual(readVote("YES — it pays for itself in a month."), { vote: "yes", why: "it pays for itself in a month." });
  assert.deepEqual(readVote("no. Too early."), { vote: "no", why: "Too early." });
  assert.equal(readVote("Maybe, it depends").vote, "abstain");
  assert.equal(readVote(null).vote, "abstain");
});

test("the home elects when the board has three to seat, again when its size changes, and weekly; a proposal is voted on the cheapest brain and carried by a majority; every orb hears it", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 7, 12, 0).getTime());
  const { home, model } = await agentHome(t, [{ chunks: ["ok"] }], { clock });
  home.inbox.letGo("juniper");
  home.about.setCompany("Acme Orbs");
  home.inbox.addOrb("max", "Max", "ceo");
  home.inbox.addOrb("pip", "Pip", "assistant");
  await home.tick();
  assert.equal(home.events.ofType("board.elected").length, 0, "two orbs: no board to elect");
  home.inbox.addOrb("ada", "Ada", "frontend");
  await home.tick();
  assert.equal(home.events.ofType("board.elected").length, 1, "three: the first election");
  assert.deepEqual(home.boardroom.seats().map((s) => s.post), ["chair", "secretary", "vice"]);
  await home.tick();
  assert.equal(home.events.ofType("board.elected").length, 1, "no new election while nothing changed");
  for (const id of ["bo", "cy", "di"]) home.inbox.addOrb(id, id.toUpperCase(), "tutor");
  await home.tick();
  assert.equal(home.events.ofType("board.elected").length, 2, "six orbs: five seats, elected again");
  assert.equal(home.boardroom.seats().length, 5);
  clock.suspend(ELECT_EVERY_MS);
  await home.tick();
  assert.equal(home.events.ofType("board.elected").length, 3, "and once a week");

  // a proposal: five members, three yes
  model.replies.push("YES — a small risk.", "NO — not yet.", "YES — good for the team.", "NO, too costly.", "YES — let's.");
  const p = await home.boardroom.propose("Open a Finance department this month", "founder");
  assert.equal(p.votes.length, 5, "every member votes");
  assert.deepEqual([p.votes.filter((v) => v.vote === "yes").length, p.carried], [3, true], "carried by a majority");
  assert.match(String(model.said[0]![0]!.content), /You sit on the board of Acme Orbs as its Chairperson[\s\S]*"Open a Finance department this month"[\s\S]*YES or NO first/);
  assert.equal(home.events.ofType("brain.spend").filter((e) => e.data.turn === "board").length, 5, "each vote's cost, the board's");
  assert.deepEqual(home.boardroom.decisions(), ["Open a Finance department this month"]);
  // rejected: not a decision
  model.replies.push("NO", "NO", "YES", "NO", "abstain please");
  const q = await home.boardroom.propose("Buy a ping-pong table", "founder");
  assert.equal(q.carried, false);
  assert.deepEqual(home.boardroom.decisions(), ["Open a Finance department this month"], "only what was carried");
  // every orb hears it
  home.inbox.send("ada", "chat:ada", "hi");
  await home.inbox.idle();
  assert.match(String(model.agent[0]![0]!.content), /The board has decided: "Open a Finance department this month"\./);
});

test("the door: the board, an election now, a proposal put and its votes as events", async (t) => {
  const { home, model } = await agentHome(t, []);
  home.inbox.letGo("juniper");
  for (const [id, sp] of [["max", "ceo"], ["pip", "assistant"], ["ada", "frontend"]] as const) home.inbox.addOrb(id, id, sp);
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.equal((await call("POST", "/board/election")).status, 200);
  const board = (await call("GET", "/board")).json as { size: number; seats: { orb: string; post: string }[] };
  assert.deepEqual([board.size, board.seats.map((s) => s.post)], [3, ["chair", "secretary", "vice"]]);
  model.replies.push("YES", "YES", "NO");
  assert.equal((await call("POST", "/board/proposals", { text: "Hire a CTO" })).status, 200);
  for (let i = 0; i < 50 && !home.events.ofType("board.decided").length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(home.events.ofType("board.decided")[0]!.data.carried, true);
  assert.equal((await call("POST", "/board/proposals", { text: "x".repeat(700) })).status, 400, "a proposal in a few lines");
});
