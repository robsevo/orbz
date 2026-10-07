// PLAN 3.9_t, each orb's own constitution, on a stand-in shaped like the owner's file (never the
// file itself): every section is placed (the core, a specialty's, morals, replaced); a heading in
// a fenced example is not a section; a planted new section is a gap the check names; an orb loads
// the core and his specialty's sections and nothing else, in his own name; a line the person
// approved reaches that orb only, and taking it back removes it; and the owner's file is never
// written. (That the home's roster is the app's, family for family, is the app's test: roster.test.ts.)
// The fundamental analyst (owner, 10-07) carries the money and reasoning sections and how to read the books;
// no other orb does, nor a chime-in, and asked by another orb it reads as one.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { composeConstitution, coverage, parseSections, SECTION_MAP, SPECIALTY_FAMILIES } from "../src/brain/constitution.ts";
import { standingContext } from "../src/agent/standing.ts";
import { text } from "./fakes/model.ts";
import { agentHome } from "./helpers.ts";

/** A stand-in with every mapped heading, each section carrying a marker named for it. */
function standIn(extra = ""): string {
  const lines: string[] = ["# Serge — a stand-in", "MARK-title Serge weighs honesty first."];
  for (const key of Object.keys(SECTION_MAP)) {
    if (key === "title") continue;
    lines.push(`### ${key}`, `MARK-${key} Serge does the ${key} thing.`);
    // the planning section shows a plan, with its own heading, in a fence
    if (key === "planning") lines.push("```", "## PHASE 1 — An example plan", "| # | Feature |", "```");
  }
  return lines.join("\n") + extra;
}
const marks = (s: string): string[] => [...s.matchAll(/MARK-([a-z_]+)/g)].map((m) => m[1]!);

