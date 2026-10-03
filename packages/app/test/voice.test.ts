// PLAN 4.3_t's view: a private chat by voice, on a real home with the real kit and a scripted model,
// Chromium's microphone playing a recording the kit made (Kokoro, never anyone's real voice):
//   - press the microphone, speak, press it again: what you said is your message, without the
//     "hey Hazel" in front;
//   - his reply is spoken in his voice while he works on, and one Stop silences him at once (the
//     phrases queued never play) and ends his run;
//   - hands-free: his name wakes him, and what you say next is your message;
//   - nothing spills at phone size with the microphone in the row.
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

/** A home with the kit and a scripted model, a browser whose microphone says `line`, a page in
 * Hazel's private chat. */
async function talking(t: TestContext, line: string, script: Turn[], size = { width: 1280, height: 900 }) {
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
  // the microphone's words, in a voice of Kokoro's, a breath of quiet after them
  const said = (await h.kit!.call("voice_say", { phrase: line, voice: "bf_emma", speed: 1 })) as { wav: string };
  const clip = join(data, "mic.wav");
  writeFileSync(clip, Buffer.from(said.wav, "base64"));
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const browser = await launch(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${clip}%noloop`, "--autoplay-policy=no-user-gesture-required"]);
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: size, colorScheme: "dark", permissions: ["microphone"] });
  await ctx.addInitScript(() => {
    const said: { kind: string; at: number }[] = [];
    (globalThis as { __orbsSpeech?: unknown[] }).__orbsSpeech = said; // what he says, and every stop, kept for the test
    // the moment your finger goes down on Stop, stamped by the page itself: the 300 ms are the app's,
    // not the time Playwright takes to land its click on a busy machine
    document.addEventListener("pointerdown", (e) => {
      const b = (e.target as Element | null)?.closest?.("button");
      if (b?.textContent?.trim() === "Stop") said.push({ kind: "pressed", at: performance.now() });
    }, true);
  });
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 }); // the app is up (at phone size the side menu, with the CEO badge, is folded away)
  await page.evaluate(() => (location.hash = "#/chat/hazel"));
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });
  return { h, page };
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
