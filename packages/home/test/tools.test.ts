// Ash's engine test `abort-tools`, ported (PLAN 1.5_t): a stop has to reach the TOOL, not just the
// seams around it. Measured on 2026-09-08 in Ash: Esc during `sleep 90` ended the turn 80.6 s
// later. Every check here is timed or observed against a real process, as the original is.
// Plus the workspace walls the file tools keep.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Background, inWorkspace, runTool, TOOLS, type ToolContext } from "../src/agent/tools.ts";
import { tempDir } from "./helpers.ts";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

function ctxFor(t: import("node:test").TestContext, signal?: AbortSignal): ToolContext {
  const workspace = tempDir(t);
  const background = new Background();
  t.after(() => background.close());
  return { orb: "juniper", conversation: "chat:1", workspace, ...(signal && { signal }), background };
}

test("a turn already stopped does not run the tool at all, and says the person stopped it", async (t) => {
  const ac = new AbortController();
  ac.abort();
  const ctx = ctxFor(t, ac.signal);
  const r = await runTool(tool("shell"), { command: "touch ran" }, ctx);
  assert.equal(r.stoppedByUser, true);
  assert.match(r.content, /stopped by the user/i);
  assert.equal(existsSync(join(ctx.workspace, "ran")), false, "the command never started");
});

test("an un-stopped signal runs the tool normally (a stop does not leak into the next turn)", async (t) => {
  const r = await runTool(tool("shell"), { command: "echo alive" }, ctxFor(t, new AbortController().signal));
  assert.deepEqual([r.isError, r.content], [false, "alive"]);
});

test("a stop ends a running command promptly, reported as the person stopping it", async (t) => {
  const ac = new AbortController();
  const t0 = Date.now();
  const p = runTool(tool("shell"), { command: "sleep 60" }, ctxFor(t, ac.signal));
  await new Promise((r) => setTimeout(r, 300));
  ac.abort();
  const r = await p;
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `took ${ms} ms; a command that finishes on its own takes 60 s`);
  assert.equal(r.stoppedByUser, true);
  assert.match(r.content, /stopped by the user/i);
});

test("the whole tree is killed, not just the shell, and nothing is left running", async (t) => {
  const ac = new AbortController();
  const ctx = ctxFor(t, ac.signal);
  const marker = join(ctx.workspace, "tree-marker");
  const p = runTool(tool("shell"), { command: `sh -c 'sleep 2 && touch ${marker}' & wait` }, ctx);
  await new Promise((r) => setTimeout(r, 300));
  ac.abort();
  await p;
  await new Promise((r) => setTimeout(r, 2600)); // longer than the grandchild's own sleep
  assert.equal(existsSync(marker), false, "the grandchild outlived the stop");
  // the exact argv, not `pgrep -f`, whose pattern matches the checking shell's own command line
  const strays = execFileSync("bash", ["-c", "ps -eo cmd --no-headers | grep -cx 'sleep 2' || true"], { encoding: "utf8" }).trim();
  assert.equal(strays, "0");
});

test("a background command is out of a stop's reach until it is stopped by name", async (t) => {
  const ac = new AbortController();
  const ctx = ctxFor(t, ac.signal);
  const r = await runTool(tool("shell"), { command: "sleep 30", background: true }, ctx);
  const id = /\[(bg\d+)\]/.exec(r.content)?.[1];
  assert.ok(id, r.content);
  ac.abort();
  await new Promise((res) => setTimeout(res, 300));
  assert.match(ctx.background.read(id) ?? "", /still running/, "stopping the turn did not reach it");
  const stopped = await runTool(tool("stop_shell"), { id }, { ...ctx, signal: new AbortController().signal });
  assert.match(stopped.content, /Stopped/);
  await new Promise((res) => setTimeout(res, 300));
  assert.match(ctx.background.read(id) ?? "", /killed by SIGKILL/);
});

test("a fetch on a stopped turn reports a stop, not a network failure", async (t) => {
  const ac = new AbortController();
  ac.abort();
  const r = await runTool(tool("web_fetch"), { url: "http://127.0.0.1:9/" }, ctxFor(t, ac.signal));
  assert.equal(r.stoppedByUser, true);
});

test("no signal at all is not a stop", async (t) => {
  const ctx = ctxFor(t);
  const r = await runTool(tool("shell"), { command: "echo no-signal-at-all" }, ctx);
  assert.deepEqual([r.isError, r.content], [false, "no-signal-at-all"]);
});

test("the file tools stay inside the workspace, through links too", (t) => {
  const ws = tempDir(t);
  const outside = tempDir(t);
  mkdirSync(join(ws, "notes"), { recursive: true });
  writeFileSync(join(outside, "secret.txt"), "not yours");
  assert.equal(inWorkspace(ws, "notes/today.md")?.endsWith("notes/today.md"), true, "control: a path inside is allowed");
  assert.equal(inWorkspace(ws, "../" + outside.split("/").at(-1) + "/secret.txt"), null);
  assert.equal(inWorkspace(ws, join(outside, "secret.txt")), null, "an absolute path elsewhere");
  symlinkSync(outside, join(ws, "door"));
  assert.equal(inWorkspace(ws, "door/secret.txt"), null, "a link out of the workspace");
  symlinkSync(join(outside, "not-yet.txt"), join(ws, "trap"));
  assert.equal(inWorkspace(ws, "trap"), null, "a dangling link whose target is outside: a write would create it there");
  const precheck = tool("read_file").precheck!({ path: "door/secret.txt" }, { orb: "o", conversation: "c", workspace: ws, background: new Background() });
  assert.match(precheck ?? "", /outside the workspace/);
});