test("every section has a place; a heading in a fenced example is not a section; a planted new one is a gap", () => {
  const file = standIn();
  assert.deepEqual(coverage(file), { unplaced: [], stale: [] });
  assert.ok(!parseSections(file).some((s) => /PHASE 1/.test(s.title)), "the example plan's heading stays inside planning");
  const planted = standIn("\n### moon_landings\nMARK-moon_landings Serge talks about the moon.\n");
  assert.deepEqual(coverage(planted).unplaced, ["moon_landings"], "a new section the map does not place is named");
  assert.ok(marks(composeConstitution({ owner: planted, specialty: "coach", orbName: "R" })).includes("moon_landings"), "and, until it is placed, everyone loads it: never a silent drop");
  assert.deepEqual(coverage(standIn().replace(/### claims\n.*\n?/, "")).stale, ["claims"], "and a mapped one that left the file");
});

test("an orb loads the core and his specialty's sections, nothing else, in his own name", () => {
  const file = standIn();
  const core = Object.entries(SECTION_MAP).filter(([, p]) => p.to === "core").map(([k]) => k);
  const coach = marks(composeConstitution({ owner: file, specialty: "coach", orbName: "Rosie" }));
  for (const k of core) assert.ok(coach.includes(k), `the coach has the core's ${k}`);
  assert.ok(coach.includes("user_wellbeing"), "and the wellbeing a coach needs");
  assert.ok(!coach.includes("frontend_and_ux") && !coach.includes("financial_advice") && !coach.includes("engineering"), "not a builder's or an accountant's");
  const accountant = marks(composeConstitution({ owner: file, specialty: "accountant", orbName: "Ada" }));
  assert.ok(accountant.includes("financial_advice") && !accountant.includes("frontend_and_ux"));
  const frontend = marks(composeConstitution({ owner: file, specialty: "frontend", orbName: "Daisy" }));
  assert.ok(frontend.includes("frontend_and_ux") && frontend.includes("engineering") && !frontend.includes("financial_advice"));
  // morals are out for everyone, and so is what Orbs replaces with its own
  for (const sp of Object.keys(SPECIALTY_FAMILIES) as (keyof typeof SPECIALTY_FAMILIES)[]) {
    const got = marks(composeConstitution({ owner: file, specialty: sp, orbName: "X" }));
    for (const [k, p] of Object.entries(SECTION_MAP)) {
      if (p.to === "morals" || p.to === "replaced") assert.ok(!got.includes(k), `${sp} loaded ${k} (${p.to})`);
    }
  }
  const text = composeConstitution({ owner: file, specialty: "coach", orbName: "Rosie" });
  assert.doesNotMatch(text, /\bSerge\b/, "the owner's agent's name is gone");
  assert.match(text, /Rosie does the communication thing/, "it is his");
  assert.ok(text.length < file.length / 2, `the coach's is a fraction of the whole (${text.length} of ${file.length})`);
});

test("a run's standing context is his: the core and his specialty's sections, then what the person approved for him", async (t) => {
  const { home, model, dataDir } = await agentHome(t, [{ chunks: ["ok"] }, { chunks: ["ok"] }]);
  mkdirSync(join(dataDir, "brain"), { recursive: true });
  const ownerFile = join(dataDir, "brain", "CONSTITUTION.md");
  writeFileSync(ownerFile, standIn());
  const before = createHash("sha256").update(readFileSync(ownerFile)).digest("hex");
  home.inbox.addOrb("ada", "Ada", "accountant");
  home.inbox.addOrb("cal", "Cal", "trainer");
  home.learned.add("ada", "The person's rent is due on the 1st; remind them on the 28th.");
  home.inbox.send("ada", "chat:ada", "what's due?");
  home.inbox.send("cal", "chat:cal", "plan my week");
  await home.inbox.idle();
  const [ada, cal] = model.agent.map((m) => text(m));
  assert.match(ada!, /MARK-financial_advice/);
  assert.doesNotMatch(ada!, /MARK-refusal_handling|MARK-values|MARK-evenhandedness/, "morals left out");
  assert.match(ada!, /rent is due on the 1st/, "what Ada learned is in Ada's");
  assert.match(cal!, /MARK-user_wellbeing/);
  assert.doesNotMatch(cal!, /rent is due/, "and in no one else's");
  assert.doesNotMatch(cal!, /MARK-financial_advice/);
  assert.equal(createHash("sha256").update(readFileSync(ownerFile)).digest("hex"), before, "the owner's file is never written");
});

test("only the person adds a line (the door), and taking it back removes it", async (t) => {
  const { home, dataDir } = await agentHome(t, []);
  mkdirSync(join(dataDir, "brain"), { recursive: true });
  writeFileSync(join(dataDir, "brain", "CONSTITUTION.md"), standIn());
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.equal((await call("POST", "/orbs", { id: "theo", name: "Theo", specialty: "data" })).status, 200);
  assert.equal((await call("POST", "/orbs", { id: "bad", name: "Bad", specialty: "astronaut" })).status, 400, "only specialties there are");
  await call("POST", "/orbs/theo/learned", { line: "Charts start at zero." });
  await call("POST", "/orbs/theo/learned", { line: "The person reads on a phone." });
  let c = (await call("GET", "/orbs/theo/constitution")).json.constitution as string;
  assert.match(c, /Charts start at zero\.[\s\S]*The person reads on a phone\./);
  assert.match(c, /Theo does the engineering thing/, "his specialty's, in his name");
  await call("DELETE", "/orbs/theo/learned/0");
  c = (await call("GET", "/orbs/theo/constitution")).json.constitution as string;
  assert.doesNotMatch(c, /Charts start at zero/, "taken back");
  assert.match(c, /reads on a phone/);
  assert.deepEqual(home.events.since(0, 1000).filter((e) => e.orb === "theo" && e.type.startsWith("orb.")).map((e) => e.type), ["orb.added", "orb.learned", "orb.learned", "orb.unlearned"]);
  // no tool lets a model write it: the only writer is the door
  assert.ok(!home.agent || !JSON.stringify(home.agent).includes("learned"), "control: the agent holds no learned writer");
});

test("the fundamental analyst: the money and reasoning sections, and how to read the books; no other orb, nor a chime-in; asked, it reads as one", () => {
  const file = standIn();
  const text = composeConstitution({ owner: file, specialty: "fundamentals", orbName: "Mike" });
  const got = marks(text);
  for (const k of ["financial_advice", "critical_thinking", "reasoning_method", "reasoning_before_acting", "synthesizing_results"]) assert.ok(got.includes(k), `it has ${k}`);
  assert.ok(!got.includes("frontend_and_ux") && !got.includes("user_wellbeing"), "not a builder's or a coach's");
  assert.match(text, /\n## How you read the books\n/);
  assert.match(text, /operating cash flow[\s\S]*Beneish[\s\S]*what would prove you wrong[\s\S]*Never tell the person to buy, sell or short/);
  assert.match(text, /## How you research/, "and it researches, as the researchers do");
  // controls: the other money orbs, and a chime-in
  for (const sp of ["investor", "crypto", "analyst", "accountant", "frontend"] as const) assert.doesNotMatch(composeConstitution({ owner: file, specialty: sp, orbName: "X" }), /How you read the books/, sp);
  assert.doesNotMatch(composeConstitution({ owner: file, specialty: "fundamentals", orbName: "Mike", mini: true }), /How you read the books/, "a chime-in carries the mini cut only");
  // asked by another orb (the light brain, no owner's file): it still reads the books as it should
  const turn = (role: "asked" | "chime") => standingContext({ orbName: "Mike", brainDir: "/nonexistent-orbs-brain", workspace: "/tmp", specialty: "fundamentals", team: { session: 1, title: "Q3", tab: "brainstorm", with: ["Mike", "Ada"], role } });
  assert.match(turn("asked"), /## How you read the books/);
  assert.doesNotMatch(turn("chime"), /How you read the books/, "control: a chime-in is a line or three");
});
