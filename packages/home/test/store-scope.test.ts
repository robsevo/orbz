// PLAN 1.10_t (where the secrets live), one keychain shared by the machine: each home reads and
// writes its own entries only, so a test's home (in a temporary folder) never reads yours; the
// default home still reads the entries it wrote before entries carried a home's prefix.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { defaultHome, HomeScopedStore, MemoryStore } from "../src/chatgpt/store.ts";
import { tempDir } from "./helpers.ts";

test("two homes on one keychain never read each other's secrets; the default home keeps its older entries", async (t) => {
  const keychain = new MemoryStore();
  await keychain.set("chatgpt.tokens", "yours, from before"); // written by a home before the prefix
  const mine = new HomeScopedStore(keychain, defaultHome(), { legacy: true });
  const test1 = new HomeScopedStore(keychain, tempDir(t), { legacy: false });
  const test2 = new HomeScopedStore(keychain, tempDir(t), { legacy: false });
  assert.equal(await mine.get("chatgpt.tokens"), "yours, from before", "your sign-in survives");
  assert.equal(await test1.get("chatgpt.tokens"), null, "a test's home never sees it");
  await test1.set("chatgpt.tokens", "the test's");
  assert.deepEqual([await test1.get("chatgpt.tokens"), await test2.get("chatgpt.tokens"), await mine.get("chatgpt.tokens")], ["the test's", null, "yours, from before"]);
  await mine.set("chatgpt.tokens", "yours, now");
  await mine.delete("chatgpt.tokens");
  assert.equal(await mine.get("chatgpt.tokens"), null, "a sign-out clears the old entry too");
  assert.equal(await test1.get("chatgpt.tokens"), "the test's");
  assert.equal(keychain.kind, test1.kind);
});

test("the default home is $ORBS_HOME, else ~/.orbs", (t) => {
  const was = process.env.ORBS_HOME;
  t.after(() => (was === undefined ? delete process.env.ORBS_HOME : (process.env.ORBS_HOME = was)));
  process.env.ORBS_HOME = "/srv/orbs-home";
  assert.equal(defaultHome(), "/srv/orbs-home");
  delete process.env.ORBS_HOME;
  assert.match(defaultHome(), new RegExp(`${join("", ".orbs").replace(".", "\\.")}$`));
});
