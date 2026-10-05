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

  // pressing an orb opens its profile (once it stands still: the test's clicks wait for a still target)
  await arrives(page, "Pip", /./);
  await page.locator('[data-floor-orb="Pip"]').click();
  await page.waitForFunction(() => location.hash === "#/office/Pip", undefined, { timeout: 10_000 });
  await page.locator(".orbs-sheet").filter({ hasText: "Pip" }).waitFor({ timeout: 10_000 });
  assert.match(await page.locator(".orbs-sheet").innerText(), /Pip[\s\S]*Personal Assistant[\s\S]*Traits/i, "its profile, stats and all");
  // and The office goes back to the floor
  await page.getByRole("button", { name: "The office", exact: true }).click();
  await page.locator("[data-floor]").waitFor({ timeout: 10_000 });

  releaseGus();
  releaseAda();
});
