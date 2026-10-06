// PLAN 5.8_t's view, the recruiter, on a real home with a scripted brain, at desk and phone sizes:
//   - tick a position: its applicants appear, each a whole orb from its seed, the same on a second
//     device; untick it and they are out of sight;
//   - ranked for the team (owner, 10-05: "which ones would best suit our team by rank"): Best for your
//     team lists them best first, the cards in the same order, each its fit and why;
//   - an applicant's profile opens from its card (owner, 10-05: "show the orbs profile when we click on
//     it"): its card as the office shows one, its rank, at desk and phone size; Escape and Close close it;
//   - interview one: the answer is the applicant's, in the applicant's name;
//   - hire one: in the office exactly as applied (look, name, kind of work, the Senior), the
//     interview the first chat, and the other now "a Junior"; pass the other: gone;
//   - an orb you let go applies again for its old kind of work, and is rehired from here;
//   - the floor's Hiring tags (owner, 10-06: "should bring us to those who can build and think"): each
//     opens on who applied to its department, in view, with All and the other departments a press away;
//   - nothing spills.
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
import { levelOf } from "../../home/src/gym/levels.ts";
import { applicant } from "../src/orb/spec.ts";
import { toHome } from "../src/home/link.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-recruiter-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("tick a position, interview, hire, pass; an orb let go applies again; desk and phone", { skip, timeout: 150_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-recruiter-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  // the office has its personal assistant: the Recruiter opens only once there is one (owner, 10-04)
  h.inbox.addOrb("pa", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "azure" });
  h.inbox.addOrb("cy", "Cy", "writing", { shape: "bean", eyes: "classic", hue: "rose" });
  h.inbox.letGo("cy");
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate(() => (location.hash = "#/recruiter"));
    await page.locator("[data-recruiter]").waitFor({ timeout: 20_000 });
    return page;
  };
  const page = await open({ width: 1280, height: 900 });

  // tick Frontend Builder: two applicants, whole orbs from their seeds
  await page.locator('[data-position="frontend"]').click();
  const section = page.locator('[data-applying="frontend"]');
  await section.locator("[data-applicant]").first().waitFor({ timeout: 20_000 });
  const rolled = h.recruiting().applicants.map((a) => a.seed);
  const rolledNames = rolled.map((s) => applicant(s, "frontend").name);
  // the cards in the order shown: the best for the team first
  const names = (await section.locator("[data-profile-open]").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") ?? ""))).map((l) => /^See (.+)'s profile$/.exec(l)![1]!);
  assert.deepEqual([...names].sort(), [...rolledNames].sort(), "the applicants who applied, each once");
  const seeds = names.map((n) => rolled[rolledNames.indexOf(n)]!);
  assert.equal(await section.locator("[data-applicant]").count(), 2);
  const best = page.locator("[data-best] [data-ranked]");
  assert.deepEqual((await best.evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") ?? ""))).map((l) => /^#(\d): ([^,]+),/.exec(l)!.slice(1).join(" ")), [`1 ${names[0]}`, `2 ${names[1]}`], "Best for your team: ranked, in the cards' order");
  const fits = await section.locator("[data-fit]").evaluateAll((fs) => fs.map((f) => Number(f.getAttribute("data-fit"))));
  assert.ok(fits.length === 2 && fits[0]! >= fits[1]!, `the better fit first (${fits.join(", ")})`);
  assert.match(await section.locator("[data-applicant]").first().innerText(), /#1 for your team[\s\S]*Fit \d+[\s\S]*(brings|its skills)/i, "its rank, its fit and why");
  assert.match(await section.innerText(), new RegExp(`${names[0]}[\\s\\S]*would start as the Senior[\\s\\S]*${names[1]}`), "each by name, and where each would start");
  assert.deepEqual(await measure(page), [], "the recruiter, at desk size");

  // the first one's profile: its card as the office shows one, and its rank
  await page.getByRole("button", { name: `See ${names[0]}'s profile` }).click();
  const card = page.getByRole("dialog", { name: `${names[0]}'s profile` });
  await card.waitFor({ timeout: 20_000 });
  assert.match(await card.innerText(), new RegExp(`Applying: Frontend Builder[\\s\\S]*#1 for your team[\\s\\S]*${names[0]}[\\s\\S]*Applying · would start as the Senior[\\s\\S]*Traits[\\s\\S]*DNA[\\s\\S]*Leans toward`, "i"));
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "the profile, at desk size");
  await page.keyboard.press("Escape");
  await card.waitFor({ state: "detached", timeout: 5_000 });

  // the same applicants on a second device (a phone)
  const phone = await open({ width: 390, height: 844 });
  await phone.locator('[data-applying="frontend"] [data-applicant]').first().waitFor({ timeout: 20_000 });
  assert.match(await phone.locator('[data-applying="frontend"]').innerText(), new RegExp(`${names[0]}[\\s\\S]*${names[1]}`), "the same people on the phone");
  assert.deepEqual(await measure(phone), [], "and at phone size");
  await phone.getByRole("button", { name: `See ${names[1]}'s profile` }).click();
  const small = phone.getByRole("dialog", { name: `${names[1]}'s profile` });
  await small.waitFor({ timeout: 20_000 });
  assert.match(await small.innerText(), /#2 of 2 for your team/);
  await phone.waitForTimeout(400);
  assert.deepEqual(await measure(phone), [], "the profile, at phone size");
  await small.getByRole("button", { name: "Close" }).click();
  await small.waitFor({ state: "detached", timeout: 5_000 });

  // interview the first: the answer is the applicant's
  model.replies.push(`I like a layout that breathes.`);
  const first = section.locator("[data-applicant]").first();
  await first.getByRole("button", { name: `Interview ${names[0]}` }).click();
  await first.getByRole("textbox", { name: `A question for ${names[0]}` }).fill("What do you care about?");
  await first.getByRole("button", { name: "Ask" }).click();
  await first.locator('[data-from="applicant"]').waitFor({ timeout: 20_000 });
  assert.match(await first.locator('[data-from="applicant"]').innerText(), new RegExp(`^${names[0]}: I like a layout that breathes\\.`));

  // hire the first (in the office, the interview the first chat); pass the second
  await first.getByRole("button", { name: `Hire ${names[0]}` }).click();
  for (let i = 0; i < 50 && !h.inbox.orbs().some((o) => o.name === names[0]); i++) await page.waitForTimeout(100);
  const hired = h.inbox.orbs().find((o) => o.name === names[0]);
  assert.ok(hired && hired.specialty === "frontend", "hired as applied");
  assert.deepEqual(hired.look, JSON.parse(JSON.stringify(toHome(applicant(seeds[0]!, "frontend")).look)), "exactly the orb that applied: every choice of its look");
  assert.equal(levelOf(h.events, hired.id), "Senior", "the first Frontend Builder in the office: the Senior");
  assert.deepEqual(h.conversations.history(`chat:${hired.id}`).map((m) => m.content), ["What do you care about?", "I like a layout that breathes."], "the interview is the first chat");
  await page.waitForFunction(() => /would start as a Junior/.test(document.querySelector('[data-applying="frontend"] [data-applicant]')?.textContent ?? ""), undefined, { timeout: 20_000 });
  await section.locator("[data-applicant]").first().getByRole("button", { name: "Pass" }).click();
  await page.waitForFunction(() => !document.querySelector('[data-applying="frontend"] [data-applicant]'), undefined, { timeout: 20_000 });

  // an orb let go applies again for its old kind of work, and is rehired from here
  await page.locator('[data-position="writing"]').click();
  const cy = page.locator('[data-returning="cy"]');
  await cy.waitFor({ timeout: 20_000 });
  assert.match(await cy.innerText(), /Cy, Senior Wordsmith/);
  await cy.getByRole("button", { name: "Rehire Cy" }).click();
  await cy.waitFor({ state: "detached", timeout: 20_000 });
  assert.equal(h.inbox.orb("cy")!.letGoAt, null, "rehired");
});

test("the floor's Hiring tags open on who applied to their department; All and the others a press away; desk and phone", { skip, timeout: 150_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-recruiter-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("pa", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "azure" });
  // hiring in two departments, as the owner is: Build (Backend) and Think (Planning)
  h.recruiter.setPosition("backend", true);
  h.recruiter.setPosition("planning", true);
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate(() => (location.hash = "#/office"));
    await page.locator("[data-floor]").waitFor({ timeout: 20_000 });
    return page;
  };
  const shown = (page: Page) => page.locator("[data-applying]").evaluateAll((ss) => ss.map((x) => x.getAttribute("data-applying")));
  // the department's heading near the top of the screen, and nothing (a phone's top bar) over it
  const inView = (page: Page) => page.locator("[data-applicants-of]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 20, r.top + 8);
    return r.top >= 0 && r.top < innerHeight / 2 && !!hit && el.contains(hit);
  });

  const page = await open({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Hiring for Build: see who applied" }).click();
  await page.waitForFunction(() => location.hash === "#/recruiter/build", undefined, { timeout: 10_000 });
  await page.locator('[data-applying="backend"] [data-applicant]').first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await shown(page), ["backend"], "Build's tag: only who applied to Build");
  assert.match(await page.locator("[data-applicants-of]").innerText(), /Who applied: Build/i);
  assert.equal(await page.locator('[data-department="build"]').getAttribute("aria-pressed"), "true");
  await page.waitForTimeout(300);
  assert.ok(await inView(page), "they are in view, past the positions");
  assert.equal(await page.locator("[data-best] [data-ranked]").count(), 2, "ranked among themselves");
  assert.deepEqual(await measure(page), [], "a department's applicants, at desk size");

  // Think, a press away; then All; Back returns
  await page.locator('[data-department="think"]').click();
  await page.waitForFunction(() => location.hash === "#/recruiter/think", undefined, { timeout: 10_000 });
  await page.locator('[data-applying="planning"] [data-applicant]').first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await shown(page), ["planning"], "Think: only who applied to Think");
  await page.locator('[data-department="all"]').click();
  await page.waitForFunction(() => location.hash === "#/recruiter", undefined, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-applying]").length === 2, undefined, { timeout: 10_000 });
  assert.deepEqual((await shown(page)).sort(), ["backend", "planning"], "All: everyone");
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#/recruiter/think" && document.querySelectorAll("[data-applying]").length === 1, undefined, { timeout: 10_000 });

  // the floor's other tag, on a phone
  const phone = await open({ width: 390, height: 844 });
  await phone.locator('[data-hiring="think"]').click();
  await phone.waitForFunction(() => location.hash === "#/recruiter/think", undefined, { timeout: 10_000 });
  await phone.locator('[data-applying="planning"] [data-applicant]').first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await shown(phone), ["planning"]);
  await phone.waitForTimeout(300);
  assert.ok(await inView(phone), "in view on a phone too");
  assert.deepEqual(await measure(phone), [], "and at phone size");
});
