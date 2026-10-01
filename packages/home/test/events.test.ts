import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import { HomeLockedError } from "../src/db.ts";
import { Home } from "../src/home.ts";
import { openHome, Recorder, tempDir } from "./helpers.ts";

test("the event log's sequence only goes up, across a restart", async (t) => {
  const dataDir = tempDir(t);
  const first = Home.open({ dataDir, runner: new Recorder(), protect: [] });
  const a = first.events.append("test.a");
  const b = first.events.append("test.b", { n: 1 }, { orb: "x" });
  assert.ok(b > a);
  await first.close();

  const second = Home.open({ dataDir, runner: new Recorder(), protect: [] });
  t.after(() => second.close());
  const c = second.events.append("test.c");
  const seqs = second.events.since(0).map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y), "read back in sequence order");
  assert.equal(new Set(seqs).size, seqs.length, "no sequence number is used twice");
  assert.ok(c > b, "a restart never reuses or rewinds a sequence number");
  assert.deepEqual(second.events.since(0).find((e) => e.seq === b)?.data, { n: 1 });
});

test("the event log refuses UPDATE and DELETE, and nothing else is frozen (control)", async (t) => {
  const { home, dataDir } = openHome(t);
  home.events.append("test.keep", { v: 1 });
  await home.close();

  const db = new DatabaseSync(join(dataDir, "home.db"));
  t.after(() => db.close());
  assert.throws(() => db.exec("UPDATE events SET type = 'rewritten'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM events"), /append-only/);
  // control: the triggers guard the log only; ordinary state tables still change
  db.exec("INSERT INTO orbs (id, name, created_at) VALUES ('ctl', 'Control', 0)");
  db.exec("UPDATE orbs SET name = 'Changed' WHERE id = 'ctl'");
  db.exec("DELETE FROM orbs WHERE id = 'ctl'");
});

test("one writer: a second home on the same data directory is refused until the first closes", async (t) => {
  const dataDir = tempDir(t);
  const first = Home.open({ dataDir, runner: new Recorder(), protect: [] });
  assert.throws(() => Home.open({ dataDir, runner: new Recorder(), protect: [] }), HomeLockedError);
  await first.close();
  const again = Home.open({ dataDir, runner: new Recorder(), protect: [] }); // control: the lock is released
  await again.close();
});

test("a listener hears an event only once its transaction commits, never one that rolled back", async (t) => {
  const { tx } = await import("../src/db.ts");
  const { DatabaseSync: DB } = await import("node:sqlite");
  const { EventLog } = await import("../src/events.ts");
  const { realClock } = await import("../src/clock.ts");
  const db = new DB(":memory:");
  db.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, type TEXT, orb TEXT, conversation TEXT, data TEXT)");
  const log = new EventLog(db, realClock);
  const heard: string[] = [];
  log.listen((e) => heard.push(e.type));
  tx(db, () => {
    log.append("inside");
    assert.deepEqual(heard, [], "not yet: the transaction has not committed");
  });
  assert.deepEqual(heard, ["inside"]);
  assert.throws(() => tx(db, () => { log.append("rolled-back"); throw new Error("no"); }));
  assert.deepEqual(heard, ["inside"], "an event that never reached the disk is never announced");
  log.append("outside");
  assert.deepEqual(heard, ["inside", "outside"], "control: outside a transaction it is heard at once");
  t.after(() => db.close());
});
