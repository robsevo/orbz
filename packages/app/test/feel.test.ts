// PLAN 2.1_t, the press you can feel (owner, 2026-10-01: "when i push something, i wanna feel like
// im pushing it, with animations and sound and click but like addicting soft click"), as rendered
// in Chromium:
//   - a button squishes the moment it goes down and springs back when let go;
//   - it sounds on the way down, and the sound fits what was pressed;
//   - few presses sound (owner, 10-07: "fkn limit them please"): a tab, a plain button and a choice
//     already made are silent, by mouse or by key, and a double press is one click;
//   - quick presses climb and fall back, walked on a clock of the test's own;
//   - he reacts to what you choose for him;
//   - the sound switch silences it all, and is remembered.
// Every sound is rendered offline and measured: it is quiet, ramps in without a pop, and is over
// quickly; the clicks are round, not bright, and deep (owner, 10-07: "a deep click. comforting"). A
// planted harsh click fails each of those, and the old wooden "tok" is not deep.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { choose, findChrome, launch, plainNewOrb, profile, seedOffice, serveDir } from "./harness.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let lab: { url: string; close(): Promise<void> };
let out: string;
let labDir: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-feel-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  // the sounds on their own, for the offline measurements
  labDir = mkdtempSync(join(tmpdir(), "orbs-sound-"));
  await build({
    root: APP, configFile: false, logLevel: "silent",
    build: { outDir: labDir, emptyOutDir: true, lib: { entry: join(APP, "src/ui/sound.ts"), formats: ["es"], fileName: () => "sound.js" } },
  });
  writeFileSync(join(labDir, "index.html"), `<!doctype html><script type="module">import * as S from "./sound.js"; window.S = S; window.ready = true;</script>`);
  lab = await serveDir(labDir);
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await site?.close();
  await lab?.close();
  for (const d of [out, labDir]) if (d) rmSync(d, { recursive: true, force: true });
});

type Played = { sound: string; lift: number };

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  await seedOffice(page);
  await page.addInitScript(() => {
    (globalThis as { __orbsTime?: number }).__orbsTime = 3.4;
    (globalThis as { __orbsSounds?: Played[] }).__orbsSounds = [];
  });
  await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
  await page.waitForSelector("canvas", { state: "attached" });
  await profile(page, "Ash"); // the office opens on its floor; the cradle's presses are on an orb's profile
  return page;
}
const played = (page: Page): Promise<Played[]> => page.evaluate(() => [...(globalThis as { __orbsSounds?: Played[] }).__orbsSounds!]);
const clear = (page: Page): Promise<void> => page.evaluate(() => void ((globalThis as { __orbsSounds?: Played[] }).__orbsSounds!.length = 0));

test("a press squishes the moment it goes down, sounds then, and springs back when let go", { skip }, async () => {
  const page = await open();
  try {
    const chip = page.getByRole("button", { name: "Listening" }); // a choice not yet made: one that sounds
    const scale = (): Promise<number> => chip.evaluate((el) => {
      const v = getComputedStyle(el).scale;
      return v === "none" ? 1 : Number.parseFloat(v);
    });
    // waits until the press has settled where it should (a loaded machine runs the 70 ms squish late)
    const settles = (want: (v: number) => boolean): Promise<unknown> => chip.evaluate((el, w) => new Promise<void>((ok, fail) => {
      const t0 = performance.now();
      const look = (): void => {
        const v = getComputedStyle(el).scale;
        const n = v === "none" ? 1 : Number.parseFloat(v);
        if (w === "down" ? n <= 0.945 : n >= 0.999) ok();
        else if (performance.now() - t0 > 3000) fail(new Error(`scale stayed ${v}`));
        else requestAnimationFrame(look);
      };
      look();
    }), want(0.9) ? "down" : "up");
    await chip.hover();
    await page.waitForTimeout(300);
    assert.equal(await scale(), 1, "control: at rest it is its own size");
    await clear(page);
    await page.mouse.down();
    await settles((v) => v < 1);
    assert.ok((await scale()) <= 0.945, "down: squished");
    assert.deepEqual((await played(page)).map((p) => p.sound), ["pick"], "and it sounded already, before the release");
    await page.mouse.up();
    await settles((v) => v >= 1);
    // it springs past its size and back (the spring's overshoot): wait for that to finish too
    await chip.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    assert.equal(await scale(), 1, "up: sprung back");
  } finally {
    await page.close();
  }
});

