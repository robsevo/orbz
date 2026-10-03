// PLAN 4.3_t's view: a private chat by voice, on a real home with the real kit and a scripted model,
// Chromium's microphone playing a recording the kit made (Kokoro, never anyone's real voice):
//   - press the microphone, speak, press it again: what you said is your message, without the
//     "hey Hazel" in front;
//   - his reply is spoken in his voice while he works on, and one Stop silences him at once (the
//     phrases queued never play) and ends his run;
//   - hands-free: his name wakes him, and what you say next is your message;
//   - nothing spills at phone size with the microphone in the row.
// PLAN 4.7_t, a real conversation, the same way (the microphone plays Kokoro's lines and quiet):
//   - his name once: the next turns need no name, each your message, marked as said; a quiet spell
//     ends the conversation and his name is wanted again; he leans in when called;
//   - over him: an "mhm" lets him go on, "wait, what about the sun?" stops him, and is your message;
//   - what Whisper cannot make out is "didn't catch that", in his voice, and never a message.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test, type TestContext } from "node:test";
import { build } from "vite";
import type { Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { fakeModel, type Turn } from "../../home/test/fakes/model.ts";
import { ALOUD } from "../../home/src/agent/standing.ts";

const LONG = { timeout: 300_000 };
const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-voice-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
});
after(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
});

type Said = { kind: string; at: number; text?: string; seconds?: number };

/** A WAV of Kokoro's lines and seconds of quiet, in order, at Kokoro's 24 kHz: what the microphone
 * says. A line given as `{ backwards }` is played reversed (speech no one can make out). */
async function recording(h: Home, parts: (string | number | { backwards: string })[], voice = "bf_emma"): Promise<Buffer> {
  const pcm: Buffer[] = [];
  for (const p of parts) {
    if (typeof p === "number") {
      pcm.push(Buffer.alloc(Math.round(p * 24000) * 2));
      continue;
    }
    const said = (await h.kit!.call("voice_say", { phrase: typeof p === "string" ? p : p.backwards, voice, speed: 1 })) as { wav: string };
    const data = Buffer.from(said.wav, "base64").subarray(44); // Kokoro's WAV: a 44-byte header, then 16-bit mono
    if (typeof p === "string") pcm.push(data);
    else {
      const back = Buffer.alloc(data.length);
      for (let i = 0; i + 1 < data.length; i += 2) back.writeInt16LE(data.readInt16LE(i), data.length - 2 - i);
      pcm.push(back);
    }
  }
  const body = Buffer.concat(pcm);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(36 + body.length, 4);
  head.write("WAVEfmt ", 8, "latin1");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(24000, 24);
  head.writeUInt32LE(48000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "latin1");
  head.writeUInt32LE(body.length, 40);
  return Buffer.concat([head, body]);
}

/** A home with the kit and a scripted model, a browser whose microphone says `line` (or a recording
 * of lines and quiet), a page in Hazel's private chat. */
