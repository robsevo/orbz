// The office floor on a real home, with a scripted brain (owner, 10-05: "the office should be a whole office
// visual of them working in an office ... they sit at their desks"; "when we press on the orb it goes to
// their profile w stats and all"):
//   - the office opens on the floor, every orb on it, nothing spilling at desk and phone sizes;
//   - an orb whose run is going walks to its own desk, in its department, and sits there; what it says
//     shows over it as it says it, and the dashboard says it is working;
//   - an orb in a Brainstorm walks to the meeting table, and the meeting room's screen names the session;
//   - pressing an orb opens its profile.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";
import { viewRect } from "../src/floor/plan.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-floor-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

/** Waits until the orb on the floor is headed somewhere matching `at`, and is there. */
async function arrives(page: Page, name: string, at: RegExp): Promise<string> {
  const handle = await page.waitForFunction(
    ({ name, at }) => {
      const b = document.querySelector(`[data-floor-orb="${name}"]`);
      const where = b?.getAttribute("data-at") ?? "";
      return new RegExp(at).test(where) && b?.getAttribute("data-arrived") === "true" ? where : null;
    },
    { name, at: at.source },
    { timeout: 60_000 },
  );
  return String(await handle.jsonValue());
}

test("the office is the floor: an orb at work at its desk, a Brainstorm at the meeting table, an orb pressed opens its profile", { skip, timeout: 240_000 }, async (t) => {
  let releaseGus!: () => void;
  let releaseAda!: () => void;
  const gusHeld = new Promise<void>((r) => (releaseGus = r));
  const adaHeld = new Promise<void>((r) => (releaseAda = r));
  const model = await fakeModel(t, [
    { chunks: ["On it: ", "checking the build now."], hold: gusHeld }, // Gus, in his chat, held open while we look
    { chunks: ["A launch party, ", "with demos."], hold: adaHeld }, // Ada, in the Brainstorm
  ]);
  const data = mkdtempSync(join(tmpdir(), "orbs-floor-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { passWaitMs: 20 },
  });
  t.after(() => {
    releaseGus();
    releaseAda();
    h.close();
  });
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "mint" });
  h.inbox.addOrb("gus", "Gus", "devops", { shape: "bean", eyes: "classic", hue: "cornflower" });
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "amber" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate(() => (location.hash = "#/office"));
    await page.locator("[data-floor] [data-floor-orb]").first().waitFor({ timeout: 30_000 });
    return page;
  };
  const page = await open({ width: 1280, height: 900 });
  assert.deepEqual((await page.locator("[data-floor-orb]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-floor-orb")))).sort(), ["Ada", "Gus", "Pip"], "every orb on the floor");
  await page.waitForTimeout(600);
  assert.deepEqual(await measure(page), [], "the floor, at desk size");

  // Gus's run goes on: he walks to his own desk, in Build, and sits there
  h.inbox.send("gus", "chat:gus", "is the build green?");
  const gusAt = await arrives(page, "Gus", /^desk:build\d$/);
  assert.match(gusAt, /^desk:build/, "his own desk, in his department");
  await page.locator('[data-floor] [data-speech]').filter({ hasText: "checking the build" }).waitFor({ timeout: 20_000 });
  assert.match(await page.locator('[data-stat="Working"]').innerText(), /^1\s*Working/, "the dashboard counts him working");
  assert.match(await page.locator('[data-who="Gus"]').innerText(), /Gus\s+(Thinking|Working)/);

  // a Brainstorm: Ada walks to the meeting table, and the screen says what it is
  const s = h.team.create("Plan the launch", { brainstorm: ["ada"] });
  h.team.say(s.id, "brainstorm", "ideas for the launch?");
  await arrives(page, "Ada", /^meeting:\d$/);
  await page.locator("[data-meeting-screen]").filter({ hasText: "Now: Plan the launch" }).waitFor({ timeout: 20_000 });
  assert.match(await page.locator('[data-stat="In a meeting"]').innerText(), /^1/);
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "the floor at work, at desk size");

  // and on a phone: the same floor, nothing spilling
  const phone = await open({ width: 390, height: 844 });
  await phone.waitForTimeout(600);
  assert.deepEqual(await measure(phone), [], "the floor, at phone size");

  // pressing an orb opens its profile. Pressed where it stands the moment it arrives: under the gate's
  // load it could set off again before Playwright saw two still frames, and a click that waits for a still
  // target then never came (10-06, twice); a press that misses a walking orb is tried again
  const floorAt = await page.evaluate(() => location.hash);
  for (let i = 0; ; i++) {
    await arrives(page, "Pip", /./);
    await page.locator('[data-floor-orb="Pip"]').click({ force: true, timeout: 5_000 }).catch(() => {});
    const opened = await page.waitForFunction(() => location.hash === "#/office/Pip", undefined, { timeout: 2_000 }).then(() => true, () => false);
    if (opened) break;
    assert.ok(i < 10, "Pip opened on a press");
    // a press that missed may have opened something else on the floor: back to the floor
    if ((await page.evaluate(() => location.hash)) !== floorAt) {
      await page.evaluate((h) => (location.hash = h || "#/office"), floorAt);
      await page.locator("[data-floor]").waitFor({ timeout: 10_000 });
    }
  }
  await page.locator(".orbs-sheet").filter({ hasText: "Pip" }).waitFor({ timeout: 10_000 });
  assert.match(await page.locator(".orbs-sheet").innerText(), /Pip[\s\S]*Personal Assistant[\s\S]*Traits/i, "its profile, stats and all");
  // and The office goes back to the floor
  await page.getByRole("button", { name: "The office", exact: true }).click();
  await page.locator("[data-floor]").waitFor({ timeout: 10_000 });

  releaseGus();
  releaseAda();
});

