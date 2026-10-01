// PLAN 1.9_t: the `orbs` terminal, in a real pseudo-terminal against a real home (the agent loop
// on a scripted model, its door on a random port). A chat goes through it; Esc stops the job in
// under a second and the screen still paints afterwards (Ash's Ink freeze: after a stop the
// session sat at "thinking…" for ever, still reading keys, drawing none of them); a card is
// answered from the keyboard. The controls: each wait is for text the screen did not show before
// the step that should produce it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../../home/src/api.ts";
import type { Home } from "../../home/src/home.ts";
import { agentHome, tempDir } from "../../home/test/helpers.ts";
import type { Turn } from "../../home/test/fakes/model.ts";
import { Pty } from "./pty.ts";

const skip = process.platform === "win32" ? "a pty needs a POSIX terminal (Windows gets ConPTY with the app, PLAN 2.x)" : false;

async function terminal(t: import("node:test").TestContext, script: Turn[], more: Parameters<typeof agentHome>[2] = {}) {
  const h = await agentHome(t, script, more);
  const door = await serve(h.home);
  t.after(() => door.close());
  const pty = await Pty.open(t, ["--data", h.dataDir, "--orb", "juniper"], { env: { ORBS_BOOT: "0" } });
  await pty.waitFor(/Ask Juniper to do anything/);
  return { ...h, pty };
}

const runsEnded = (home: Home): number => home.events.ofType("run.finished").length;

