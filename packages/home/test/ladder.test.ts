// PLAN 1.4_t: three tiers behind one call, a fake server per brain tier. A tripped guard falls
// through and SAYS so; a cap hit mid-job stops cleanly. L.0 is the control: a habit that can
// answer does, with no brain call at all.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { FakeClock, realClock } from "../src/clock.ts";
import { TsHabit } from "../src/brain/habits.ts";
import { type LadderTask, NoBrainError, trimHistory } from "../src/brain/ladder.ts";
import { chat, type Endpoint } from "../src/brain/openai.ts";
import { ashRouter, BAKEOFF_DEFAULTS, oneKey, type Preset, PresetError } from "../src/brain/presets.ts";
import { SpendCapError } from "../src/brain/spend.ts";
import type { Runner } from "../src/inbox.ts";
import { deadUrl, fakeBrain, type Scripted } from "./fakes/openai.ts";
import { openHome, tempDir } from "./helpers.ts";

const ep = (name: string, baseUrl: string, more: Partial<Endpoint> = {}): Endpoint => ({ name, baseUrl, model: `${name}-model`, retries: 0, ...more });

async function setUp(t: TestContext, o: { own?: Scripted[] | "dead"; big?: Scripted[] | "dead"; cap?: number | null; earned?: string[]; clock?: FakeClock; runner?: Runner } = {}) {
  const own = o.own === "dead" ? null : await fakeBrain(t, o.own ?? [{ text: "OWN", litellmCost: 0.001 }]);
  const big = o.big === "dead" ? null : await fakeBrain(t, o.big ?? [{ text: "BIG", litellmCost: 0.01 }]);
  const preset: Preset = {
    id: "test",
    title: "test",
    own: ep("own", own?.baseUrl ?? (await deadUrl())),
    big: ep("big", big?.baseUrl ?? (await deadUrl())),
    teacher: null,
  };
  const earned = new Set(o.earned ?? []);
  const h = openHome(t, {
    brain: { preset, ownEarned: (k) => earned.has(k) },
    spendCapUsd: o.cap === undefined ? 1 : o.cap,
    ...(o.clock && { clock: o.clock }),
    ...(o.runner && { runner: o.runner }),
  });
  h.home.shelf.ship(
    new TsHabit("invoice", {
      guard: (i) => ((i as { currency?: string }).currency === "CAD" ? null : "only CAD invoices"),
      run: () => ({ total: 42 }),
    }),
  );
  return { ...h, own, big, ladder: h.home.ladder! };
}

const task = (kind: string, input?: unknown, more: Partial<LadderTask> = {}): LadderTask => ({
  kind, input, messages: [{ role: "user", content: `do the ${kind}` }], ...more,
});

test("L.0 CONTROL: a habit that can answer does, and no brain is called", async (t) => {
  const { ladder, own, big } = await setUp(t);
  const a = await ladder.ask(task("invoice", { currency: "CAD" }));
  assert.deepEqual([a.tier, a.output, a.said, a.costUsd], ["habit", { total: 42 }, null, 0]);
  assert.equal(own!.requests.length + big!.requests.length, 0);
});

test("L.1 a tripped guard falls through to the big brain and SAYS so", async (t) => {
  const { ladder, own, big, home } = await setUp(t);
  const a = await ladder.ask(task("invoice", { currency: "USD" }));
  assert.equal(a.tier, "big");
  assert.equal(a.output, "BIG");
  assert.deepEqual(a.fell[0], { tier: "habit", why: "its guard said no: only CAD invoices" });
  assert.equal(a.said, 'My "invoice" habit passed this one on (its guard said no: only CAD invoices), so the big brain answered.');
  assert.equal(own!.requests.length, 0, "the own brain has not earned invoices, so it is not asked");
  assert.equal(big!.requests.length, 1);
  const ev = home.events.ofType("ladder.answered").at(-1);
  assert.equal(ev?.data.said, a.said, "and it is in the event log for the chat to show");
});

test("control: a task with no habit at all goes up without an apology", async (t) => {
  const { ladder } = await setUp(t);
  const a = await ladder.ask(task("haiku"));
  assert.deepEqual([a.tier, a.said], ["big", null]);
  assert.equal(a.fell[0]?.why, 'no habit for "haiku" yet');
});