test("the sound fits the press: a choice clicks, dice roll, he bubbles, creating sings, deleting pops; a tab, a plain button and a choice made are silent", { skip }, async () => {
  const page = await open();
  try {
    // a plain new orb: his shape the bean, on the first page with eight others (from the dice, it
    // could be the one alone on the last page, with nothing else there to press)
    await plainNewOrb(page);
    await page.getByRole("tab", { name: "Personality" }).click(); // off the Shape tab, so pressing it is a change
    await clear(page);
    await page.getByRole("tab", { name: "Shape" }).click(); // silent
    const choice = page.locator('[data-page]:not([hidden]) button[data-pick][aria-pressed="false"]').first(); // one he is not already, on the page shown
    const shape = await choice.getAttribute("data-pick");
    await choice.click();
    await page.waitForTimeout(300); // past the quarter second, so what follows is silent for being chosen
    await page.locator(`[data-page]:not([hidden]) button[data-pick="${shape}"]`).click(); // chosen now: silent
    await page.getByRole("button", { name: "Roll everything" }).click();
    await page.locator("[data-cradle] canvas").first().click(); // the new orb (for the moment of the change, who he was is drawn behind)
    await page.getByRole("textbox", { name: "Name" }).fill("Pip");
    await page.getByRole("button", { name: "Create Pip" }).click();
    await page.getByRole("button", { name: "Let Pip go…" }).click(); // a plain button: silent
    await page.getByRole("button", { name: "Let Pip go", exact: true }).click();
    assert.deepEqual((await played(page)).map((p) => p.sound), ["pick", "roll", "poke", "create", "delete"]);
  } finally {
    await page.close();
  }
});

test("a double press is one click, and a key sounds as a press does: a plain button silent, a choice a click", { skip }, async () => {
  const page = await open();
  try {
    await clear(page);
    // two presses in one go, inside the page: well within the quarter second however busy the machine
    const press = (name: string): Promise<void> => page.evaluate((n) => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === n)!;
      for (let i = 0; i < 2; i++) b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    }, name);
    await press("Listening");
    assert.deepEqual((await played(page)).map((p) => p.sound), ["pick"], "pressed twice at once: one click");
    await press("Hop");
    assert.deepEqual((await played(page)).map((p) => p.sound), ["pick"], "a plain button (a move): silent");
    await clear(page);
    await page.getByRole("button", { name: "Nod" }).focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await played(page), [], "Enter on a plain button: silent");
    await page.waitForTimeout(300); // past the quarter second since the double press
    await page.getByRole("button", { name: "Thinking" }).focus();
    await page.keyboard.press("Enter");
    assert.deepEqual((await played(page)).map((p) => p.sound), ["pick"], "Enter on a choice: a click");
  } finally {
    await page.close();
  }
});

