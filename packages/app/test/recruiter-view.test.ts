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
//   - the positions in their departments, each named (owner, 10-07: "an all filter ... and also give them
//     groups"): one department's or All, and every one shown ticked or unticked in one press, one request;
//     the fundamental analyst among Business's;
//   - a dropdown's own list readable in every theme (owner, 10-11: "when we drop down everything else is white"):
//     the browser draws it on white under a field's see-through fill, so each choice has its own ground;
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
import { applicant, SPECIALTIES } from "../src/orb/spec.ts";
import { toHome } from "../src/home/link.ts";
import { THEMES } from "../src/design/tokens.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
/** Your CEO and every department's head, so the Recruiter is open throughout (PLAN 5.13). */
const heads = (h: Home): void => {
  for (const [id, name, sp, hue] of [["max", "Max", "ceo", "honey"], ["ivo", "Ivo", "cto", "violet"], ["cos", "Cos", "chiefofstaff", "orchid"], ["cam", "Cam", "cmo", "coral"], ["fin", "Fin", "cfo", "jade"], ["oto", "Oto", "coo", "cornflower"]] as const) {
    h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue });
  }
};
/** Every dropdown and every choice in its list on the page, in a theme: whether its own ground is solid, and its words'
 * contrast on that ground (WCAG 2). */