test("a chat goes through the terminal: the splash paints him, a message reaches the orb, the reply streams back", { skip }, async (t) => {
  const { pty, model } = await terminal(t, [{ chunks: ["Hello ", "from ", "the ", "home."], gapMs: 40 }]);
  const splash = pty.raw;
  assert.match(pty.text(), /Juniper\s+orbs v[\d.]+/);
  assert.match(pty.text(), /ready when you are\./);
  assert.match(pty.text(), /home\s+127\.0\.0\.1:\d+\s+● online/);
  assert.ok((splash.match(/\x1b\[38;2;\d+;\d+;\d+m\x1b\[48;2;\d+;\d+;\d+m▀/g) ?? []).length > 100, "he is drawn in truecolor half blocks");
  const before = pty.mark;
  assert.doesNotMatch(pty.text(before), /Hello from the home\./, "control: no reply before the message");
  pty.type("hi there");
  await pty.waitFor(/› hi there/, before);
  pty.type("\r");
  await pty.waitFor(/• Hello from the home\./, before);
  assert.equal(model.agent.length, 1);
  assert.equal(model.agent[0]!.findLast((m) => m.role === "user")?.content, "hi there");
  await pty.onScreen(/Juniper · idle/);
  const screen = pty.screen.text();
  assert.equal(screen.match(/Hello from the home\./g)?.length, 1, `the reply is on the screen once, not as its live copy too:\n${screen}`);
  assert.equal(screen.match(/› hi there/g)?.length, 1, "and so is what was said");
  assert.match(screen, /› Ask Juniper to do anything/, "the prompt is back");
});

test("Esc stops a running command in under a second, and the screen still paints", { skip }, async (t) => {
  const { home, pty } = await terminal(
    t,
    [{ chunks: ["Let me wait."], calls: [{ name: "shell", args: { command: "sleep 30" } }] }, { chunks: ["never reached"] }],
    { agent: { decide: () => "allow" } },
  );
  pty.type("wait for it\r");
  await pty.onScreen(/Running sleep 30 \(\d+s · esc to stop\)/);
  assert.doesNotMatch(pty.screen.text(), /• Ran sleep 30/, "control: no row says it ran while it is still running");
  const ended = runsEnded(home);
  const pressed = Date.now();
  pty.type("\x1b");
  while (runsEnded(home) === ended && Date.now() - pressed < 5000) await new Promise((r) => setTimeout(r, 5));
  const took = Date.now() - pressed;
  assert.ok(took < 1000, `the run ended ${took} ms after Esc`);
  await pty.onScreen(/Stopped by the user\.[\s\S]*Juniper · idle/);
  assert.doesNotMatch(pty.screen.text(), /esc to stop/, "the spinner is gone");
  assert.match(pty.screen.text(), /• Ran sleep 30\n\s+└ \(stopped\)/, "the command's row says it was stopped, once");
  // the screen still paints: what is typed now is drawn, on the prompt line
  pty.type("still here");
  await pty.onScreen(/^› still here$/m, 2000);
});

test("Esc in the middle of a reply keeps the words already written, and the screen still paints", { skip }, async (t) => {
  const { home, pty } = await terminal(t, [{ chunks: ["Thinking ", "about ", "your ", "question"], gapMs: 30, hang: true }]);
  pty.type("tell me something\r");
  await pty.waitFor(/• Thinking about your question/);
  const ended = runsEnded(home);
  const pressed = Date.now();
  pty.type("\x1b");
  while (runsEnded(home) === ended && Date.now() - pressed < 5000) await new Promise((r) => setTimeout(r, 5));
  assert.ok(Date.now() - pressed < 1000, `the run ended ${Date.now() - pressed} ms after Esc`);
  await pty.onScreen(/Stopped by the user\.[\s\S]*Juniper · idle/);
  const kept = home.conversations.list("chat:main").find((m) => m.role === "assistant");
  assert.equal(kept?.content, "Thinking about your question", "the home kept the words");
  assert.equal(pty.screen.text().match(/• Thinking about your question/g)?.length, 1, `and so does the screen, once:\n${pty.screen.text()}`);
  pty.type("go on");
  await pty.onScreen(/^› go on$/m, 2000);
});

test("a card is answered from the keyboard: a only approves, and the run carries on", { skip }, async (t) => {
  const { home, pty } = await terminal(t, [
    { calls: [{ name: "shell", args: { command: "echo approved-run" } }] },
    { chunks: ["It printed approved-run."] },
  ]);
  pty.type("run the echo\r");
  await pty.waitFor(/Juniper wants to run `echo approved-run`/);
  await pty.waitFor(/\[a\] approve\s+\[d\] deny/);
  const card = home.conversations.openCard("chat:main")!;
  const at = pty.mark;
  pty.type("x"); // not a key this card answers to
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(home.conversations.openCard("chat:main")?.id, card.id, "control: another key answers nothing");
  assert.doesNotMatch(pty.text(), /• Ran echo approved-run/, "control: nothing says it ran before it was approved");
  pty.type("a");
  await pty.waitFor(/└ approved-run/, at);
  await pty.waitFor(/• It printed approved-run\./, at);
  assert.equal(home.conversations.list("chat:main").filter((m) => m.role === "tool").length, 1);
  // the record of the card says how it was answered, and stands before what it let run
  await pty.onScreen(/\? Juniper wants to run `echo approved-run` in its workspace · you approved\n\n• Ran echo approved-run\n\s+└ approved-run/);
});

test("a long row wraps as a sentence under itself, never through a word", { skip }, async (t) => {
  const long = `echo ${"word ".repeat(30).trim()}`;
  const { pty } = await terminal(t, [{ calls: [{ name: "shell", args: { command: long } }] }, { chunks: ["done"] }]);
  pty.type("say many words\r");
  await pty.waitFor(/\[a\] approve/);
  pty.type("a");
  // the committed rows, not "• done": that can be the reply's live copy, drawn before they land
  await pty.onScreen(/• Ran echo[\s\S]*└ word[\s\S]*• done[\s\S]*Juniper · idle/);
  const rows = pty.screen.lines();
  const asked = rows.findIndex((l) => l.startsWith("  ? Juniper wants to run"));
  assert.ok(asked >= 0, pty.screen.text());
  // under its first word; Ink's wrap keeps the space it broke at when a line fills exactly, so one more is allowed
  assert.match(rows[asked + 1]!, /^ {4,5}\S/, `the record's second line hangs under its first word:\n${pty.screen.text()}`);
  assert.ok(rows.every((l) => [...l].length <= 100 && !/(\bwor|workspac)$/.test(l)), `no word is split across two lines:\n${pty.screen.text()}`);
  const ran = rows.findIndex((l) => l.startsWith("• Ran echo"));
  assert.ok(ran >= 0, `the command's row is on the screen:\n${pty.screen.text()}`);
  assert.match(rows[ran + 1]!, /^ {2,3}word/, `and so does a long command's row:\n${pty.screen.text()}`);
});

test("with no home on the data directory the terminal says how to start one, and exits 3", { skip }, async (t) => {
  const pty = await Pty.open(t, ["--data", tempDir(t)]);
  assert.equal(await pty.exited, 3);
  assert.match(pty.text(), /no home is running on .* start one with `pnpm start --data /);
});
