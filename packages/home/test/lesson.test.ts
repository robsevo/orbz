// PLAN 4.4_t through the home, on the real kit and a scripted model:
//   - "teach me union find": his teach tool opens Ash's scripted lesson; the door gives it a step
//     at a time; Next moves on, the last one finishes it, Stop ends it;
//   - a lesson drawn for the canvas: the kit asks the home's own brain for its plan (MCP sampling),
//     once, and gets canvas steps;
//   - an answer is judged through the home's brain with what the canvas shows; a judge that could not
//     judge is never praise: the hint is said;
//   - the canvas is served with a policy of its own: its inline script by hash, framed by the app only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { agentHome } from "./helpers.ts";

const PLAN = JSON.stringify({ title: "Binary search", family: "cells", steps: [
  { text: "A sorted row of numbers. We look for 24.", do: [["cells", [3, 8, 12, 19, 24, 31, 40]]] },
  { text: "Look at the middle.", do: [["marks", [[0, "lo"], [3, "mid"], [6, "hi"]]], ["compare", 3, 4]] },
  { text: "24 is bigger, so the left half goes.", do: [["span", 4, 6]] },
  { text: "24 is found.", do: [["found", 4]] },
] });

async function door(t: Parameters<typeof agentHome>[0], home: Awaited<ReturnType<typeof agentHome>>["home"]) {
  const appDir = mkdtempSync(join(tmpdir(), "orbs-lesson-app-"));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));
  const d = await serve(home, { port: 0, appDir });
  t.after(() => d.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, headers: r.headers, text: await r.text() };
  };
  return { call };
}

test("teach me union find: a scripted lesson a step at a time; an answer the judge could not check is never praised", { timeout: 180_000 }, async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "teach", args: { topic: "union find" } }] },
    { chunks: ["It is on the Lesson tab of my computer."] },
  ], { kit: true, agent: { decide: () => "allow" } });
  home.inbox.send("juniper", "chat:1", "teach me union find");
  await home.inbox.idle();
  const c = home.lessons.current("juniper");
  assert.ok(c, "a lesson is going");
  assert.deepEqual([c.lesson.kind, c.lesson.steps.length, c.step], ["scripted", 5, 1]);
  assert.ok(home.conversations.list("chat:1").some((m) => m.role === "notice" && /Lesson tab/.test(m.content)), "the chat says where it is");

  const { call } = await door(t, home);
  const got = JSON.parse((await call("GET", "/orbs/juniper/lesson")).text) as { lesson: { step: number; steps: { question: string; hint: string }[] } };
  assert.equal(got.lesson.step, 1);
  assert.equal(JSON.parse((await call("POST", "/orbs/juniper/lesson/next")).text).lesson.step, 2);

  // the judge: asked of the home's brain by the kit; this brain's words are no verdict, twice
  const asked = model.said.length;
  const j = JSON.parse((await call("POST", "/orbs/juniper/lesson/answer", { answer: "the one being pointed at", facts: { n: 8, groups: [], parent: {}, caption: "", cells: [] } })).text) as { correct: boolean | null; say: string };
  assert.equal(j.correct, null, "could not judge");
  assert.ok(j.say.includes(got.lesson.steps[1]!.hint), "so the hint is said");
  assert.doesNotMatch(j.say, /right|correct|spot on|exactly/i, "and nothing praises it");
  assert.equal(model.said.length - asked, 2, "the kit asked the home's brain, and tried once more");
  assert.equal(home.events.ofType("lesson.noted").length, 0, "an answer that was not judged notes nothing about you");

  // a judged answer: what may be noted about you is noted, and only that
  model.replies.push(JSON.stringify({ correct: true, response: "Spot on. 1 is the root: 0 points at it." }));
  const right = JSON.parse((await call("POST", "/orbs/juniper/lesson/answer", { answer: "1, the one 0 points at", facts: { n: 8, groups: [], parent: { "0": 1 }, caption: "", cells: [] } })).text) as { correct: boolean | null; say: string };
  assert.equal(right.correct, true);
  assert.doesNotMatch(right.say, /^spot on/i, "said without the praise it opened with");
  assert.deepEqual(home.events.ofType("lesson.noted").map((e) => e.data.kind), ["mastery"], "a concept mastered is noted");

  for (let i = 2; i < 5; i++) await call("POST", "/orbs/juniper/lesson/next");
  assert.equal(JSON.parse((await call("POST", "/orbs/juniper/lesson/next")).text).lesson, null, "past the last step it is finished");
  assert.equal(home.lessons.current("juniper"), null);
});

test("a lesson drawn for the canvas: planned once by the home's own brain, through the kit", { timeout: 180_000 }, async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "teach", args: { topic: "how binary search works" } }] },
    { chunks: ["Open the Lesson tab."] },
  ], { kit: true, agent: { decide: () => "allow" } });
  model.replies.push(PLAN);
  home.inbox.send("juniper", "chat:1", "teach me binary search");
  await home.inbox.idle();
  const c = home.lessons.current("juniper");
  assert.ok(c, "a drawn lesson is going");
  assert.deepEqual([c.lesson.kind, c.lesson.title, c.lesson.steps.length], ["canvas", "Binary search", 4]);
  assert.equal(model.said.length, 1, "planned once");
  assert.match(JSON.stringify(model.said[0]), /binary search/i, "the home's brain was asked for this topic");
  const { call } = await door(t, home);
  assert.equal((await call("POST", "/orbs/juniper/lesson/stop")).status, 200);
  assert.equal(home.lessons.current("juniper"), null, "Stop ends it");
});

test("the canvas: Ash's page, its one inline script allowed by its hash, framed by the app only", async (t) => {
  const { home } = await agentHome(t, []);
  const { call } = await door(t, home);
  const r = await call("GET", "/lesson/canvas.html");
  assert.equal(r.status, 200);
  assert.match(r.text, /window\.teach/);
  const csp = r.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/, csp);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /default-src 'none'/);
});
