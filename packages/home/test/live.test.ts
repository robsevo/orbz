// PLAN 4.6_t (the computer in the browser), on a real Chromium and the stand-in web:
//   - his screen live: frames come as his page changes, and stop with the last watcher; through the
//     door it is a stream an <img> shows, for a signed-in device only;
//   - take over: his act waits for you, and goes on the moment you hand it back; a stop ends the wait;
//   - your hands reach his page only while you have it: a press on his screen is a click there,
//     typing lands in his page, an address is still never this machine or its network;
//   - his terminal: what a command prints reaches you while it runs; yours run in his sandbox;
//   - his sandbox (Linux): another orb's files and the box's own are not there, nor the home's
//     environment; his workspace is, and his commands still have the network.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { chromiumPath } from "../src/computer/browser.ts";
import { bubblewrap } from "../src/computer/sandbox.ts";
import { agentHome } from "./helpers.ts";
import { web } from "./fakes/web.ts";

const EXE = chromiumPath();
if (!EXE) throw new Error("no Chromium for his browser: set ORBS_CHROME, or `npx playwright install chromium`");
const until = async (ok: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("waited too long");
    await new Promise((r) => setTimeout(r, 50));
  }
};

test("his screen live: at once, then frames as his page changes, and none once no one watches", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home } = await agentHome(t, [], { computer: { executable: EXE } });
  await home.computers.open("juniper", site.url("shop.test", "/shop"));
  const frames: Buffer[] = [];
  const stop = await home.computers.watch("juniper", (f) => frames.push(f));
  assert.ok(frames.length >= 1, "a page standing still is shown at once, not when it next paints");
  const still = frames.length;
  await home.computers.open("juniper", site.url("shop.test", "/about"));
  await until(() => frames.length > still);
  assert.ok(frames.every((f) => f.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))), "each frame a JPEG of his screen");
  assert.equal(home.computers.watching("juniper"), true, "watched: his screencast runs");
  await stop();
  assert.equal(home.computers.watching("juniper"), false, "the last watcher gone, the screencast stops (no frames made for no one)");
  const seen = frames.length;
  await home.computers.open("juniper", site.url("shop.test", "/shop"));
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(frames.length, seen, "no one watching: no frames");
});

test("take over: his act waits for you, and goes on the moment you hand it back; a stop ends the wait", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home } = await agentHome(t, [
    { calls: [{ name: "open_page", args: { url: site.url("shop.test", "/about") } }] },
    { chunks: ["Opened."] },
    { calls: [{ name: "open_page", args: { url: site.url("shop.test", "/shop") } }] },
    { chunks: ["never reached"] },
  ], { kit: true, computer: { executable: EXE } });
  home.computers.takeOver("juniper");
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "open the about page");
  await until(() => home.events.ofType("computer.waiting").length > 0, 20_000);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(home.events.ofType("computer.screen").length, 0, "while you have it, he does nothing");
  home.computers.handBack("juniper");
  await home.inbox.idle();
  assert.match(home.conversations.list("chat:juniper").filter((m) => m.role === "tool").at(-1)!.content, /Opened .*\/about/, "handed back: his act went on");

  home.computers.takeOver("juniper");
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "now the shop");
  await until(() => home.events.ofType("computer.waiting").length > 1, 20_000);
  home.inbox.stop("juniper");
  await home.inbox.idle();
  assert.ok(home.conversations.list("chat:juniper").some((m) => /stopped while the person had his computer|Stopped/.test(m.content)), "a stop ends the wait");
  home.computers.handBack("juniper");
});

test("your hands reach his page only while you have it: a press is a click there, typing lands, an address is still guarded", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home } = await agentHome(t, [], { computer: { executable: EXE } });
  await home.computers.open("juniper", site.url("shop.test", "/big-link"));
  await assert.rejects(home.computers.hands("juniper", { kind: "click", x: 640, y: 400 }), /take the computer over first/);
  home.computers.takeOver("juniper");
  const at = await home.computers.hands("juniper", { kind: "click", x: 640, y: 400 });
  assert.match(at.url, /\/about$/, "a press on his screen clicked the link under it");
  await home.computers.hands("juniper", { kind: "go", url: site.url("shop.test", "/big-field") });
  await home.computers.hands("juniper", { kind: "click", x: 640, y: 400 });
  const typed = await home.computers.hands("juniper", { kind: "type", text: "hello from you" });
  assert.equal(typed.title, "hello from you", "what you typed landed in his page");
  await assert.rejects(home.computers.hands("juniper", { kind: "go", url: "http://10.1.2.3/" }), /not opened: refusing to fetch a private or reserved address/);
  await assert.rejects(home.computers.hands("juniper", { kind: "key", key: "F12" }), /not a key the app presses/);
  const meta = JSON.parse(readFileSync(home.computers.screen("juniper").meta, "utf8")) as { title: string };
  assert.equal(meta.title, "hello from you", "and his still shows it");
  home.computers.handBack("juniper");
});

