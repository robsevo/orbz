// Ash's engine test `context-survival`, ported (PLAN 1.5_t): the standing context — the owner's
// constitution, the skills index, the memory index — reaches the model on the first request and
// survives compaction, /clear and a restart, exactly once each time. It drives the REAL loop
// against a scripted model and reads the exact messages the model was sent. The owner's brain
// here is a stand-in with a marker in each part (CLAUDE.md rule 6: tests never use the real one).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { text } from "./fakes/model.ts";
import { agentHome, tempDir } from "./helpers.ts";

function brain(dataDir: string): void {
  const b = join(dataDir, "brain");
  mkdirSync(join(b, "skills", "demo"), { recursive: true });
  mkdirSync(join(b, "memory"), { recursive: true });
  writeFileSync(join(b, "CONSTITUTION.md"), `# Doctrine\nDOCTRINE-MARKER: finish the work before reporting it.\n${"Rule text. ".repeat(200)}`);
  writeFileSync(join(b, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: SKILL-MARKER a demo skill\n---\nbody\n");
  writeFileSync(join(b, "memory", "MEMORY.md"), "- [A fact](fact.md) — MEMORY-MARKER\n");
}

const count = (msgs: Record<string, unknown>[], marker: string): number => text(msgs).split(marker).length - 1;
const MARKERS = ["DOCTRINE-MARKER", "SKILL-MARKER", "MEMORY-MARKER"];
const once = (msgs: Record<string, unknown>[]): boolean => MARKERS.every((m) => count(msgs, m) === 1);

async function survivor(t: TestContext, dataDir = tempDir(t)) {
  brain(dataDir);
  const turns = Array.from({ length: 40 }, () => ({ chunks: ["ok"] }));
  // 3,000 till 10-07; Orbs' own values (brain/values.ts) put some 700 tokens more in every standing context
  return agentHome(t, turns, { dataDir, agent: { compactAtTokens: 3700, keepRecentTokens: 1200 } });
}

const talk = async (home: Awaited<ReturnType<typeof survivor>>["home"], n: number, from = 0): Promise<void> => {
  for (let i = from; i < from + n; i++) {
    home.inbox.send("juniper", "chat:1", `turn ${i}: ${"words ".repeat(300)}`);
    await home.inbox.idle();
  }
};

test("the standing context reaches the first request, once", async (t) => {
  const { home, model } = await survivor(t);
  await talk(home, 1);
  assert.equal(model.agent[0]![0]!.role, "system");
  assert.ok(once(model.agent[0]!), "constitution, skills index and memory index, each exactly once");
});

test("it survives compaction: the summary stands in for the old turns, the standing context stays, once", async (t) => {
  const { home, model } = await survivor(t);
  await talk(home, 6);
  assert.ok(model.summaries >= 1, `compaction ran (the summariser was called ${model.summaries} times)`);
  const after = model.agent.at(-1)!;
  assert.ok(text(after).includes("SUMMARY-OF-MIDDLE"), "the summary is in the request after compaction");
  assert.ok(once(after), "THE CONSTITUTION, the skills and the memory survive compaction, not duplicated");
  assert.ok(!text(after).includes("turn 0:"), "the oldest turn is gone, summarised");
  assert.ok(text(after).includes("turn 5:"), "the newest turn is kept as it was");
  assert.equal(after[0]!.role, "system");
});

test("many compactions never pile up: at most one whole summary and the parts since, the standing context once, after all of it", async (t) => {
  const { MAX_PARTS } = await import("../src/agent/loop.ts");
  const { home, model } = await survivor(t);
  await talk(home, 14);
  assert.ok(model.summaries >= 3, `three compactions happened (${model.summaries})`);
  for (const req of model.agent) assert.ok(count(req, "SUMMARY-OF-MIDDLE") <= 1 + MAX_PARTS, "never more than one whole and its parts");
  assert.ok(once(model.agent.at(-1)!));
});

test("/clear starts fresh: the history is gone, the standing context is back", async (t) => {
  const { home, model } = await survivor(t);
  await talk(home, 6);
  home.inbox.send("juniper", "chat:1", "/clear");
  await home.inbox.idle();
  await talk(home, 1, 100);
  const cleared = model.agent.at(-1)!;
  assert.ok(once(cleared), "the constitution is back after /clear, once");
  assert.ok(/Working directory:/.test(text(cleared)), "and the working directory line");
  assert.ok(!text(cleared).includes("turn 0:") && !text(cleared).includes("SUMMARY-OF-MIDDLE"), "and the history really is gone");
  assert.deepEqual(cleared.filter((m) => m.role === "user").map((m) => String(m.content).slice(0, 9)), ["turn 100:"]);
});

test("after a restart the conversation resumes with the standing context BEFORE it, once", async (t) => {
  const dataDir = tempDir(t);
  const first = await survivor(t, dataDir);
  await talk(first.home, 2);
  await first.home.close();
  const second = await survivor(t, dataDir);
  await talk(second.home, 1, 2);
  const req = second.model.agent[0]!;
  const doctrine = req.findIndex((m) => String(m.content).includes("DOCTRINE-MARKER"));
  const firstUser = req.findIndex((m) => m.role === "user");
  assert.ok(doctrine >= 0 && doctrine < firstUser, "the constitution sits before the replayed conversation");
  assert.ok(text(req).includes("turn 0:"), "the conversation from before the restart is there");
  assert.ok(once(req));
});

test("condensing goes a part at a time: three parts, each its summariser reading only that part, then one whole summary folds them; never more than four sent", async (t) => {
  const { MAX_PARTS } = await import("../src/agent/loop.ts");
  const { home, model } = await survivor(t);
  const compacted = () => home.events.ofType("conversation.compacted").map((e) => (e.data.section ? `part ${e.data.section}` : "whole"));
  let i = 0;
  while (compacted().length < MAX_PARTS + 1 && i < 40) await talk(home, 1, i++);
  assert.deepEqual(compacted().slice(0, MAX_PARTS + 1), ["part 1", "part 2", "part 3", "whole"], "the parts first, then one whole summary");
  const first = String(model.said[0]![0]!.content);
  assert.match(first, /^Summarise this part of an earlier conversation/);
  assert.ok(first.includes("turn 0:"), "the first part is the oldest");
  assert.ok(!first.includes(`turn ${i - 2}:`), "and not the newest: the summariser reads a part, not everything");
  const fold = String(model.said[MAX_PARTS]![0]!.content);
  assert.match(fold, /^Summarise this conversation so far/);
  assert.equal(fold.split("SUMMARY-OF-MIDDLE").length - 1, MAX_PARTS, "the whole summary folds the parts' summaries in");
  await talk(home, 1, i++);
  const last = model.agent.at(-1)!;
  assert.ok(count(last, "SUMMARY-OF-MIDDLE") <= 1 + MAX_PARTS, "never more than one whole and the parts since");
  assert.ok(once(last), "the standing context once, after all of it");
});