async function talking(t: TestContext, line: string | (string | number | { backwards: string })[], script: Turn[], size = { width: 1280, height: 900 }) {
  const model = await fakeModel(t, script);
  const data = mkdtempSync(join(tmpdir(), "orbs-voice-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null, kit: true,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { decide: () => "allow", passWaitMs: 20 },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "data", { shape: "bean", eyes: "classic", hue: "amber", voice: "af_heart", personality: "steady" });
  // the microphone's words, in a voice of Kokoro's (and, for a conversation, quiet between them)
  const clip = join(data, "mic.wav");
  writeFileSync(clip, await recording(h, typeof line === "string" ? [line] : line));
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const browser = await launch(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${clip}%noloop`, "--autoplay-policy=no-user-gesture-required"]);
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: size, colorScheme: "dark", permissions: ["microphone"] });
  await ctx.addInitScript(() => {
    const said: { kind: string; at: number }[] = [];
    (globalThis as { __orbsSpeech?: unknown[] }).__orbsSpeech = said; // what he says, and every stop, kept for the test
    (globalThis as { __orbsEars?: unknown[] }).__orbsEars = []; // and what his ears asked and were told
    // the moment your finger goes down on Stop, stamped by the page itself: the 300 ms are the app's,
    // not the time Playwright takes to land its click on a busy machine
    document.addEventListener("pointerdown", (e) => {
      const b = (e.target as Element | null)?.closest?.("button");
      if (b?.textContent?.trim() === "Stop") said.push({ kind: "pressed", at: performance.now() });
      if (b?.textContent?.trim() === "Hands-free") said.push({ kind: "listening", at: performance.now() }); // the microphone starts its recording now
    }, true);
  });
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 }); // the app is up (at phone size the side menu, with the CEO badge, is folded away)
  await page.evaluate(() => (location.hash = "#/chat/hazel"));
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });
  return { h, page, model };
}

const speech = (page: Page): Promise<Said[]> => page.evaluate(() => (globalThis as { __orbsSpeech?: Said[] }).__orbsSpeech ?? []);

test("press to talk; his reply spoken while he works; one Stop silences him at once and ends his run", { skip, ...LONG }, async (t) => {
  const { h, page } = await talking(t, "Hey Hazel, what is two and two?", [
    // he answers, and works on (a long command): Stop must silence him AND end that run
    { chunks: ["Four. Two and two make four, as they always have. Now let me check something else for you, which will take a little while."], calls: [{ name: "shell", args: { command: "sleep 30" } }] },
    { chunks: ["never reached"] },
  ]);
  await page.getByRole("button", { name: "Talk to Hazel" }).click();
  await page.waitForTimeout(4500); // the microphone says its line
  await page.getByRole("button", { name: "Send what you said" }).click();
  const mine = page.locator('[data-from="you"]').first();
  await mine.waitFor({ timeout: 60_000 });
  assert.match(await mine.innerText(), /(two|2) and (two|2)/i, "what you said is your message (Whisper may write the numbers)");
  assert.doesNotMatch(await mine.innerText(), /hey hazel/i, "without the call in front of it");

  for (let i = 0; i < 300 && !(await speech(page)).some((s) => s.kind === "phrase"); i++) await page.waitForTimeout(100);
  const first = (await speech(page)).find((s) => s.kind === "phrase");
  assert.ok(first, "his reply is spoken");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForTimeout(1500);
  const after = await speech(page);
  const pressed = after.find((s) => s.kind === "pressed");
  const stopped = after.find((s) => s.kind === "stopped");
  assert.ok(pressed, "the press on Stop was seen");
  assert.ok(stopped && stopped.at - pressed.at < 300, `silenced within 300 ms of the press (${stopped ? Math.round(stopped.at - pressed.at) : "never"} ms)`);
  assert.equal(after.filter((s) => s.kind === "phrase" && s.at > stopped!.at).length, 0, "no queued phrase plays after the stop");
  // and the phrase that was sounding is cut, not let finish: it stops sounding at once
  const playing = after.filter((s) => s.kind === "phrase" && s.at <= stopped!.at).at(-1) as Said & { seconds: number };
  const cut = after.find((s) => s.kind === "ended" && s.at >= stopped!.at);
  assert.ok(playing && playing.seconds > 1, `the phrase sounding was long enough to tell (${playing?.seconds} s)`);
  assert.ok(cut && cut.at - stopped!.at < 300, `the phrase sounding is cut at once (${cut ? Math.round(cut.at - stopped!.at) : "never"} ms)`);
  await h.inbox.idle();
  const runs = h.events.ofType("run.finished").map((e) => (e.data as { outcome?: string }).outcome);
  assert.ok(runs.includes("stopped"), `and his run was ended (${runs.join(", ")})`);
});

test("hands-free: his name wakes him, and what you say then is your message, however slow the answer; nothing spills at phone size", { skip, ...LONG }, async (t) => {
  const { page } = await talking(t, "Hey Hazel. What is on my calendar today?", [{ chunks: ["Nothing yet."] }], { width: 390, height: 844 });
  assert.deepEqual(await measure(page), [], "the microphone fits the row at phone size");
  // a slow answer to "was that his name?" (a busy box, a phone far away) must not cut the start of
  // your turn: the turn begins where the clip was cut, not where the answer came back
  await page.route("**/voice/woken", async (route) => {
    const r = await route.fetch();
    await new Promise((ok) => setTimeout(ok, 2500));
    await route.fulfill({ response: r });
  });
  await page.getByRole("button", { name: "Hands-free" }).click();
  const mine = page.locator('[data-from="you"]').first();
  await mine.waitFor({ timeout: 90_000 });
  assert.match(await mine.innerText(), /calendar/i, "after his name, your words are your message");
  assert.doesNotMatch(await mine.innerText(), /hey hazel/i, "without his name in front");
});

const mine = (page: Page): Promise<string[]> => page.locator('[data-from="you"]').allInnerTexts();
const earsLog = async (page: Page): Promise<string> => JSON.stringify(await page.evaluate(() => (globalThis as { __orbsEars?: unknown[] }).__orbsEars ?? []));
const earsSay = (page: Page): Promise<string> => page.locator("[data-ears]").innerText();

test("a real conversation: his name once, then turns with no name; a quiet spell ends it", { skip, ...LONG }, async (t) => {
  const { h, page, model } = await talking(t, ["Hey Hazel. What is two and two?", 9, "And three and three?", 9, "What about the weekend?"], [{ chunks: ["Four."] }, { chunks: ["Six."] }, { chunks: ["Free, both days."] }]);
  await page.getByRole("button", { name: "Hands-free" }).click();
  for (let i = 0; i < 900 && (await mine(page)).length < 3; i++) await page.waitForTimeout(100);
  const said = await mine(page);
  assert.equal(said.length, 3, `three turns, one message each: ${JSON.stringify(said)}\n${await earsLog(page)}`);
  assert.match(said[0]!, /(two|2) and (two|2)/i);
  assert.doesNotMatch(said[0]!, /hey hazel/i, "the call is not part of what you said");
  assert.match(said[1]!, /three/i, "the second turn: no name needed");
  assert.match(said[2]!, /weekend/i, "nor the third");
  assert.ok(h.inbox.queued("hazel").length === 0, "each was sent as it was said");
  assert.ok(model.agent.length === 3 && model.agent.every((m) => String((m[0] as { content?: unknown }).content).includes(ALOUD)), "each marked as said: he answers for the ear");
  assert.match(await earsSay(page), /Talking with Hazel/, "in a conversation");
  assert.ok(Number(await page.locator("[data-cues]").getAttribute("data-cues")) >= 1, "he leaned in when called");
  // the quiet spell: after it, his name is wanted again
  await page.waitForFunction(() => /Say “hey Hazel”/.test(document.querySelector("[data-ears]")?.textContent ?? ""), undefined, { timeout: 60_000 });
});

test("over him: an 'mhm' lets him go on; 'wait, what about the sun?' stops him and is your next message", { skip, ...LONG }, async (t) => {
  const moon = "The moon is about three hundred and eighty thousand kilometres away. It turns once each time it goes round us, so we always see the same face. Its pull makes the tides. Its craters are the scars of old impacts, kept because there is no air or weather to wear them down. People first walked on it in nineteen sixty nine. The far side is not dark, only far. It is slowly drifting away from us, a few centimetres each year. Its light is the sun's, thrown back.";
  const { page } = await talking(t, ["Hey Hazel. Tell me about the moon.", 12, "Mhm.", 7, "Wait, what about the sun?"], [{ chunks: [moon] }, { chunks: ["The sun is a star."] }]);
  await page.getByRole("button", { name: "Hands-free" }).click();
  for (let i = 0; i < 900 && (await mine(page)).length < 2; i++) await page.waitForTimeout(100);
  const said = await mine(page);
  assert.equal(said.length, 2, `your question, then what you said over him: ${JSON.stringify(said)}`);
  assert.match(said[1]!, /sun/i, `what you said over him is your next message: ${JSON.stringify(said)}\n${await earsLog(page)}`);
  const log = await speech(page);
  const from = log.find((s) => s.kind === "listening")!.at; // the microphone's recording starts here
  const stops = log.filter((s) => s.kind === "stopped");
  assert.equal(stops.length, 1, `stopped once: by the sentence, not by the 'mhm'\n${await earsLog(page)}`);
  assert.ok(stops[0]!.at - from > 17_000, `not before your sentence (${Math.round((stops[0]!.at - from) / 1000)} s in; the 'mhm' was at about 15 s)\n${await earsLog(page)}`);
  assert.ok(!log.some((s) => s.kind === "done" && s.at < stops[0]!.at), `he talked through the 'mhm': his reply was not over when your sentence stopped it\n${await earsLog(page)}`);
  // and it was your sentence that stopped him, at once: not his next reply, which would stop the
  // old one too, a breath later (a page that ignored you passed without this)
  const heard = (await page.evaluate(() => (globalThis as { __orbsEars?: { act?: string; at: number }[] }).__orbsEars ?? [])).find((e) => e.act === "interrupt");
  assert.ok(heard && stops[0]!.at - heard.at < 600, `stopped within 0.6 s of your sentence (${heard ? Math.round(stops[0]!.at - heard.at) : "no interruption"} ms)`);
  assert.ok((await earsLog(page)).includes('"answer":"overlap","kind":"backchannel"'), `the 'mhm' was heard as one\n${await earsLog(page)}`);
});

test("what no one could make out is 'didn't catch that', in his voice, and never a message", { skip, ...LONG }, async (t) => {
  const { page, model } = await talking(t, ["Hey Hazel.", 3, { backwards: "What is on my calendar today and tomorrow? Can you book me a table for two at seven tonight?" }], [{ chunks: ["never asked"] }]);
  await page.getByRole("button", { name: "Hands-free" }).click();
  for (let i = 0; i < 600 && !(await speech(page)).some((s) => s.kind === "phrase"); i++) await page.waitForTimeout(100);
  const phrases = (await speech(page)).filter((s) => s.kind === "phrase").map((s) => s.text ?? "");
  assert.ok(phrases.some((p) => /catch that|say that again|missed that/i.test(p)), `he says he did not catch it: ${JSON.stringify(phrases)}`);
  assert.deepEqual(await mine(page), [], "nothing was sent");
  assert.equal(model.agent.length, 0, "and his brain was never asked");
});