test("his terminal: what a command prints reaches you while it runs; yours run in his sandbox, only while you have him", { timeout: 120_000 }, async (t) => {
  const { home } = await agentHome(t, [
    { calls: [{ name: "shell", args: { command: "printf 'one\\n'; sleep 1.2; printf 'two\\n'" } }] },
    { chunks: ["done"] },
  ], { agent: { decide: () => "allow" } });
  const chunks: { at: number; chunk: string; call: string }[] = [];
  home.live.on("terminal", (e: { chunk: string; call: string }) => chunks.push({ at: Date.now(), ...e }));
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "count");
  await home.inbox.idle();
  const result = home.conversations.list("chat:juniper").find((m) => m.role === "tool")!;
  assert.match(result.content, /one\ntwo/);
  const one = chunks.find((c) => c.chunk.includes("one"));
  const two = chunks.find((c) => c.chunk.includes("two"));
  assert.ok(one && two && two.at - one.at >= 900, "'one' reached you a second before the command ended");
  await assert.rejects(home.terminal("juniper", "echo hi"), /take the computer over first/);
  home.computers.takeOver("juniper");
  const r = await home.terminal("juniper", "echo mine > yours.txt && cat yours.txt");
  assert.deepEqual([r.content.trim(), r.isError ?? false], ["mine", false]);
  assert.ok(chunks.some((c) => c.call.startsWith("you-") && c.chunk.includes("mine")), "yours printed live too");
  home.computers.handBack("juniper");
});

test("his sandbox: another orb's files, the box's own and the home's environment are not there; his workspace is", { timeout: 120_000, skip: bubblewrap() ? false : "no bubblewrap that starts here (Linux only)" }, async (t) => {
  const outside = mkdtempSync(join(tmpdir(), "orbs-box-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "box-secret.txt"), "the box's own");
  process.env.ORBS_TEST_SECRET = "sk-dummy-but-key-shaped-1234";
  t.after(() => delete process.env.ORBS_TEST_SECRET);
  const dataDir = mkdtempSync(join(tmpdir(), "orbs-sandboxed-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const hazels = join(dataDir, "orbs", "hazel", "workspace", "secret.txt");
  const { home } = await agentHome(t, [
    { calls: [{ name: "shell", args: { command: `cat ${hazels} 2>&1 || true` } }] }, // his own shell, not only yours
    { chunks: ["done"] },
  ], { dataDir, agent: { decide: () => "allow" } });
  mkdirSync(join(dataDir, "orbs", "hazel", "workspace"), { recursive: true });
  writeFileSync(hazels, "hazel's own");
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "read hazel's secret");
  await home.inbox.idle();
  assert.match(home.conversations.list("chat:juniper").find((m) => m.role === "tool")!.content, /No such file/, "his own shell cannot read another orb's work");
  const run = async (command: string): Promise<string> => {
    home.computers.takeOver("juniper");
    try {
      return (await home.terminal("juniper", command)).content;
    } finally {
      home.computers.handBack("juniper");
    }
  };
  assert.match(await run(`cat ${join(dataDir, "orbs", "hazel", "workspace", "secret.txt")} 2>&1 || true`), /No such file/, "another orb's work is not there");
  assert.match(await run(`cat ${join(outside, "box-secret.txt")} 2>&1 || true`), /No such file/, "nor the box's own files");
  assert.match(await run(`ls ${join(dataDir, "home.db")} 2>&1 || true`), /No such file/, "nor the home's database");
  assert.equal((await run("echo ${ORBS_TEST_SECRET:-none}")).trim(), "none", "nor the home's environment");
  // this session's own sockets (D-Bus, so no keyring) are hidden by the list of people's places,
  // not by /tmp's being emptied, which hides everything else this test makes
  const sockets = `/run/user/${process.getuid?.() ?? 0}`;
  if (existsSync(sockets) && readdirSync(sockets).length) {
    const listed = (await run(`ls -A ${sockets} 2>/dev/null`)).split("\n").map((l) => l.trim());
    assert.deepEqual(readdirSync(sockets).filter((n) => listed.includes(n)), [], "nor this session's sockets");
  }
  assert.equal((await run("echo his > mine.txt && cat mine.txt")).trim(), "his", "CONTROL: his workspace is there, and his to write");
  assert.ok(existsSync(join(dataDir, "orbs", "juniper", "workspace", "mine.txt")), "and what he wrote is in his workspace");
});

test("the live view needs a signed-in device; through the door it is a stream of frames", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home } = await agentHome(t, [], { computer: { executable: EXE } });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const base = `http://127.0.0.1:${door.port}`;
  assert.equal((await fetch(`${base}/orbs/juniper/computer/live`)).status, 401, "no device, no view");
  await home.computers.open("juniper", site.url("shop.test", "/shop"));
  const ac = new AbortController();
  const r = await fetch(`${base}/orbs/juniper/computer/live`, { headers: { authorization: `Bearer ${door.token}` }, signal: ac.signal });
  assert.match(r.headers.get("content-type") ?? "", /^multipart\/x-mixed-replace; boundary=orbsframe/);
  const reader = r.body!.getReader();
  let got = "";
  // a change to show, made while the home stands: the test waits for it before it ends
  const change = new Promise<void>((ok) => setTimeout(ok, 300)).then(() => home.computers.open("juniper", site.url("shop.test", "/about")));
  while (!got.includes("image/jpeg")) {
    const { value, done } = await reader.read();
    if (done) break;
    got += Buffer.from(value!).toString("latin1");
  }
  assert.match(got, /--orbsframe\r\ncontent-type: image\/jpeg\r\ncontent-length: \d+/);
  await change;
  ac.abort();
  const hands = await fetch(`${base}/orbs/juniper/computer/hands`, { method: "POST", headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, body: JSON.stringify({ kind: "back" }) });
  assert.equal(hands.status, 409, "hands only once you have taken him over");
});
