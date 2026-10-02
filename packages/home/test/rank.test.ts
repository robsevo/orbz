// PLAN 3.8_t, what rank widens (rules/rank.ts) and what it never does:
//   - A Senior in a Build specialty runs a read-only command in its workspace without asking; a
//     Junior, or a Senior writer, still asks for the very same command.
//   - Anything that could run code the orb wrote (a test runner, git), shell syntax, a path out of
//     the workspace or a reader's run-something flag still asks; so does what the floor reads
//     (sending an email), your own rule saying ask, and anything while you're away.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS } from "../src/agent/tools.ts";
import { readOnlyCommand, rankWidens } from "../src/rules/rank.ts";
import { agentHome } from "./helpers.ts";

test("read-only means it runs nothing the orb wrote: no runners, no git, no syntax, nothing outside, no run-something flags", () => {
  for (const c of ["ls", "ls -la src", "grep -rn TODO src", "rg -n useState src", "find . -name *.tsx", "wc -l src/App.tsx", "cat notes.md", "diff a.txt b.txt"]) assert.equal(readOnlyCommand(c), true, c);
  for (const c of [
    "pnpm test", "npm run build", "node --test", "git status", "git log", "./ls", "/bin/ls",
    "ls | sh", "cat a > b", "ls; rm -rf .", "echo $(id)", "cat `x`", "grep 'a b' src", "ls && pwd",
    "cat /etc/passwd", "ls ~", "cat ../secrets.txt", "find . -delete", "find . -exec rm {} +", "rg --pre ./x foo", "rg --pre=./x foo", "FOO=1 ls",
  ]) assert.equal(readOnlyCommand(c), false, c);
  assert.match(rankWidens({ level: "Senior", family: "build", command: "ls src", background: false }) ?? "", /a Senior's read-only command/);
  assert.equal(rankWidens({ level: "Mid", family: "build", command: "ls src", background: false }), null, "below Senior");
  assert.equal(rankWidens({ level: "Chief", family: "make", command: "ls src", background: false }), null, "not a Build specialty");
  assert.equal(rankWidens({ level: "Staff", family: "build", command: "ls src", background: true }), null, "nothing in the background");
});

/** Ada (frontend) and Wren (writing), each in a home of their own, asking for `command`: who gets a card. */
async function asks(t: Parameters<typeof agentHome>[0], o: { command: string; senior: string[]; rule?: boolean; away?: boolean }) {
  const carded: string[] = [];
  for (const [orb, name, specialty] of [["ada", "Ada", "frontend"], ["wren", "Wren", "writing"]] as const) {
    const { home } = await agentHome(t, [{ calls: [{ name: "shell", args: { command: o.command } }] }, { chunks: ["done"] }]);
    home.inbox.addOrb(orb, name, specialty);
    if (o.senior.includes(orb)) {
      home.events.append("orb.promoted", { from: "Junior", to: "Mid" }, { orb });
      home.events.append("orb.promoted", { from: "Mid", to: "Senior" }, { orb });
    }
    const shellDef = TOOLS.find((d) => d.name === "shell")!;
    if (o.rule) home.rules.add({ orb, text: `ask: ${o.command}`, decision: "ask", action: shellDef.describe({ command: o.command }), source: "owner" });
    const conversation = o.away ? `schedule:${orb}` : `chat:${orb}`;
    if (o.away) home.inbox.enqueue(orb, conversation, "schedule", "[Schedule: look] Look around.", { data: { schedule: "s1" }, fresh: true });
    else home.inbox.enqueue(orb, conversation, "chat", "look around");
    await home.inbox.idle();
    if (home.conversations.openCard(conversation)) carded.push(orb);
  }
  return carded;
}

test("a Senior frontend orb lists its files without asking; a Junior, or a Senior writer, asks", async (t) => {
  assert.deepEqual(await asks(t, { command: "ls src", senior: ["ada", "wren"] }), ["wren"], "Ada (Senior, frontend) did not ask; Wren (Senior, writing) did");
  assert.deepEqual(await asks(t, { command: "ls src", senior: [] }), ["ada", "wren"], "Juniors both ask");
});

test("rank never reaches the rest: a test runner, the floor, your own rule, being away", async (t) => {
  assert.deepEqual(await asks(t, { command: "pnpm test", senior: ["ada"] }), ["ada", "wren"], "a runner runs what he wrote: it asks");
  assert.deepEqual(await asks(t, { command: "mail -s hi bob@example.com", senior: ["ada"] }), ["ada", "wren"], "the floor reads it: messaging asks");
  assert.equal(readOnlyCommand("cat credentials.json"), true, "control: only reading");
  assert.deepEqual(await asks(t, { command: "cat credentials.json", senior: ["ada"] }), ["ada", "wren"], "read-only, but the floor reads passwords: it asks");
  assert.deepEqual(await asks(t, { command: "ls src", senior: ["ada"], rule: true }), ["ada", "wren"], "your rule says ask: it asks");
  assert.deepEqual(await asks(t, { command: "ls src", senior: ["ada"], away: true }), ["ada", "wren"], "while you're away it asks");
});