test("L.2 an earned own brain answers; a reply that is not an answer falls to the big brain, said", async (t) => {
  const { ladder, own, big } = await setUp(t, {
    own: [{ text: '{"items": 3}', litellmCost: 0.001 }, { text: "Sure! Here's a digest…", finish: "length" }],
    big: [{ text: '{"items": 4}', litellmCost: 0.01 }],
    earned: ["digest"],
  });
  const parse = (s: string): unknown => {
    const v = JSON.parse(s) as { items?: unknown };
    if (typeof v.items !== "number") throw new Error("missing key items");
    return v;
  };
  const first = await ladder.ask(task("digest", undefined, { parse }));
  assert.deepEqual([first.tier, first.output, first.said], ["own", { items: 3 }, null]);
  const second = await ladder.ask(task("digest", undefined, { parse }));
  assert.equal(second.tier, "big");
  assert.match(second.fell.find((f) => f.tier === "own")?.why ?? "", /own's reply is not an answer \(it was cut off at its length limit\)/);
  assert.match(second.said ?? "", /^My own brain passed this one on .*, so the big brain answered\.$/);
  assert.equal(own!.requests.length, 2);
  assert.equal(big!.requests.length, 1);
});

test("L.3 an own brain that is down falls through to the big brain, with the reason", async (t) => {
  const { ladder } = await setUp(t, { own: "dead", earned: ["digest"] });
  const a = await ladder.ask(task("digest"));
  assert.equal(a.tier, "big");
  assert.match(a.fell.find((f) => f.tier === "own")?.why ?? "", /^own: unreachable/);
});

test("L.4 when nothing can answer, the error carries every tier's reason; never a silent nothing", async (t) => {
  const { ladder, home } = await setUp(t, { own: "dead", big: "dead", earned: ["invoice"] });
  await assert.rejects(ladder.ask(task("invoice", { currency: "EUR" })), (e: Error) => {
    assert.ok(e instanceof NoBrainError);
    assert.deepEqual(e.fell.map((f) => f.tier), ["habit", "own", "big"]);
    return true;
  });
  assert.equal(home.events.ofType("ladder.failed").length, 1);
});

test("L.5 cost: what the provider reports, else the price table (marked), else unknown (warned once)", async (t) => {
  const header = await fakeBrain(t, [{ litellmCost: 0.0123 }]);
  const body = await fakeBrain(t, [{ usageCost: 0.0456 }]);
  const priced = await fakeBrain(t, [{ promptTokens: 1_000_000, completionTokens: 500_000 }]);
  const silent = await fakeBrain(t, [{}]);
  const m = [{ role: "user" as const, content: "hi" }];
  const a = await chat(ep("a", header.baseUrl), m);
  const b = await chat(ep("b", body.baseUrl), m);
  const c = await chat(ep("c", priced.baseUrl, { price: { inputPerM: 0.1, outputPerM: 0.4 } }), m);
  const d = await chat(ep("d", silent.baseUrl), m);
  assert.deepEqual([a.costUsd, a.costSource], [0.0123, "reported"]);
  assert.deepEqual([b.costUsd, b.costSource], [0.0456, "reported"]);
  assert.equal(c.costSource, "price-table");
  assert.ok(Math.abs(c.costUsd! - 0.3) < 1e-12, `1M in at $0.10 + 0.5M out at $0.40 = $0.30 (${c.costUsd})`);
  assert.deepEqual([d.costUsd, d.costSource], [null, "unknown"]);

  const { home } = await setUp(t, { big: [{}] });
  await home.ladder!.ask(task("haiku"));
  await home.ladder!.ask(task("haiku"));
  const warns = home.events.ofType("notify").filter((e) => /reports no cost/.test(String(e.data.text)));
  assert.equal(warns.length, 1, "an uncountable brain is named once, not on every call");
});

test("L.6 a cap hit mid-job stops the job cleanly, says so, and spends nothing more", async (t) => {
  const clock = new FakeClock("2026-10-01T15:00:00Z");
  let ladderRef: NonNullable<Awaited<ReturnType<typeof setUp>>["ladder"]> | null = null;
  let steps = 0;
  const runner: Runner = {
    async run(ctx) {
      for (let i = 0; i < 5; i++) {
        ctx.activity(`step ${i + 1} of 5`);
        await ladderRef!.ask({ ...task("job"), orb: ctx.orb, conversation: ctx.conversation });
        steps++;
      }
      return { summary: "all five steps" };
    },
  };
  const { home, big, ladder } = await setUp(t, { big: [{ text: "done", litellmCost: 0.3 }], cap: 1, clock, runner });
  ladderRef = ladder;
  home.inbox.addOrb("juniper", "Juniper");
  home.inbox.send("juniper", "chat:1", "do the five-step job");
  await home.inbox.idle();

  assert.equal(big!.requests.length, 4, "$0.90 spent is under $1, so the 4th call runs; the 5th is never made");
  assert.equal(steps, 4);
  const end = home.events.ofType("run.finished").at(-1)!;
  assert.equal(end.data.outcome, "capped", "a cap is an outcome of its own, not an error");
  assert.equal(end.data.error, undefined);
  assert.ok(Math.abs(Number(end.data.spent_usd) - 1.2) < 1e-9 && end.data.cap_usd === 1);
  assert.match(String(home.events.ofType("notify").at(-1)?.data.text), /^Juniper stopped: today's spend cap is reached: \$1\.2000 of \$1\.00\.$/);
  assert.equal(home.inbox.orb("juniper")?.status, "idle");

  await assert.rejects(ladder.ask(task("job")), SpendCapError, "the next call is refused before it is made");
  assert.equal(big!.requests.length, 4);
  home.loops.define({ name: "practice", sense: () => ({ prompt: "go" }), run: async () => ({ outcome: "ok" }) });
  assert.match((await home.loops.run("practice")).note ?? "", /spend cap/, "the night's loops stand down too");

  await clock.advance(10 * 60 * 60_000); // past midnight UTC: a new day's allowance
  assert.equal((await ladder.ask(task("job"))).tier, "big");
});

test("control: with no cap set, the same job runs to the end", async (t) => {
  let ladderRef: NonNullable<Awaited<ReturnType<typeof setUp>>["ladder"]> | null = null;
  const runner: Runner = {
    async run() {
      for (let i = 0; i < 5; i++) await ladderRef!.ask(task("job"));
      return {};
    },
  };
  const { home, big, ladder } = await setUp(t, { big: [{ litellmCost: 0.3 }], cap: null, runner });
  ladderRef = ladder;
  home.inbox.addOrb("juniper", "Juniper");
  home.inbox.send("juniper", "chat:1", "go");
  await home.inbox.idle();
  assert.equal(big!.requests.length, 5);
  assert.equal(home.events.ofType("run.finished").at(-1)?.data.outcome, "ok");
});

test("L.7 the home keeps the history and sends it trimmed to a budget", () => {
  const sys = { role: "system" as const, content: "You are Juniper." };
  const turns = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn ${i} `.repeat(40) }));
  const { messages, dropped } = trimHistory([sys, ...turns], 600);
  assert.equal(messages[0], sys, "the system prompt always stays");
  assert.ok(dropped > 0 && dropped < 20);
  assert.match(messages[1]!.content, new RegExp(`^\\(${dropped} earlier messages are not shown`));
  assert.equal(messages.at(-1), turns.at(-1), "the newest turn always stays");
  const est = messages.reduce((n, m) => n + Math.ceil(m.content.length / 4) + 4, 0);
  assert.ok(est <= 600 + 30, `within the budget (${est})`);
  const huge = trimHistory([sys, { role: "user", content: "x".repeat(10_000) }], 100);
  assert.equal(huge.messages.length, 2, "even an over-long last message is sent, never dropped");
});

test("L.8 presets: the router preset comes from the bake-off file, free seats only, fallbacks off", async (t) => {
  const real = ashRouter();
  assert.equal(real.big?.model, "bedrock-brain");
  assert.equal(real.teacher?.model, "nim-ultra");
  assert.equal(real.own?.model, "free-flash");
  assert.ok(BAKEOFF_DEFAULTS.endsWith("docs/bakeoff-defaults.json"));

  const dir = tempDir(t);
  const paid = join(dir, "paid.json");
  writeFileSync(paid, JSON.stringify({ big: { seat: "claude-opus-paid" } }));
  assert.throws(() => ashRouter({ defaultsFile: paid }), PresetError, "a seat not known to be free is refused");

  const fb = await fakeBrain(t, [{ litellmCost: 0 }]);
  const p = ashRouter({ baseUrl: fb.baseUrl });
  await chat({ ...p.big!, retries: 0 }, [{ role: "user", content: "hi" }]);
  assert.equal(fb.requests[0]?.body.disable_fallbacks, true, "a router chain can end on a paid seat; it is switched off");

  const key = oneKey({ baseUrl: fb.baseUrl, apiKey: "sk-test-123", big: "big-m" });
  assert.equal(key.own?.model, "big-m", "one key, one model, until a cheaper own model is named");
  await chat({ ...key.big!, retries: 0 }, [{ role: "user", content: "hi" }]);
  assert.equal(fb.requests[1]?.auth, "Bearer sk-test-123");
});

test("L.9 a compiled Python habit answers through the kit, and falls through with its reason", async (t) => {
  const big = await fakeBrain(t, [{ text: "BIG" }]);
  const { home } = openHome(t, {
    clock: realClock as unknown as FakeClock,
    kit: true,
    brain: { preset: { id: "t", title: "t", own: null, big: ep("big", big.baseUrl), teacher: null } },
  });
  await home.kit!.start();
  const code = 'def guard(i):\n    return None\n\ndef run(i):\n    return {"total": sum(l["qty"] * l["price"] for l in i["lines"])}\n';
  const approved = Array.from({ length: 12 }, (_, n) => ({
    input: { client: `Client ${n}`, lines: [{ qty: n + 1, price: 2 }] },
    output: { total: (n + 1) * 2 },
  }));
  await home.kit!.call("habit_learn", { habit_dir: join(home.shelf.dir, "quote"), code, approved });

  const a = await home.ladder!.ask(task("quote", { client: "Client 50", lines: [{ qty: 5, price: 2 }] }));
  const sandboxed = a.tier === "habit";
  if (sandboxed) {
    assert.deepEqual(a.output, { total: 10 });
    assert.equal(big.requests.length, 0);
  } else {
    assert.match(a.fell[0]!.why, /no habit sandbox/, "without a sandbox it does not run, and says why");
  }
  const b = await home.ladder!.ask(task("quote", { client: "Client 51", lines: [{ qty: 1, price: 2 }], rush: true }));
  assert.equal(b.tier, "big");
  assert.match(b.said ?? "", sandboxed ? /habit passed this one on \(unfamiliar input: unknown key\(s\) \['rush'\]/ : /no habit sandbox/);
});

