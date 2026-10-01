// PLAN 1.9_t, the parts a pty test does not reach: the screen model the pty tests read (with its
// controls: a screen that ignored erases or cursor moves would let a desync pass), the bean against
// Ash's own renderer, the splash's width, and which keys a card answers to.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { beanPixels, beanRows, floorRow, PW, ROWS } from "../src/bean.ts";
import { activityLine, cardBody, cardKeys, Transcript } from "../src/app.ts";
import { renderToString } from "ink";
import type { Card, Message } from "../src/client.ts";
import { splashLines, W } from "../src/splash.ts";
import { Screen } from "./screen.ts";

test("the screen model applies what Ink writes: erases, cursor moves, the deferred wrap, scrolling", () => {
  const s = new Screen(10, 3);
  s.feed("hello\r\nworld");
  assert.deepEqual(s.lines(), ["hello", "world", ""]);
  s.feed("\x1b[2K\x1b[1A\x1b[2K\x1b[Gnew"); // Ink's eraseLines(2), then a redraw
  assert.deepEqual(s.lines(), ["new", "", ""], "a model that ignored the erase would still show world");
  s.feed("\r\n\x1b[38;2;1;2;3mcolour\x1b[0m");
  assert.equal(s.lines()[1], "colour", "colours change no text");
  const w = new Screen(4, 2);
  w.feed("abcd\r\nef");
  assert.deepEqual(w.lines(), ["abcd", "ef"], "a full line then a newline is one line down, not two");
  w.feed("\r\ngh");
  assert.deepEqual(w.lines(), ["ef", "gh"], "the bottom line scrolls the screen");
  const split = new Screen(10, 1);
  split.feed("ab\x1b[");
  split.feed("1Dc");
  assert.equal(split.lines()[0], "ac", "an escape split across two reads is still one escape");
  const pos = new Screen(10, 3);
  pos.feed("\x1b[2;3Hx\x1b[1;1Hy\x1b[J");
  assert.deepEqual(pos.lines(), ["y", "", ""], "CSI H moves, CSI J erases from the cursor to the end of the screen");
});

test("the bean is Ash's, pixel for pixel: every face, at rest and mid-hop, and his floor", () => {
  const golden = JSON.parse(readFileSync(new URL("./fixtures/bean-golden.json", import.meta.url), "utf8")) as Record<string, string | string[]>;
  const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
  for (const face of ["open", "blink", "shut", "happy", "none"] as const) {
    for (const lift of [0, 1]) assert.equal(sha(beanRows({ face, lift }).join("\n")), golden[`${face}/${lift}`], `${face}, lift ${lift}`);
  }
  assert.deepEqual(beanRows({ color: false }), golden.plain);
  assert.equal(sha(floorRow()), golden.floor);
  assert.equal(beanRows().length, ROWS);
});

test("no mouth: a face differs from the bare glass only in its two eyes", () => {
  const bare = beanPixels({ face: "none" });
  for (const face of ["open", "blink", "shut", "happy"] as const) {
    const px = beanPixels({ face });
    const changed: [number, number][] = [];
    px.forEach((row, y) => row.forEach((c, x) => (JSON.stringify(c) !== JSON.stringify(bare[y]![x]) ? changed.push([x, y]) : null)));
    assert.ok(changed.length > 0, `control: the ${face} face draws something`);
    const left = changed.filter(([x]) => x < PW / 2).length;
    assert.equal(left, changed.length - left, `${face}: as many pixels left of centre as right of it (two eyes, mirrored)`);
    const rows = new Set(changed.map(([, y]) => y));
    assert.ok(Math.max(...rows) - Math.min(...rows) <= 2, `${face}: the changes fit in the eyes' three rows, so nothing below them (a mouth)`);
  }
});

test("the splash: him and the facts, no line wider than W; without colour he is block characters", () => {
  const facts = { orb: "Juniper", version: "0.0.0", door: "127.0.0.1:41234", online: true, kit: "up", dataDir: "/home/someone/a/very/long/path/to/the/orbs/data/dir", chat: "chat:main · new" };
  const plain = splashLines(facts, { color: false });
  for (const l of plain) assert.ok([...l].length <= W, `${[...l].length} > ${W}: ${l}`);
  assert.match(plain.join("\n"), /Juniper {2}orbs v0\.0\.0/);
  assert.match(plain.join("\n"), /data {4}…/, "a long path is cut from the left, where it says least");
  assert.match(plain.join("\n"), /█/);
  assert.doesNotMatch(plain.join("\n"), /\x1b/);
  const away = splashLines({ ...facts, online: false }, { color: false }).join("\n");
  assert.match(away, /● no answer/);
  assert.match(away, /his home is not answering\./);
  assert.match(splashLines(facts, { color: false, face: "shut" }).join("\n"), /waking up…/);
});

