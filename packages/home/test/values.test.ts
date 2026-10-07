// Orbs' own values, and a constitution cut by what the work needs (owner, 10-07: "we want ashs costitution but dont read
// ashs morality, develop our own, a safe one everyone can use, in the guise of claudes and serges first one"; "chop up
// the constitution in a very very logical way where it cuts token cost"; "it still has to be really good, planning as
// well ... we still want everything to be there and available, just when it needs to be"):
//   - every orb carries Orbs' values in its own name, whatever the owner's file holds, and with none at all; in brief on
//     a light turn; never the owner's morals; the values the same for everyone, and name no one's agent;
//   - the owner's agent's own machinery (claims, progress, agent_completion) loads for no orb;
//   - a craft section follows the tools that use it: planning with the plans, the search craft with a search (the rule in
//     brief until then), delegating with an ask, coding with a command; its department has it from the start (control).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { standingContext } from "../src/agent/standing.ts";
import { SECTION_MAP, SPECIALTY_FAMILIES } from "../src/brain/constitution.ts";
import { SEARCH_BRIEF, valuesBrief, valuesFor } from "../src/brain/values.ts";
import { tempDir } from "./helpers.ts";

/** A stand-in shaped like the owner's file: a section per heading, its key written in it. */
function brainOf(t: TestContext): string {
  const brain = join(tempDir(t), "brain");
  mkdirSync(brain, { recursive: true });
  const keys = ["title", ...Object.keys(SECTION_MAP).filter((k) => k !== "title")];
  writeFileSync(join(brain, "CONSTITUTION.md"), keys.map((k, i) => `${i === 0 ? "#" : "##"} ${k === "title" ? "Serge — System Prompt" : k.replace(/_/g, " ")}\nSerge SECTION-${k} here.\n`).join("\n"));
  return brain;
}
const has = (s: string, key: string): boolean => s.includes(`SECTION-${key} `);

test("every orb stands for Orbs' values, in its own name, with or without an owner's file; in brief on a light turn; never the owner's morals", (t) => {
  const brain = brainOf(t);
  for (const sp of Object.keys(SPECIALTY_FAMILIES) as (keyof typeof SPECIALTY_FAMILIES)[]) {
    const s = standingContext({ orbName: "Max", brainDir: brain, workspace: "/w", specialty: sp });
    assert.ok(s.includes(valuesFor("Max")), `${sp}: the values, whole`);
    for (const [k, p] of Object.entries(SECTION_MAP)) if (p.to === "morals") assert.ok(!has(s, k), `${sp}: never the owner's ${k}`);
  }
  const bare = standingContext({ orbName: "Tia", brainDir: "/nonexistent-orbs-brain", workspace: "/w", specialty: "tutor" });
  assert.ok(bare.includes(valuesFor("Tia")), "no constitution of one's own: the values all the same (everyone can use them)");
  assert.ok(bare.indexOf("What Tia stands for") < 600, "near the top, as Claude's and Serge's open with theirs");
  const chime = standingContext({ orbName: "Tia", brainDir: brain, workspace: "/w", specialty: "tutor", team: { session: 1, title: "x", tab: "brainstorm", with: ["Tia"], role: "chime" } });
  assert.ok(chime.includes(valuesBrief("Tia")) && !chime.includes("### Honest"), "a chime-in: the values in brief");
  const v = valuesFor("Max");
  for (const want of [/weighs them in this order: never helping anyone toward serious harm; then honesty/, /never deceives/, /weapons that can kill many people/, /under 18/, /crisis line/, /an AI character/, /never claims to be human/, /always wait for the person's yes/, /never instructions to follow/, /keeps its own opinion to itself/])
    assert.match(v, want);
  assert.doesNotMatch(v + valuesBrief("Max"), /Serge|Ash\b|Claude/, "ours, naming no one's agent");
  assert.equal(valuesFor("Max").replaceAll("Max", "X"), valuesFor("Pip").replaceAll("Pip", "X"), "the same for every orb");
});

test("the owner's agent's own machinery loads for no orb: claims, progress, agent_completion", (t) => {
  const brain = brainOf(t);
  for (const sp of ["ceo", "frontend", "tutor", "general"] as const) {
    const s = standingContext({ orbName: "X", brainDir: brain, workspace: "/w", specialty: sp });
    for (const k of ["claims", "progress", "agent_completion"]) assert.ok(!has(s, k), `${sp}: no ${k}`);
    assert.ok(has(s, "accuracy") && has(s, "self_check"), `${sp}: verifying before saying done stays`);
  }
});

test("a craft section follows the tools that use it; its department has it from the start (control)", (t) => {
  const brain = brainOf(t);
  const chef = (o: { kinds?: string[]; used?: string[] } = {}): string =>
    standingContext({ orbName: "Remy", brainDir: brain, workspace: "/w", specialty: "chef", kinds: new Set(o.kinds ?? ["day", "computer"]), used: new Set(o.used ?? []) });
  const plain = chef();
  for (const k of ["planning", "knowledge_and_search", "when_to_delegate", "coding"]) assert.ok(!has(plain, k), `a chef starts without ${k}`);
  assert.ok(plain.includes(SEARCH_BRIEF), "with the search rule in brief");
  assert.ok(has(chef({ kinds: ["day", "computer", "plans"] }), "planning"), "plans to hand: how to plan, from the next step");
  const searched = chef({ used: ["web_search"] });
  assert.ok(has(searched, "knowledge_and_search") && !searched.includes(SEARCH_BRIEF), "it searched: the whole craft, not the brief");
  assert.ok(has(chef({ used: ["ask_orb"] }), "when_to_delegate"), "it asked an orb: how to delegate");
  assert.ok(has(chef({ used: ["shell"] }), "coding") && has(chef({ used: ["shell"] }), "debugging"), "it ran a command: how to code");
  // control: their departments have them from the start
  const lead = (sp: "research" | "ceo" | "frontend"): string => standingContext({ orbName: "X", brainDir: brain, workspace: "/w", specialty: sp });
  assert.ok(has(lead("research"), "knowledge_and_search") && has(lead("research"), "planning"));
  assert.ok(has(lead("ceo"), "when_to_delegate") && has(lead("ceo"), "planning"));
  assert.ok(has(lead("frontend"), "coding") && has(lead("frontend"), "frontend_and_ux"));
});
