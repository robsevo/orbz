// PLAN 1.2: headless with one command. Starts the real `main.ts` as its own process, talks to it
// through its door, and stops it the way a service manager would.
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { Home } from "../src/home.ts";
import { Recorder, tempDir } from "./helpers.ts";

const MAIN = new URL("../src/main.ts", import.meta.url).pathname;

function start(dataDir: string): { child: ChildProcessWithoutNullStreams; out: () => string; exit: Promise<number | null> } {
  const child = spawn(process.execPath, [MAIN, "--data", dataDir], { env: { ...process.env, ORBS_HOME: "" } });
  let out = "";
  child.stdout.on("data", (b: Buffer) => (out += b.toString()));
  child.stderr.on("data", (b: Buffer) => (out += b.toString()));
  const exit = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  return { child, out: () => out, exit };
}

async function until<T>(what: string, fn: () => T | undefined | Promise<T | undefined>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function raw(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.once("error", reject);
    req.end();
  });
}

test("one command starts a headless home; it answers only with its token, refuses a twin, and stops cleanly", async (t) => {
  const dataDir = tempDir(t);
  const home = start(dataDir);
  t.after(() => home.child.kill("SIGKILL"));
  await until("the ready line", () => (home.out().includes("ready on http://127.0.0.1:") ? true : undefined));

  const door = JSON.parse(readFileSync(join(dataDir, "home.json"), "utf8")) as { port: number; token: string; pid: number };
  assert.equal(door.pid, home.child.pid);
  const base = `http://127.0.0.1:${door.port}`;
  const auth = { authorization: `Bearer ${door.token}`, "content-type": "application/json" };

  assert.equal((await fetch(`${base}/status`)).status, 401, "no token, no answer");
  assert.equal((await fetch(`${base}/status`, { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal(
    await raw(door.port, "/status", { authorization: `Bearer ${door.token}`, host: `evil.example:${door.port}` }),
    403,
    "a rebound hostname is refused even with the token",
  );

  const made = await fetch(`${base}/orbs`, { method: "POST", headers: auth, body: JSON.stringify({ id: "juniper", name: "Juniper" }) });
  assert.equal(made.status, 200);
  const sent = await fetch(`${base}/orbs/juniper/messages`, { method: "POST", headers: auth, body: JSON.stringify({ text: "hello" }) });
  assert.equal(sent.status, 200);
  await until("the run to finish", async () => {
    const r = (await (await fetch(`${base}/events`, { headers: auth })).json()) as { events: { type: string; data: Record<string, unknown> }[] };
    return r.events.find((e) => e.type === "run.finished");
  });
  const chat = (await (await fetch(`${base}/conversations/chat:main/messages`, { headers: auth })).json()) as { messages: { role: string; content: string }[] };
  assert.deepEqual(chat.messages.map((m) => m.role), ["user", "notice"]);
  assert.match(chat.messages[1]!.content, /No brain is set up yet/, "without a brain it says so instead of pretending");
  assert.equal((await fetch(`${base}/cards/999`, { method: "POST", headers: auth, body: JSON.stringify({ choice: "approve" }) })).status, 409);
  assert.equal((await fetch(`${base}/orbs/nobody/pause`, { method: "POST", headers: auth })).status, 404);

  const twin = start(dataDir);
  assert.equal(await twin.exit, 3, "a second home on the same data is refused");
  assert.match(twin.out(), /another Orbs home is already running/);

  home.child.kill("SIGTERM");
  assert.equal(await home.exit, 0);
  assert.equal(existsSync(join(dataDir, "home.json")), false, "the door is closed and its file removed");

  const after = Home.open({ dataDir, runner: new Recorder(), protect: [] });
  t.after(() => after.close());
  assert.equal(after.events.ofType("home.stopped").length, 1, "it stopped cleanly and said so");
});
