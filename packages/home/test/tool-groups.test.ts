// Tools by kind (owner, 10-07: "we also want to see where we can cut token use but also keep the same functions so to
// say, and consistency without centralizing everything either"; of tools by department and trimming: "do both"):
//   - an orb starts a run with the shared tools and its department's kinds; an all-rounder with every kind (control);
//     a Tutor's request carries no computer-less savings by accident: what it lacks is said in more_tools;
//   - more_tools loads a kind for the rest of the run, and stops offering it; a kind it never loaded still runs when
//     called by name (nothing taken away);
//   - a session's turn has the plans and the team; a kind used before in the conversation stays loaded;
//   - every grouped tool's kind is one of GROUPS, every kind's departments real ones, every kind has tools.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUPS, startingGroups } from "../src/agent/groups.ts";
import { SPECIALTY_FAMILIES } from "../src/brain/constitution.ts";
import { agentHome } from "./helpers.ts";

type Spec = { function?: { name: string; description: string; parameters: { properties?: { group?: { enum?: string[] } } } } };
const names = (body: Record<string, unknown>): string[] => ((body.tools ?? []) as Spec[]).map((t) => t.function!.name);
const more = (body: Record<string, unknown>): Spec["function"] | undefined => ((body.tools ?? []) as Spec[]).map((t) => t.function!).find((f) => f.name === "more_tools");

test("an orb starts with the shared tools and its department's; an all-rounder with all; what it lacks, more_tools names", async (t) => {
  const { home, model } = await agentHome(t, [{ chunks: ["ok"] }, { chunks: ["ok"] }]);
  home.inbox.addOrb("tia", "Tia", "tutor"); // Life: the day and the computer
  home.inbox.send("tia", "chat:tia", "hi");
  await home.inbox.idle();
  home.inbox.send("juniper", "chat:juniper", "hi"); // an all-rounder
  await home.inbox.idle();
  const [tia, all] = [names(model.bodies[0]!), names(model.bodies[1]!)];
  for (const n of ["shell", "read_file", "web_search", "web_fetch", "ask_orb", "ask_owner", "propose_lesson", "teach"]) assert.ok(tia.includes(n), `shared: ${n}`);
  for (const n of ["remind", "schedule_job", "open_page", "check_page"]) assert.ok(tia.includes(n), `Life's: ${n}`);
  for (const n of ["follow_source", "propose_plan", "start_row", "claim_rows", "who_fits"]) assert.ok(!tia.includes(n), `not to hand: ${n}`);
  assert.deepEqual(more(model.bodies[0]!)!.parameters.properties!.group!.enum!.sort(), ["desk", "plans", "quant", "reading", "reverse", "risk", "sheets", "team", "trace"], "every kind it lacks, the reverse engineer's and the desk's too, its research, its risk and its investigations, spreadsheets (PLAN 4.8, 4.9, 5.25, 5.40, 5.42)");
  assert.match(more(model.bodies[0]!)!.description, /reading: the office's reading library/);
  assert.ok(!all.includes("more_tools") && ["follow_source", "propose_plan", "claim_rows", "open_page", "remind"].every((n) => all.includes(n)), "control: an all-rounder has every kind, and no more_tools");
  const size = (b: Record<string, unknown>): number => JSON.stringify(b.tools).length;
  assert.ok(size(model.bodies[0]!) < size(model.bodies[1]!) * 0.75, `a Tutor's tools are lighter (${size(model.bodies[0]!)} of ${size(model.bodies[1]!)} characters)`);
});

test("more_tools loads a kind for the rest of the run; a kind it never loaded still runs when called by name", async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "more_tools", args: { group: "reading" } }] },
    { calls: [{ name: "list_reading", args: {} }] },
    { chunks: ["done"] },
    { calls: [{ name: "who_fits", args: { plan: 1, row: "1.1" } }] }, // the team's, never loaded
    { chunks: ["ok"] },
  ]);
  home.inbox.addOrb("tia", "Tia", "tutor");
  home.inbox.send("tia", "chat:tia", "what do we follow?");
  await home.inbox.idle();
  assert.ok(!names(model.bodies[0]!).includes("list_reading"));
  assert.ok(names(model.bodies[1]!).includes("list_reading") && names(model.bodies[1]!).includes("follow_source"), "loaded from the next step");
  assert.ok(!more(model.bodies[1]!)!.parameters.properties!.group!.enum!.includes("reading"), "and no longer offered");
  const loaded = home.conversations.history("chat:tia").find((m) => m.role === "tool" && /Loaded reading/.test(m.content));
  assert.match(loaded!.content, /Loaded reading: .*follow_source.*list_reading/);
  // a new run in the same conversation: the kind it used stays loaded
  home.inbox.send("tia", "chat:tia", "who fits row 1.1?");
  await home.inbox.idle();
  assert.ok(names(model.bodies[3]!).includes("list_reading"), "a kind used before in the conversation stays to hand");
  const fits = home.conversations.history("chat:tia").filter((m) => m.role === "tool").at(-1)!;
  assert.doesNotMatch(fits.content, /There is no tool called/, "called by name, it ran: nothing is taken away");
});

test("a session's turn has the plans and the team; the kinds are consistent", () => {
  assert.deepEqual([...startingGroups({ family: "life", specialty: "tutor", session: true })].sort(), ["computer", "day", "plans", "team"]);
  assert.deepEqual([...startingGroups({ family: "life", specialty: "tutor", session: false })].sort(), ["computer", "day"]);
  assert.equal(startingGroups({ family: "build", specialty: "general", session: false }).size, Object.keys(GROUPS).length, "an all-rounder: every kind");
  const families = new Set(Object.values(SPECIALTY_FAMILIES) as string[]);
  for (const g of Object.values(GROUPS)) {
    assert.ok(g.families.every((f) => families.has(f)), `${g.id}: its departments are real ones (${g.families})`);
    assert.ok(g.about.length > 20, `${g.id}: says what it is for`);
  }
  for (const f of families) assert.ok(startingGroups({ family: f, specialty: null, session: false }).size < Object.keys(GROUPS).length || f === "exec", `${f}: starts without some kind`);
  // the desk's research and its risk start with the jobs that use them (PLAN 5.40); the rest of the desk loads them
  const start = (specialty: string): string[] => [...startingGroups({ family: "desk", specialty, session: false })].sort();
  assert.deepEqual([start("quant"), start("quantres"), start("quantdev")], [["desk", "quant"], ["desk", "quant"], ["desk", "quant"]]);
  assert.deepEqual([start("risk"), start("riskanalyst")], [["desk", "risk"], ["desk", "risk"]]);
  // the investigations (PLAN 5.42): the on-chain job's and its head's
  assert.deepEqual([start("deskhead"), start("dealer"), start("onchain")], [["desk", "quant", "risk", "trace"], ["desk"], ["desk", "trace"]]);
});
