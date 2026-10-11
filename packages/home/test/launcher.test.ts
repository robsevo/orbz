// The desktop launcher (tools/desktop/orbs-open; owner, 10-03), on a stand-in home and a stand-in window (10-11: a
// restart waited two minutes on the stopped home and left it stopped: the launcher had started the home and then become
// the app's window, a browser that never reaps a child, so the home it stopped stayed a zombie kill -0 still finds):
//   - the home it starts is not a child of the window it then becomes;
//   - a restart whose home is a zombie goes on at once and starts it again;
//   controls: the launcher with each fix undone (a plain setsid; kill -0 for "gone") fails its check.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const LAUNCHER = fileURLToPath(new URL("../../../tools/desktop/orbs-open", import.meta.url));
const skip = process.platform !== "linux" || spawnSync("setsid", ["--version"]).status !== 0 ? "the launcher is Linux's" : false;

// a home: answers /status with its token, says where it is in <data>/home.json, stops on SIGTERM
const HOME_JS = `import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
const token = "t" + process.pid;
const s = createServer((req, res) => { res.writeHead(req.headers.authorization === "Bearer " + token ? 200 : 401); res.end("{}"); });
s.listen(0, "127.0.0.1", () => writeFileSync(process.env.ORBS_HOME + "/home.json", JSON.stringify({ pid: process.pid, port: s.address().port, token })));
process.on("SIGTERM", () => process.exit(0));
`;

const stat = (pid: number): string => spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
const parentOf = (pid: number): number => Number(spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim());
const homeOf = (data: string): { pid: number } | null => {
  try {
    return JSON.parse(readFileSync(join(data, "home.json"), "utf8")) as { pid: number };
  } catch {
    return null;
  }
};
async function until(what: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A stand-in machine: a checkout with the stand-in home, a data folder, a window (`brave`, which never reaps a child)
 * and a quiet notify-send; `launcher` is the script to run (the real one, or a control). */
function machine(t: { after: (f: () => void) => void }, launcher = LAUNCHER) {
  const root = mkdtempSync(join(tmpdir(), "orbs-launcher-"));
  const repo = join(root, "repo");
  const data = join(root, "data");
  const bin = join(root, "bin");
  mkdirSync(join(repo, "packages/home/src"), { recursive: true });
  mkdirSync(join(data, "window"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(repo, "packages/home/src/main.ts"), HOME_JS);
  writeFileSync(join(data, "window/paired"), ""); // paired before: no pairing link asked for
  writeFileSync(join(bin, "brave"), "#!/bin/sh\nexec sleep 30\n");
  writeFileSync(join(bin, "notify-send"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "brave"), 0o755);
  chmodSync(join(bin, "notify-send"), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ORBS_REPO: repo, ORBS_NODE: process.execPath, ORBS_HOME: data, HOME: root };
  const procs: ChildProcess[] = [];
  t.after(() => {
    const h = homeOf(data);
    if (h) spawnSync("kill", ["-TERM", String(h.pid)]);
    for (const p of procs) p.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });
  return {
    repo, data, env, procs,
    run: (args: string[], extra: Record<string, string> = {}) => {
      const p = spawn("bash", [launcher, ...args], { env: { ...env, ...extra }, stdio: "ignore" });
      procs.push(p);
      return p;
    },
  };
}

/** The launcher with one fix undone, to show the check fails it. */
function undone(t: { after: (f: () => void) => void }, from: string, to: string): string {
  const src = readFileSync(LAUNCHER, "utf8");
  assert.equal(src.split(from).length, 2, `the control's text is in the launcher once: ${from}`);
  const dir = mkdtempSync(join(tmpdir(), "orbs-launcher-control-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "orbs-open");
  writeFileSync(path, src.replace(from, to).replace("seq 1 240", "seq 1 6")); // a control's wait is three seconds
  return path;
}

const FORKED = '( cd "$REPO" && exec setsid -f "$NODE" packages/home/src/main.ts )';
const GONE = 'gone() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null) || return 0; case "$s" in Z*) return 0 ;; esac; return 1; }';

async function startsOffTheWindow(t: Parameters<typeof machine>[0], launcher?: string): Promise<{ home: number; window: number }> {
  const m = machine(t, launcher);
  const window = m.run([]);
  await until(() => homeOf(m.data) !== null);
  const home = homeOf(m.data)!.pid;
  await until(() => spawnSync("ps", ["-o", "comm=", "-p", String(window.pid)], { encoding: "utf8" }).stdout.trim() === "sleep"); // it has become the window
  return { home, window: window.pid! };
}

test("the home the launcher starts is not a child of the window it then becomes (control: a plain setsid)", { skip, timeout: 60_000 }, async (t) => {
  const real = await startsOffTheWindow(t);
  assert.notEqual(parentOf(real.home), real.window, "the window is never the home's parent");
  const control = await startsOffTheWindow(t, undone(t, FORKED, '( cd "$REPO" && exec setsid "$NODE" packages/home/src/main.ts )'));
  assert.equal(parentOf(control.home), control.window, "the control: the home a child of the window, which would never reap it");
});

async function restartsAZombie(t: Parameters<typeof machine>[0], launcher?: string): Promise<{ code: number | null; ms: number; before: number; after: number | null; was: string }> {
  const m = machine(t, launcher);
  // a home whose parent never reaps it: started in the background by a shell that then becomes something else
  // (a plain command in the background: bash forks node itself, and then execs sleep, which never waits)
  const holder = spawn("bash", ["-c", `"${process.execPath}" packages/home/src/main.ts & exec sleep 60`], { cwd: m.repo, env: m.env, stdio: "ignore" });
  m.procs.push(holder);
  await until(() => homeOf(m.data) !== null);
  const before = homeOf(m.data)!.pid;
  const t0 = Date.now();
  const r = m.run(["--restart"], { ORBS_OPEN_DRY: "1" });
  const code = await new Promise<number | null>((done) => r.on("exit", (c) => done(c)));
  const ms = Date.now() - t0;
  const after = homeOf(m.data)?.pid ?? null;
  return { code, ms, before, after: after !== before && after !== null && existsSync(`/proc/${after}`) ? after : null, was: stat(before) };
}

test("a restart whose home is a zombie goes on at once and starts it again (control: kill -0 for its gone)", { skip, timeout: 60_000 }, async (t) => {
  const real = await restartsAZombie(t);
  assert.match(real.was, /^Z/, "the home it stopped is a zombie: no one reaps it");
  assert.equal(real.code, 0);
  assert.ok(real.after !== null, "a new home, running");
  assert.ok(real.ms < 10_000, `at once, not after its two minutes' wait (${real.ms} ms)`);
  const control = await restartsAZombie(t, undone(t, GONE, 'gone() { ! kill -0 "$1" 2>/dev/null; }'));
  assert.deepEqual([control.code, control.after], [1, null], "the control: waits on the zombie, gives up, and leaves the home stopped");
});