const card = (kind: Card["kind"], meta: Record<string, unknown> = {}): Card => ({ id: 1, orb: "juniper", conversation: "chat:main", kind, tool: "shell", title: "t", detail: "", status: "pending", meta });

test("a card's keys: always only when the home offers it; a plan's four answers; a question is typed", () => {
  assert.deepEqual(cardKeys(card("approval")).map(([k]) => k), ["a", "d"]);
  assert.deepEqual(cardKeys(card("approval", { mayAlways: true })).map(([k, , c]) => `${k}=${c}`), ["a=approve", "d=deny", "y=always"]);
  assert.deepEqual(cardKeys(card("plan", { mayAlways: true })).map(([k, , c]) => `${k}=${c}`), ["a=approve", "c=change", "s=save", "d=deny"]);
  assert.deepEqual(cardKeys(card("question")), []);
});

test("conversation rows: a call is drawn with its result, a card's record waits for its answer, a stopped reply is kept", () => {
  const m = (o: Partial<Message>): Message => ({ id: 7, conversation: "c", orb: "o", run: 1, role: "assistant", content: "", toolCalls: null, toolCallId: null, meta: {}, at: 0, ...o });
  const tr = new Transcript();
  const said = (items: ReturnType<Transcript["items"]>): string[] => items.map((i) => (i.kind === "tool" ? `${i.verb} ${i.what}` : i.kind === "asked" ? `asked:${i.status}` : i.kind));
  assert.deepEqual(said(tr.items(m({ id: 1, content: "Looking.", toolCalls: [{ id: "x", name: "shell", arguments: '{"command":"ls -la"}' }] }))), ["speech"], "the call is not drawn yet");
  assert.deepEqual(tr.running, ["Running", "ls -la"]);
  assert.deepEqual(said(tr.items(m({ id: 2, role: "notice", content: "Juniper wants to run `ls -la`", meta: { card: 5 } }), { 5: "pending" })), [], "an open card's record is held");
  assert.deepEqual(said(tr.answered(5, "approved")), ["asked:approved"]);
  assert.deepEqual(tr.answered(5, "approved"), [], "and given once");
  assert.deepEqual(said(tr.items(m({ id: 3, role: "tool", toolCallId: "x", content: "1\n2\n3\n4\n5" }))), ["Ran ls -la", "result"]);
  assert.equal(tr.running, null);
  const r = tr.items(m({ id: 4, role: "tool", toolCallId: "x", content: "1\n2\n3\n4\n5" }))[1]!;
  assert.equal(r.kind === "result" && r.text, "1\n2\n3\n… 2 more lines", "results are cut to three lines");
  assert.deepEqual(said(tr.items(m({ id: 6, role: "notice", content: "asked", meta: { card: 6 } }), { 6: "denied" })), ["asked:denied"], "an answered card in the history says how");
  assert.deepEqual(tr.items(m({ content: "half a rep", meta: { stopped: true } })), [{ key: "m7", kind: "speech", text: "half a rep", stopped: true }]);
  assert.deepEqual(tr.items(m({ content: "  " })), [], "an empty reply draws nothing");
});

test("an approval card shows the arguments its title does not already say", () => {
  const c = (title: string, args: Record<string, unknown>): Card => ({ ...card("approval"), title, detail: JSON.stringify(args) });
  assert.equal(cardBody(c("Juniper wants to run `ls` in its workspace", { command: "ls" })), "", "the command is in the title");
  assert.equal(cardBody(c("Juniper wants to write notes.md", { path: "notes.md", content: "# Notes\nline" })), "content:\n  # Notes\n  line");
  assert.equal(cardBody({ ...card("question"), detail: "Which colour?" }), "Which colour?", "a question's text is shown as it is");
});

test("the activity line is one line at any width, and always says how to stop", () => {
  for (const columns of [40, 80, 100]) {
    const out = renderToString(activityLine("⠋", ["Running", `echo ${"word ".repeat(40)}`], null, 3, columns), { columns }).replace(/\x1b\[[0-9;]*m/g, "");
    assert.equal(out.split("\n").length, 1, `${columns} columns: ${out}`);
    assert.ok([...out].length <= columns, `${columns} columns: ${[...out].length}`);
    assert.match(out, /^⠋ Running echo word.*… \(3s · esc to stop\)$/);
  }
  const quiet = renderToString(activityLine("⠋", null, "Thinking", 0, 80), { columns: 80 }).replace(/\x1b\[[0-9;]*m/g, "");
  assert.equal(quiet, "⠋ Thinking (0s · esc to stop)");
});