const lists = (page: Page, theme: string) => page.evaluate((theme) => {
  const root = document.documentElement;
  const was = root.getAttribute("data-theme");
  root.setAttribute("data-theme", theme);
  const rgba = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
  const lum = (c: number[]): number => {
    const f = (v: number): number => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
  };
  const out = [...document.querySelectorAll("select, select option")].map((el) => {
    const s = getComputedStyle(el);
    const [hi, lo] = [lum(rgba(s.color)), lum(rgba(s.backgroundColor))].sort((a, b) => b - a);
    return { what: `${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 24)}`, solid: (rgba(s.backgroundColor)[3] ?? 1) === 1, ratio: (hi! + 0.05) / (lo! + 0.05) };
  });
  if (was === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", was);
  return out;
}, theme);
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
  heads(h); // the company in place: your CEO and every department's head (PLAN 5.13)
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
  // its CV (owner, 10-10: "fix CV page in recruiting"): one scroll, never a box scrolling inside it, and Interview, Hire
  // and Pass in view at its foot wherever it is scrolled
  assert.equal(await card.locator(".orbs-tall").count(), 0, "no box scrolling inside the CV");
  const cv = card.locator(".orbs-cv");
  assert.ok(await cv.evaluate((el) => el.scrollHeight > el.clientHeight + 40), "control: the CV is longer than its window, so it scrolls");
  for (const to of ["top", "bottom"] as const) {
    await cv.evaluate((el, to) => el.scrollTo({ top: to === "top" ? 0 : el.scrollHeight }), to);
    await page.waitForTimeout(200);
    const a = (await card.locator("[data-cv-answer]").boundingBox())!, w = (await cv.boundingBox())!;
    assert.ok(a.y >= w.y - 1 && a.y + a.height <= w.y + w.height + 1, `Interview, Hire and Pass in view, scrolled to the ${to}`);
  }
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
  heads(h); // the company in place: your CEO and every department's head (PLAN 5.13)
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
  // a tag above every orb, wherever an orb walks or sits (10-07: in a busy gate an orb passing over Think's tag took its
  // press): every tag stacks above every orb on the floor. The tags come with the office's hiring, a moment after the
  // floor: in a busy gate the stacking was read before they came (10-07, "( over 516)": no tag at all)
  await page.locator("[data-hiring]").nth(1).waitFor({ timeout: 20_000 });
  const stacking = await page.evaluate(() => {
    const zOf = (el: Element): number => {
      for (let e: Element | null = el; e && !e.hasAttribute("data-floor-plan"); e = e.parentElement) {
        const z = (e as HTMLElement).style.zIndex;
        if (z) return Number(z);
      }
      return 0;
    };
    const orbs = [...document.querySelectorAll("[data-floor-orb]")].map(zOf);
    return { tags: [...document.querySelectorAll("[data-hiring]")].map(zOf), top: Math.max(...orbs) };
  });
  assert.ok(stacking.tags.length >= 2 && stacking.tags.every((z) => z > stacking.top), `every Hiring tag above every orb (${stacking.tags} over ${stacking.top})`);
  await page.getByRole("button", { name: "Hiring for Build: see who applied" }).click();
  await page.waitForFunction(() => location.hash === "#/recruiter/build", undefined, { timeout: 10_000 });
  await page.locator('[data-applying="backend"] [data-applicant]').first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await shown(page), ["backend"], "Build's tag: only who applied to Build");
  assert.match(await page.locator("[data-applicants-of]").innerText(), /Who applied: Build/i);
  assert.equal(await page.locator("select[data-department]").inputValue(), "build", "its dropdown says so (owner, 10-10: dropdowns)");
  await page.waitForTimeout(300);
  assert.ok(await inView(page), "they are in view, past the positions");
  assert.equal(await page.locator("[data-best] [data-ranked]").count(), 2, "ranked among themselves");
  assert.deepEqual(await measure(page), [], "a department's applicants, at desk size");

  // Think, a choice away; then All; Back returns
  await page.locator("select[data-department]").selectOption("think");
  await page.waitForFunction(() => location.hash === "#/recruiter/think", undefined, { timeout: 10_000 });
  await page.locator('[data-applying="planning"] [data-applicant]').first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await shown(page), ["planning"], "Think: only who applied to Think");
  await page.locator("select[data-department]").selectOption("");
  await page.waitForFunction(() => location.hash === "#/recruiter", undefined, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-applying]").length === 2, undefined, { timeout: 10_000 });
  assert.deepEqual((await shown(page)).sort(), ["backend", "planning"], "All: everyone");
  // by position: the positions you are hiring for, one at a time, the best for your team among them only
  assert.deepEqual(await page.locator("select[data-applicant-position] option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)), ["", "backend", "planning"], "All, then each position you are hiring for");
  await page.locator("select[data-applicant-position]").selectOption("planning");
  await page.waitForFunction(() => document.querySelectorAll("[data-applying]").length === 1, undefined, { timeout: 10_000 });
  assert.deepEqual(await shown(page), ["planning"], "one position: only who applied to it");
  assert.equal(await page.locator("[data-best]").count(), 1, "ranked among themselves");
  assert.equal(await page.locator("[data-best] [data-ranked]").count(), 2);
  await page.locator("select[data-applicant-position]").selectOption("");
  await page.waitForFunction(() => document.querySelectorAll("[data-applying]").length === 2, undefined, { timeout: 10_000 });
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

test("the positions in their departments, each named; one department's or All; every one shown ticked in one press; desk and phone", { skip, timeout: 150_000 }, async (t) => {
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
  heads(h); // the company in place: your CEO and every department's head (PLAN 5.13)
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
  const groups = (page: Page) => page.locator("[data-position-group]").evaluateAll((gs) => gs.map((g) => g.getAttribute("data-position-group")));
  const all = (page: Page) => page.locator("[data-tick-shown]");
  const page = await open({ width: 1280, height: 900 });
  assert.deepEqual(await groups(page), ["exec", "build", "think", "make", "finance", "business", "life"], "All: every department, the Executive and Finance among them (10-07)");
  const finance = Object.entries(SPECIALTIES).filter(([, v]) => v.family === "finance").map(([k]) => k);
  assert.match(await page.locator('[data-position-group="finance"]').innerText(), new RegExp(`^Finance\\s+0 of ${finance.length}`), "each named, with how many are ticked");
  assert.equal(await page.locator('[data-position-group="finance"] [data-position="fundamentals"]').innerText(), "Fundamental Analyst");

  // one department: its positions alone, and all of them in one press, one request
  await page.locator("select[data-position-filter]").selectOption("finance");
  assert.deepEqual(await groups(page), ["finance"], "Finance alone");
  const puts: string[] = [];
  page.on("request", (r) => void (r.method() === "PUT" && /\/recruiter\/positions/.test(r.url()) && puts.push(r.url())));
  assert.equal(await all(page).innerText(), "All of Finance");
  await all(page).click();
  await page.waitForFunction(() => document.querySelector("[data-tick-shown]")?.getAttribute("aria-pressed") === "true", undefined, { timeout: 10_000 });
  assert.deepEqual(new Set(h.recruiter.positions()), new Set(finance), "every Finance position, and only those");
  assert.equal(puts.length, 1, "in one request, not one each");
  assert.equal(await all(page).innerText(), "✓ All of Finance");
  await page.locator('[data-applying="fundamentals"] [data-applicant]').first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(page), [], "a department's positions, at desk size");

  // a dropdown's own list, readable in every theme (owner, 10-11): each choice on a solid ground of its own
  for (const theme of Object.keys(THEMES)) {
    const seen = await lists(page, theme);
    assert.ok(seen.filter((c) => c.what.startsWith("option")).length >= 8, `${theme}: the dropdowns' choices`);
    assert.deepEqual(seen.filter((c) => c.what.startsWith("option") && (!c.solid || c.ratio < 4.5)), [], `${theme}: every choice readable on its own ground`);
    // the control: the same look finds a see-through ground, the fields' own, which is what the list was drawn under
    assert.ok(seen.some((c) => c.what.startsWith("select") && !c.solid), `${theme}: a see-through ground is seen`);
  }

  // All: every position in one press, then none
  await page.locator("select[data-position-filter]").selectOption("");
  assert.equal((await groups(page)).length, 7);
  assert.equal(await all(page).innerText(), "All positions", "not all of them yet");
  await all(page).click();
  await page.waitForFunction(() => document.querySelector("[data-tick-shown]")?.textContent === "✓ All positions", undefined, { timeout: 20_000 });
  // every position shown: the desk's are not, while it is shut (PLAN 5.21)
  assert.equal(h.recruiter.positions().length, Object.values(SPECIALTIES).filter((v) => v.family !== "desk").length, "every position");
  await all(page).click();
  await page.waitForFunction(() => document.querySelector("[data-tick-shown]")?.textContent === "All positions", undefined, { timeout: 20_000 });
  assert.deepEqual(h.recruiter.positions(), [], "and none, in one press");
  assert.equal(puts.length, 3);

  const phone = await open({ width: 390, height: 844 });
  await phone.locator("select[data-position-filter]").selectOption("life");
  assert.deepEqual(await groups(phone), ["life"]);
  assert.deepEqual(await measure(phone), [], "at phone size");
});

test("with only your CEO and your assistant, a department is locked until its head: its positions shown, not pressable; the Executive open", { skip, timeout: 120_000 }, async (t) => {
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
  h.inbox.addOrb("max", "Max", "ceo", { shape: "egg", eyes: "classic", hue: "honey" });
  h.inbox.addOrb("pa", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "azure" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/recruiter"));
  await page.locator("[data-recruiter]").waitFor({ timeout: 20_000 });
  assert.match(await page.locator('[data-locked="build"]').innerText(), /^Hire a CTO to open Build/);
  assert.equal(await page.locator('[data-position="frontend"]').isDisabled(), true, "Build's positions shown, not pressable");
  assert.equal(await page.locator('[data-locked="exec"]').count(), 0, "the Executive is open");
  assert.equal(await page.locator('[data-position="cto"]').isDisabled(), false);
  await page.locator('[data-position="cto"]').click();
  await page.waitForFunction(() => document.querySelector('[data-position="cto"]')?.getAttribute("aria-pressed") === "true", undefined, { timeout: 10_000 });
  assert.deepEqual(h.recruiter.positions(), ["cto"], "hiring its head");
  assert.deepEqual(await measure(page), [], "the locks, at desk size");
});