test("on a phone the office goes room by room: it opens on the busiest department, a chip takes it to any room, the choice is kept; a desk shows it whole", { skip, timeout: 200_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-floor-rooms-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  // two in Build, one in Life: Build is the busiest
  h.inbox.addOrb("gus", "Gus", "devops", { shape: "bean", eyes: "classic", hue: "cornflower" });
  h.inbox.addOrb("tad", "Tad", "frontend", { shape: "bean", eyes: "classic", hue: "violet" });
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "mint" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, isMobile: true });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/office")); // the app opens on the home page (10-07)
  await page.locator("[data-floor-plan]").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const at = () => page.evaluate(() => {
    const v = document.querySelector<HTMLElement>("[data-floor-view]")!;
    const plan = document.querySelector<HTMLElement>("[data-floor-plan]")!;
    return { room: v.getAttribute("data-viewport"), left: v.scrollLeft, top: v.scrollTop, k: plan.clientWidth / 1200, w: v.clientWidth, h: v.clientHeight };
  });
  await page.locator('[data-view-choice="build"][aria-pressed="true"]').waitFor();
  let a = await at();
  // Build is { x: 12, y: 352, w: 360, h: 196 }, shown with floor round it (owner, 10-07: "a little too zoomed in on
  // the rooms"): 50 to each side, the window moved in at the floor's left edge, 30 above and below, 18 more for the names
  const onBuild = viewRect("build")!;
  assert.deepEqual(onBuild, { x: 0, y: 304, w: 460, h: 274 });
  assert.equal(a.room, "room");
  assert.ok(Math.abs(a.left - onBuild.x * a.k) <= 1 && Math.abs(a.top - onBuild.y * a.k) <= 1, `the window on Build (${JSON.stringify(a)})`);
  assert.ok(Math.abs(onBuild.w * a.k - a.w) <= 1, "the window the width of the screen");
  assert.ok(360 * a.k <= 0.8 * a.w, `Build at most four fifths of it, floor round it (${Math.round(360 * a.k)} of ${a.w})`);
  assert.deepEqual(await measure(page), [], "nothing spills, a room at a time");
  // the kitchen
  await page.locator('[data-view-choice="kitchen"]').click();
  await page.waitForTimeout(300);
  a = await at();
  // at the floor's right edge: moved in, not shrunk, so the kitchen has the same floor round it
  const onKitchen = viewRect("kitchen")!;
  assert.deepEqual(onKitchen, { x: 708, y: 36, w: 492, h: 294 });
  assert.ok(Math.abs(a.left - onKitchen.x * a.k) <= 1 && Math.abs(a.top - onKitchen.y * a.k) <= 1, `the window on the kitchen (${JSON.stringify(a)})`);
  // kept on this device
  await page.reload();
  await page.locator('[data-view-choice="kitchen"][aria-pressed="true"]').waitFor({ timeout: 30_000 });
  // the whole office: the floor as before, wider than the screen and swiped
  await page.locator('[data-view-choice="all"]').click();
  await page.waitForTimeout(300);
  a = await at();
  assert.equal(a.room, null);
  assert.equal(await page.locator("[data-floor-view]").evaluate((el) => getComputedStyle(el).overflowX), "auto", "swiped, as before");
  // a desk shows it whole: no chips
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" })).newPage();
  await desk.goto(d.pairLink());
  await desk.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await desk.evaluate(() => (location.hash = "#/office"));
  await desk.locator("[data-floor-plan]").waitFor({ timeout: 30_000 });
  assert.equal(await desk.locator("[data-view-choice]").count(), 0);
  await desk.context().close();
});