test("the pace, on a clock of the test's own: quick presses climb and fall back; the same sound within a quarter second is one; another sound is its own", { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${lab.url}/index.html`);
    await page.waitForFunction(() => (globalThis as { ready?: boolean }).ready === true);
    const lifts = await page.evaluate(() => {
      const S = (globalThis as unknown as { S: { pace(p: object, s: string, t: number, voice?: number): number | null } }).S;
      const p = { last: {}, pressed: -1e9, streak: 0 };
      const walk: [string, number][] = [["pick", 0], ["pick", 300], ["pick", 600], ["pick", 900], ["pick", 1700], ["pick", 1800], ["delete", 1810], ["pick", 1950], ["blip", 1960], ["blip", 1970]];
      return walk.map(([s, t]) => {
        const l = S.pace(p, s, t, 2);
        return l === null ? null : Math.round(l * 10) / 10;
      });
    });
    assert.deepEqual(lifts, [0, 0.7, 1.4, 2.1, 0, null, 0, 0.7, 2, 2], "a combo, a rest; a double press silent; delete its own; a letter at its own pace, in his voice");
  } finally {
    await page.close();
  }
});

test("he reacts to what you choose for him: a hat, a hop; glasses, a nod; a colour, a wiggle; a shape, a wobble", { skip }, async () => {
  const page = await open();
  try {
    await plainNewOrb(page);
    const gesture = (): Promise<string | null> => page.locator("[data-cradle]").getAttribute("data-gesture");
    const cases: [string, string, string][] = [["Hat", "beret", "hop"], ["Glasses", "aviators", "nod"], ["Shape", "pebble", "jelly"]];
    for (const [tab, pick, want] of cases) {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(350); // past the slider's 300 ms
      await choose(page, pick);
      assert.equal(await gesture(), want, `${tab}: ${pick}`);
    }
    await page.getByRole("tab", { name: "Colour" }).click();
    await page.waitForTimeout(350);
    await page.getByRole("button", { name: "coral", exact: true }).click();
    assert.equal(await gesture(), "wiggle", "a colour");
  } finally {
    await page.close();
  }
});

test("the sound switch silences every press, and the page remembers it", { skip }, async () => {
  const page = await open();
  try {
    // each press a choice not yet made, the kind that sounds
    await page.getByRole("button", { name: "Sounds on" }).click();
    await clear(page);
    await page.getByRole("button", { name: "Listening" }).click();
    assert.deepEqual(await played(page), [], "off: silent");
    await page.reload();
    await page.waitForSelector("canvas", { state: "attached" });
    assert.equal(await page.getByRole("button", { name: "Sounds off" }).count(), 1, "still off after a reload");
    await page.getByRole("button", { name: "Thinking" }).click();
    assert.deepEqual(await played(page), [], "and still silent");
    await page.getByRole("button", { name: "Sounds off" }).click();
    await clear(page); // the switch's own two clicks
    await page.getByRole("button", { name: "Speaking" }).click();
    assert.deepEqual((await played(page)).map((p) => p.sound), ["pick"], "control: on again, it sounds");
  } finally {
    await page.close();
  }
});

test("a move pressed lights up and fades back; pressed again, it lights again; another move takes the light", { skip }, async () => {
  const page = await open();
  try {
    const hop = page.getByRole("button", { name: "Hop" });
    const lit = (b: typeof hop) => b.evaluate((el) => el.getAnimations().map((a) => (a as CSSAnimation).animationName).filter((n) => n?.startsWith("orbs-flash")));
    assert.deepEqual(await lit(hop), [], "at rest: no light");
    await hop.click();
    const first = await lit(hop);
    assert.equal(first.length, 1, "pressed: it lights up");
    assert.match(await hop.evaluate((el) => getComputedStyle(el).boxShadow), /inset/, "with the ring a chosen button wears");
    // within a second by its own clock: what it is set to last, then gone once it has played (a fixed wait of
    // real time read a busy machine's late frames as a light that would not fade, 10-04)
    const lasts = await hop.evaluate((el) => el.getAnimations().filter((a) => (a as CSSAnimation).animationName?.startsWith("orbs-flash")).map((a) => Number(a.effect?.getTiming().duration)));
    assert.ok(lasts.length === 1 && lasts[0]! <= 1000, `it is set to fade within a second (${lasts.join(", ")} ms)`);
    await hop.evaluate((el) => Promise.race([Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 6000))]));
    assert.deepEqual(await lit(hop), [], "and it has faded back");
    await hop.click();
    const again = await lit(hop);
    assert.equal(again.length, 1, "pressed again: lit again");
    assert.notEqual(again[0], first[0], "a fresh run, not the old one held");
    const wink = page.getByRole("button", { name: "Wink" });
    await wink.click();
    assert.deepEqual([await lit(hop), (await lit(wink)).length], [[], 1], "Wink takes the light; Hop's is gone");
  } finally {
    await page.close();
  }
});

type Measured = { sound: string; peak: number; onset: number; tail: number; centroid: number };

test("every sound, rendered and measured: quiet, no pop at the start, over quickly, and the clicks round", { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${lab.url}/index.html`);
    await page.waitForFunction(() => (globalThis as { ready?: boolean }).ready === true);
    const rows = await page.evaluate(async () => {
      type N = { at: number; wave: string; f0: number; f1: number; dur: number; gain: number; attack: number };
      const S = (globalThis as unknown as { S: { recipe(s: string): N[]; schedule(c: BaseAudioContext, o: AudioNode, n: N[], t: number): void; lengthOf(n: N[]): number } }).S;
      const sr = 48000;
      const measure = async (sound: string, notes: N[]): Promise<Measured> => {
        const len = Math.ceil((S.lengthOf(notes) + 0.1) * sr);
        const ctx = new OfflineAudioContext(1, len, sr);
        const t0 = 0.01;
        S.schedule(ctx, ctx.destination, notes, t0);
        const d = (await ctx.startRendering()).getChannelData(0);
        const start = Math.round(t0 * sr);
        let peak = 0;
        for (const x of d) peak = Math.max(peak, Math.abs(x));
        let onset = 0;
        for (let i = start; i < start + Math.round(0.00025 * sr); i++) onset = Math.max(onset, Math.abs(d[i]!));
        let last = start;
        for (let i = start; i < d.length; i++) if (Math.abs(d[i]!) > 0.00316) last = i; // -50 dBFS
        // the spectral centroid of the first 30 ms: how bright it is
        const N = Math.round(0.03 * sr);
        let num = 0, den = 0;
        for (let f = 100; f <= 8000; f += 50) {
          let re = 0, im = 0;
          for (let i = 0; i < N; i++) {
            const a = (2 * Math.PI * f * i) / sr;
            re += d[start + i]! * Math.cos(a);
            im -= d[start + i]! * Math.sin(a);
          }
          const p = re * re + im * im;
          num += f * p;
          den += p;
        }
        return { sound, peak, onset: onset / peak, tail: (last - start) / sr, centroid: num / den };
      };
      const out: Measured[] = [];
      for (const s of ["tap", "tick", "pick", "roll", "create", "delete", "poke", "toggle", "blip"]) out.push(await measure(s, S.recipe(s)));
      // the controls: a planted harsh click, square and loud and sudden and long; and the old wooden tok
      out.push(await measure("harsh", [{ at: 0, wave: "square", f0: 3000, f1: 3000, dur: 0.3, gain: 0.9, attack: 0 }]));
      out.push(await measure("tok", [
        { at: 0, wave: "sine", f0: 540, f1: 335, dur: 0.065, gain: 0.22, attack: 0.0015 },
        { at: 0, wave: "noise", f0: 3200, f1: 3200, dur: 0.01, gain: 0.048, attack: 0.001 },
      ]));
      return out;
    });
    const soft = (m: Measured, longest: number): string[] =>
      [
        m.peak > 0.35 ? `peak ${m.peak.toFixed(2)}: loud` : "",
        m.onset > 0.3 ? `starts at ${(m.onset * 100).toFixed(0)}% of its peak in a quarter millisecond: it pops` : "",
        m.tail > longest ? `rings for ${m.tail.toFixed(3)} s, over ${longest}` : "",
      ].filter(Boolean);
    const LONGEST: Record<string, number> = { tap: 0.04, tick: 0.04, pick: 0.04, roll: 0.4, create: 0.7, delete: 0.2, poke: 0.15, toggle: 0.12, blip: 0.05, harsh: 0.09, tok: 0.09 };
    for (const m of rows.filter((r) => r.sound !== "harsh" && r.sound !== "tok")) assert.deepEqual(soft(m, LONGEST[m.sound]!), [], m.sound);
    for (const s of ["tap", "pick", "poke", "delete"]) {
      const m = rows.find((r) => r.sound === s)!;
      assert.ok(m.centroid < 1500, `${s}: bright, not round (centroid ${m.centroid.toFixed(0)} Hz)`);
    }
    // deep: the clicks' weight under 400 Hz (the tok sat at about 500)
    const deep = (s: string): boolean => rows.find((r) => r.sound === s)!.centroid < 400;
    for (const s of ["tap", "pick", "tick"]) assert.ok(deep(s), `${s}: not deep (centroid ${rows.find((r) => r.sound === s)!.centroid.toFixed(0)} Hz)`);
    assert.ok(!deep("tok"), "control: the old tok is not deep");
    const bad = rows.find((r) => r.sound === "harsh")!;
    assert.equal(soft(bad, LONGEST.harsh!).length, 3, "control: the harsh click fails loud, pop and ring");
    assert.ok(bad.centroid > 1500, "and it is bright");
  } finally {
    await page.close();
  }
});
