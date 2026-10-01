// The home's data is the person's (found 2026-10-01: ~/.orbs was 0755 and home.db 0644, so any
// user on the machine could read the conversations). The folder is 0700 and the database 0600,
// new or old; a folder of the person's own that is not a home keeps its mode.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Home } from "../src/home.ts";
import { tempDir } from "./helpers.ts";

const skip = process.platform === "win32" ? "POSIX modes" : false;
const mode = (p: string): number => statSync(p).mode & 0o777;
const open = (dataDir: string): Home => Home.open({ dataDir, protect: [], spendCapUsd: null });

test("a new home's folder is the owner's alone, and so is its database and its WAL", { skip }, async (t) => {
  const dataDir = join(tempDir(t), "orbs-data");
  const home = open(dataDir);
  home.inbox.addOrb("juniper", "Juniper"); // a write, so the WAL holds something
  assert.equal(mode(dataDir), 0o700);
  assert.equal(mode(join(dataDir, "home.db")), 0o600);
  assert.ok(existsSync(join(dataDir, "home.db-wal")), "control: there is a WAL to check");
  assert.equal(mode(join(dataDir, "home.db-wal")), 0o600);
  await home.close();
});

test("a home made before this has its looser modes tightened when it opens", { skip }, async (t) => {
  const dataDir = join(tempDir(t), "old-home");
  const first = open(dataDir);
  first.inbox.addOrb("juniper", "Juniper");
  await first.close();
  chmodSync(dataDir, 0o755);
  chmodSync(join(dataDir, "home.db"), 0o644);
  if (existsSync(join(dataDir, "home.db-wal"))) chmodSync(join(dataDir, "home.db-wal"), 0o644);
  assert.equal(mode(join(dataDir, "home.db")), 0o644, "control: loose, as the old home left it");
  const again = open(dataDir);
  t.after(() => again.close());
  assert.equal(mode(dataDir), 0o700);
  assert.equal(mode(join(dataDir, "home.db")), 0o600);
  if (existsSync(join(dataDir, "home.db-wal"))) assert.equal(mode(join(dataDir, "home.db-wal")), 0o600);
  assert.equal(again.inbox.orb("juniper")?.name, "Juniper", "and nothing in it was lost");
});

test("a folder of the person's own that is not a home keeps its mode; the database in it is still theirs alone", { skip }, async (t) => {
  const dataDir = join(tempDir(t), "my-stuff");
  mkdirSync(dataDir, { mode: 0o755 });
  chmodSync(dataDir, 0o755);
  writeFileSync(join(dataDir, "notes.txt"), "mine");
  const home = open(dataDir);
  t.after(() => home.close());
  assert.equal(mode(dataDir), 0o755, "not ours to change");
  assert.equal(mode(join(dataDir, "home.db")), 0o600);
});
