// PLAN 2.8_t, the home's side of his computer: his workspace, read through the door.
//   - A folder lists its folders first, then its files, with their sizes; a nested one too.
//   - A file comes back as text; one that is not text comes back without it; a big one is cut at
//     READ_CAP and says so.
//   - Nothing outside it is read or listed: "..", an absolute path, a link that leads out (a link
//     that stays inside is followed).
//   - An orb that is not in the office, or a file that is not there, is a 404.
//   - A file you give him (PLAN 2.4) is kept in from-you/, never over another, under its own plain
//     name; one too big, or a from-you/ that leads out of his workspace, is refused.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { READ_CAP, safeName, UPLOAD_CAP, workspaceOf } from "../src/workspace.ts";
import { agentHome, tempDir } from "./helpers.ts";

test("his workspace through the door: folders and files, text, a cap, and nothing outside it", async (t) => {
  const { home, dataDir } = await agentHome(t, []);
  home.inbox.addOrb("hazel", "Hazel", "data");
  const ws = workspaceOf(dataDir, "hazel");
  mkdirSync(join(ws, "charts"), { recursive: true });
  writeFileSync(join(ws, "sales.csv"), "month,total\nJan,12\nFeb,30\n");
  writeFileSync(join(ws, "charts", "q1.json"), '[{"month":"Jan","total":12}]');
  writeFileSync(join(ws, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13]));
  writeFileSync(join(ws, "big.txt"), "x".repeat(READ_CAP + 100));
  const outside = tempDir(t);
  writeFileSync(join(outside, "secret.txt"), "the person's own secret");
  symlinkSync(join(outside, "secret.txt"), join(ws, "escape.txt"));
  symlinkSync(join(ws, "sales.csv"), join(ws, "same.csv"));

  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const get = async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { headers: { authorization: `Bearer ${door.token}` } });
    return { status: r.status, text: await r.text() };
  };
  const json = async (path: string) => JSON.parse((await get(path)).text) as Record<string, unknown>;

  const top = (await json("/orbs/hazel/workspace")).entries as { path: string; dir: boolean; size: number }[];
  assert.deepEqual(top.map((e) => e.path), ["charts", "big.txt", "logo.png", "sales.csv", "same.csv"], "folders first, then by name; the link out is not shown");
  assert.equal(top.find((e) => e.path === "sales.csv")!.size, 26);
  assert.deepEqual(((await json("/orbs/hazel/workspace?path=charts")).entries as { path: string }[]).map((e) => e.path), ["charts/q1.json"]);

  const csv = (await json("/orbs/hazel/workspace/file?path=sales.csv")).file as { text: string; truncated: boolean };
  assert.equal(csv.text, "month,total\nJan,12\nFeb,30\n");
  assert.equal(csv.truncated, false);
  assert.equal(((await json("/orbs/hazel/workspace/file?path=same.csv")).file as { text: string }).text, csv.text, "a link that stays inside is followed");
  assert.equal(((await json("/orbs/hazel/workspace/file?path=logo.png")).file as { text: unknown }).text, null, "not text: no text");
  const big = (await json("/orbs/hazel/workspace/file?path=big.txt")).file as { text: string; truncated: boolean; size: number };
  assert.equal(big.text.length, READ_CAP);
  assert.equal(big.truncated, true);
  assert.equal(big.size, READ_CAP + 100);

  for (const bad of ["../../brain/CONSTITUTION.md", "/etc/passwd", "escape.txt", "charts/../../x"]) {
    const r = await get(`/orbs/hazel/workspace/file?path=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, `${bad}: refused`);
    assert.doesNotMatch(r.text, /the person's own secret/);
  }
  assert.equal((await get(`/orbs/hazel/workspace?path=${encodeURIComponent("../..")}`)).status, 400, "nor listed");
  assert.equal((await get("/orbs/hazel/workspace/file?path=nothing.txt")).status, 404);
  assert.equal((await get("/orbs/nobody/workspace")).status, 404);
  home.inbox.addOrb("milo", "Milo", "research");
  assert.deepEqual((await json("/orbs/milo/workspace")).entries, [], "an orb who has made nothing yet: an empty computer");
});

test("a file you give him from a chat: kept in from-you, never over another, under a plain name; too big, or out of his workspace, refused", async (t) => {
  const { home, dataDir } = await agentHome(t, []);
  home.inbox.addOrb("hazel", "Hazel", "data");
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const give = async (name: string, bytes: Uint8Array, orb = "hazel") => {
    const r = await fetch(`http://127.0.0.1:${door.port}/orbs/${orb}/workspace/files?name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { authorization: `Bearer ${door.token}`, "content-type": "application/octet-stream" }, body: bytes,
    });
    return { status: r.status, json: (await r.json()) as { path?: string; error?: string } };
  };
  const ws = workspaceOf(dataDir, "hazel");
  const csv = new TextEncoder().encode("month,total\nJan,12\n");
  assert.deepEqual((await give("Q1 sales.csv", csv)).json, { path: "from-you/Q1 sales.csv" });
  assert.equal(readFileSync(join(ws, "from-you", "Q1 sales.csv"), "utf8"), "month,total\nJan,12\n", "byte for byte");
  assert.deepEqual((await give("Q1 sales.csv", new TextEncoder().encode("again"))).json, { path: "from-you/Q1 sales (2).csv" }, "never over the first");
  assert.equal(readFileSync(join(ws, "from-you", "Q1 sales.csv"), "utf8"), "month,total\nJan,12\n");
  assert.deepEqual((await give("../../etc/passwd", csv)).json, { path: "from-you/passwd" }, "only its own name: no way up");
  assert.deepEqual((await give(".bashrc", csv)).json, { path: "from-you/bashrc" }, "never hidden");
  assert.equal(safeName("a\u0000b<c>.txt"), "ab_c_.txt");
  assert.equal((await give("big.bin", new Uint8Array(UPLOAD_CAP + 1))).status, 413);
  assert.equal((await give("x.txt", csv, "nobody")).status, 404);
  assert.equal((await give("", csv)).status, 400);
  // from-you a link out of his workspace: refused, nothing written outside
  const other = tempDir(t);
  home.inbox.addOrb("milo", "Milo", "data");
  mkdirSync(workspaceOf(dataDir, "milo"), { recursive: true });
  symlinkSync(other, join(workspaceOf(dataDir, "milo"), "from-you"));
  assert.equal((await give("x.txt", csv, "milo")).status, 403);
  assert.deepEqual(readdirSync(other), []);
});
