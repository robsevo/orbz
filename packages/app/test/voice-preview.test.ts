// PLAN 2.2_t, a voice heard before it is chosen (owner, 2026-10-02: "when user presses on a voice
// when creating their orb, we preview it"):
//   - Every voice the creator offers (but Silent) has its sample beside the app, a short clip, and
//     Whisper heard its line in it when it was rendered (tools/voice_samples.json).
//   - Pressing a voice picks it and plays its sample at his personality's pace, the pitch kept; a
//     second press stops the first; Silent plays nothing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { findChrome, launch, serveDir } from "./harness.ts";
import { PERSONALITIES, VOICES } from "../src/orb/spec.ts";
import { sampleOf } from "../src/orb/preview.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-voices-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

test("every voice has its sample: a short clip, its line heard in it when it was made", () => {
  const heard = JSON.parse(readFileSync(join(APP, "tools", "voice_samples.json"), "utf8")) as Record<string, { line: string; heard: string; alike: number; kept: boolean }>;
  const missing: string[] = [];
  for (const v of VOICES.filter((x) => x.kokoro !== null)) {
    const file = join(APP, "public", sampleOf(v.id));
    if (!existsSync(file)) {
      missing.push(v.id);
      continue;
    }
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
    assert.ok(seconds > 0.8 && seconds < 8, `${v.id}: ${seconds} s is a sample, not silence or a speech`);
    assert.ok(heard[v.id]?.kept && heard[v.id]!.alike >= 0.6, `${v.id}: heard saying its line (${JSON.stringify(heard[v.id])})`);
  }
  assert.deepEqual(missing, [], "a voice without its sample is a press that says nothing");
  assert.ok(!existsSync(join(APP, "public", sampleOf("silent"))), "Silent says nothing");
});

test("pressing a voice plays it at his pace; the next press stops it; Silent plays nothing", { skip, timeout: 90_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    // every sample played, and stopped, as the page asks
    await page.addInitScript(() => {
      const w = globalThis as unknown as { __played: { src: string; rate: number; pitch: boolean }[]; __paused: string[] };
      w.__played = [];
      w.__paused = [];
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        w.__played.push({ src: this.src, rate: this.playbackRate, pitch: this.preservesPitch });
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
        w.__paused.push(this.src);
      };
    });
    await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
    await page.getByRole("button", { name: "New orb" }).first().click();
    await page.getByRole("button", { name: /^Dapper/ }).click();
    await page.getByRole("tab", { name: "Voice" }).click();
    // only graded voices are offered (owner, 10-03): no D or F voice, not Whisper (af_nicole), none called female or male
    for (const gone of ["am_adam", "am_santa", "af_jessica", "bm_lewis", "af_nicole"]) assert.equal(await page.locator(`button[data-voice="${gone}"]`).count(), 0, `${gone} is not offered`);
    assert.doesNotMatch(await page.locator("body").innerText(), /\b(fe)?male\b/i, "no voice is called female or male");
    const fable = page.locator('button[data-voice="bm_fable"]').first();
    const served = page.waitForResponse((r) => r.url().endsWith("/voices/bm_fable.mp3"));
    await fable.click();
    assert.equal(await fable.getAttribute("aria-pressed"), "true", "the press picks him");
    const played = async () => page.evaluate(() => (globalThis as unknown as { __played: { src: string; rate: number; pitch: boolean }[] }).__played);
    const [first] = await played();
    assert.ok(first?.src.endsWith("/voices/bm_fable.mp3"), `his sample (${first?.src})`);
    assert.equal(first!.rate, PERSONALITIES.dapper.speed, "at a dapper orb's pace");
    assert.equal(first!.pitch, true, "the pitch kept");
    assert.equal((await served).status(), 200, "and the sample is there to play");

    await page.locator('button[data-voice="af_heart"]').first().click();
    assert.deepEqual((await played()).map((p) => p.src.split("/").at(-1)), ["bm_fable.mp3", "af_heart.mp3"]);
    const paused = await page.evaluate(() => (globalThis as unknown as { __paused: string[] }).__paused);
    assert.ok(paused.some((s) => s.endsWith("/voices/bm_fable.mp3")), "the first stopped when the next began");

    await page.locator('button[data-voice="silent"]').first().click();
    assert.equal((await played()).length, 2, "Silent plays nothing");
  } finally {
    await page.close();
  }
});
