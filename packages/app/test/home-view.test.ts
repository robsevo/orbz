// PLAN 2.18_t's view, the home page (owner, 10-07: "a nice home page the app can default to with the same logo and
// splash on it with a nice dashboard and stats ... placed well, organized"), on a real home, at desk and phone sizes:
//   - the app opens on it, with no address: the splash awake (the office's orbs, the Orbz mark, the wordmark), a
//     greeting by name, how the office is, the four next things to do;
//   - its numbers are the home's: the week's XP and today's brain, what is coming up, the top of the office in XP
//     order, the latest work, the sessions, the office's life and who applies;
//   - its presses go where they say: an orb its profile, The office the floor, Home in the menu back;
//   - an empty office opens, as it always has, on making its first orb (control: no home page);
//   - nothing spills, at desk and phone size.
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

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-home-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const day = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function homeOf(t: { after(fn: () => unknown): void }, stocked: boolean) {
  const data = mkdtempSync(join(tmpdir(), "orbs-home-page-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  if (stocked) {
    h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "azure" });
    for (const [id, name, sp, hue] of [["beatrix", "Beatrix", "research", "rose"], ["darius", "Darius", "frontend", "teal"], ["ilaria", "Ilaria", "writing", "amber"], ["kenji", "Kenji", "backend", "violet"], ["tad", "Tad", "data", "mint"], ["horace", "Horace", "design", "coral"], ["wren", "Wren", "editing", "iris"]] as const) {
      h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue });
    }
    const now = h.clock.now();
    let source = 1;
    for (const [orb, n] of [["beatrix", 120], ["darius", 80], ["ilaria", 45]] as const) h.events.append("xp.earned", { amount: n, reason: "a run you approved", source: source++, at: now }, { orb });
    h.events.append("run.finished", { run: 1, outcome: "ok", summary: "Mystery kits sell for $39 to $60. The rest is in the notes." }, { orb: "beatrix" });
    h.events.append("brain.spend", { tier: "big", model: "m", cost_usd: null, cost_source: "none", prompt_tokens: 12_000, completion_tokens: 400 }, { orb: "beatrix" });
    h.events.append("social.met", { a: "beatrix", b: "darius", kind: "ideas", place: "bistro1", word: "Colleagues", delta: 2, ideas: [{ orb: "beatrix", text: "Mystery kits sell for $39 to $60." }] }, {});
    h.notices.remind({ orb: "pip", kind: "bill", title: "Rent", due: day(now + 86_400_000), amount: "$1,200" });
    h.team.create("Mystery night kits", { brainstorm: ["beatrix", "darius"] });
    h.recruiter.setPosition("design", true);
  }
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  return { h, d };
}

async function open(t: { after(fn: () => unknown): void }, d: { pairLink(): string }, size: { width: number; height: number }): Promise<Page> {
  const touch = size.width < 1024;
  const ctx = await browser.newContext({ viewport: size, colorScheme: "dark", hasTouch: touch, isMobile: touch });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink().replace("orbs.html", "orbs.html?splash=0&intro=0"));
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  return page;
}

test("the app opens on the home page: the splash awake, a greeting, the home's numbers, presses that go where they say; desk and phone", { skip, timeout: 180_000 }, async (t) => {
  const { h, d } = await homeOf(t, true);
  const page = await open(t, d, { width: 1280, height: 900 });
  const home = page.locator("[data-home-page]");
  await home.waitFor({ timeout: 20_000 });
  await home.locator('[data-tile="xp"]').filter({ hasText: "+245" }).waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(() => location.hash), "#/home", "the pairing code spent: the home page's address");
  // the splash, awake
  const hero = home.locator("[data-home-hero]");
  assert.equal(await hero.locator('button[aria-label$="\'s profile"]').count(), 7, "seven of the eight orbs across a desk");
  assert.equal(await hero.locator("img").count(), 1, "the Orbz mark");
  assert.match(await hero.innerText(), /ORBZ/);
  assert.match(await hero.locator("h1").innerText(), /^(Good (morning|afternoon|evening)|Working late), Robin$/);
  assert.match(await hero.locator("[data-home-status]").innerText(), /^8 orbs · 0 working · nothing waiting for you$/);
  for (const b of ["Chat with Pip", "The office", "Start a session", "New orb"]) assert.equal(await hero.getByRole("button", { name: b, exact: true }).count(), 1, b);
  // the home's numbers
  assert.match(await home.locator('[data-tile="xp"]').innerText(), /\+245[\s\S]*\+245 today/);
  assert.match(await home.locator('[data-tile="brain"]').innerText(), /12k[\s\S]*1 request/);
  assert.match(await home.locator('[data-coming="bill"]').innerText(), /Rent · \$1,200[\s\S]*Tomorrow/);
  assert.deepEqual(await home.locator("[data-top]").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-top"))), h.ranking().slice(0, 5).map((r) => r.orb), "the top of the office, the most XP first");
  assert.match(await home.locator('[data-lately="beatrix"]').innerText(), /Beatrix[\s\S]*Mystery kits sell for \$39 to \$60\./);
  assert.match(await home.locator("[data-session]").first().innerText(), /Mystery night kits[\s\S]*2 orbs/);
  assert.match(await home.locator('[data-meeting="ideas"]').innerText(), /Beatrix and Darius traded ideas at the bistro table[\s\S]*Beatrix brought: Mystery kits/);
  assert.equal(await home.getByRole("button", { name: "Hiring: 2 applicants ›" }).count(), 1);
  assert.deepEqual(await measure(page), [], "the home page, at desk size");
  // opened again with no address at all (the installed app, the launcher): the home page, and no address written
  const again = await page.context().newPage();
  await again.goto(d.pairLink().replace(/#.*$/, "").replace("orbs.html", "orbs.html?splash=0&intro=0"));
  await again.locator("[data-home-page]").waitFor({ timeout: 30_000 });
  assert.equal(await again.evaluate(() => location.hash), "", "no address: the home page");
  await again.close();
  // where its presses go
  await hero.getByRole("button", { name: "Beatrix's profile" }).click();
  await page.waitForFunction(() => location.hash === "#/office/Beatrix", undefined, { timeout: 10_000 });
  await page.getByRole("navigation", { name: "Rooms" }).getByRole("button", { name: "Home" }).click();
  await page.waitForFunction(() => location.hash === "#/home", undefined, { timeout: 10_000 });
  await home.waitFor({ timeout: 10_000 });
  await hero.getByRole("button", { name: "The office", exact: true }).click();
  await page.waitForFunction(() => location.hash === "#/office", undefined, { timeout: 10_000 });
  await page.locator("[data-floor]").waitFor({ timeout: 20_000 });

  // a phone: five across, one column, nothing spills
  const phone = await open(t, d, { width: 390, height: 844 });
  const ph = phone.locator("[data-home-page]");
  await ph.locator('[data-tile="xp"]').filter({ hasText: "+245" }).waitFor({ timeout: 20_000 });
  assert.equal(await ph.locator('[data-home-hero] button[aria-label$="\'s profile"]').count(), 5, "five across a phone");
  await phone.waitForTimeout(800);
  assert.deepEqual(await measure(phone), [], "the home page, at phone size");
});

test("an empty office opens, as it always has, on making its first orb: the home page waits for an office", { skip, timeout: 120_000 }, async (t) => {
  const { d } = await homeOf(t, false);
  const page = await open(t, d, { width: 1280, height: 900 });
  await page.getByRole("textbox", { name: "Name" }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator("[data-home-page]").count(), 0, "no home page for an empty office");
});
