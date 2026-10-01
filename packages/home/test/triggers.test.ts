import assert from "node:assert/strict";
import { test } from "node:test";
import { triggerConversation } from "../src/triggers.ts";
import { FakeMailbox, openHome } from "./helpers.ts";

test("a trigger delivers new events in order, exactly once, and never the history before it", async (t) => {
  const { home, runner, clock } = openHome(t);
  const box = new FakeMailbox();
  box.arrive("old-1", clock.now() - 1000, "Archive");
  home.triggers.register("mail", box);
  home.inbox.addOrb("juniper", "Juniper");
  const trig = home.triggers.add({ orb: "juniper", name: "New mail", kind: "mail", instruction: "Sort it." });
  home.start();
  await home.inbox.idle();
  assert.equal(runner.runs.length, 0, "mail from before the trigger existed is not delivered");

  box.arrive("m1", clock.now() + 1000, "Dana");
  box.arrive("m2", clock.now() + 2000, "Eli");
  await clock.advance(box.everyMs);
  await home.inbox.idle();
  assert.equal(runner.runs.length, 1);
  assert.equal(runner.runs[0]?.conversation, triggerConversation(trig.id));
  assert.equal(runner.runs[0]?.fresh, true);
  assert.deepEqual(runner.runs[0]?.items.map((i) => i.data.event), ["m1", "m2"]);
  assert.match(runner.runs[0]?.items[0]?.text ?? "", /^\[Trigger: New mail\] Sort it\.\n\nNew email from Dana/);

  await clock.advance(box.everyMs);
  await home.inbox.idle();
  assert.equal(runner.runs.length, 1, "nothing new, nothing delivered");
});

test("a pushed event and the same event from a later poll are delivered once", async (t) => {
  const { home, runner, clock } = openHome(t);
  const box = new FakeMailbox();
  home.triggers.register("mail", box);
  home.inbox.addOrb("juniper", "Juniper");
  const trig = home.triggers.add({ orb: "juniper", name: "New mail", kind: "mail", instruction: "Sort it." });
  home.start();
  await home.inbox.idle();

  box.arrive("m1", clock.now(), "Dana");
  assert.equal(home.triggers.fire(trig.id, box.mail[0]!), true);
  assert.equal(home.triggers.fire(trig.id, box.mail[0]!), false, "a repeat push is ignored");
  await clock.advance(box.everyMs);
  await home.inbox.idle();
  assert.equal(home.events.ofType("trigger.fired").length, 1);
  assert.equal(runner.runs.length, 1);
});

test("a poll that fails keeps the cursor, and the next poll delivers what it missed", async (t) => {
  const { home, runner, clock } = openHome(t);
  const box = new FakeMailbox();
  home.triggers.register("mail", box);
  home.inbox.addOrb("juniper", "Juniper");
  home.triggers.add({ orb: "juniper", name: "New mail", kind: "mail", instruction: "Sort it." });
  home.start();
  await home.inbox.idle();

  box.arrive("m1", clock.now(), "Dana");
  box.down = "IMAP said: try later";
  await clock.advance(box.everyMs);
  await home.inbox.idle();
  assert.equal(runner.runs.length, 0);
  assert.deepEqual(home.events.ofType("trigger.error").map((e) => e.data.error), ["IMAP said: try later"]);

  box.down = null;
  await clock.advance(box.everyMs);
  await home.inbox.idle();
  assert.deepEqual(runner.runs.map((r) => r.items.map((i) => i.data.event)), [["m1"]]);
});

test("a trigger for an unknown kind or orb is refused", (t) => {
  const { home } = openHome(t);
  home.inbox.addOrb("juniper", "Juniper");
  assert.throws(() => home.triggers.add({ orb: "juniper", name: "x", kind: "carrier-pigeon", instruction: "x" }), /no trigger source/);
  home.triggers.register("mail", new FakeMailbox());
  assert.throws(() => home.triggers.add({ orb: "ghost", name: "x", kind: "mail", instruction: "x" }), /no orb called "ghost"/);
});
