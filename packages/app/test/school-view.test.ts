// PLAN 5.7_t's view, school, on a real home with a brain scripted by what it is asked, at desk and
// phone sizes:
//   - an orb you let go is sent to school from the org chart's Away list: subjects, a pass mark;
//   - its report card there: Mathematics' starting score (graded by code), Talking with you's
//     answers waiting for your thumbs and graded by them, a syllabus you change;
//   - a night's class, and the mark twice: a diploma, on the report card and on the recruiter's
//     Applied again;
//   - rehired: the report card on its career page;
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
import { seedOf } from "../../home/src/school/school.ts";
import { mathsExam } from "../../home/src/school/subjects.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-school-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("send an orb you let go to school, rate its answers, change a syllabus; a diploma; rehired, its report card", { skip, timeout: 180_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const exam = mathsExam(seedOf("cy", 1, "maths", "Mathematics"));
  type Msg = { role?: string; content?: unknown };
  model.answer = (msgs) => {
    const sys = String((msgs as Msg[]).find((m) => m.role === "system")?.content ?? "");
    const user = String((msgs as Msg[]).findLast((m) => m.role === "user")?.content ?? "");
    if (/Write a syllabus/.test(user)) return "1. Fractions\n2. Percentages\n3. Equations\n4. Rates";
    if (/sitting your Mathematics exam/.test(sys)) return exam.map((q, i) => `ANSWER ${i + 1}: ${i < 7 ? q.answer : "0"}`).join("\n");
    if (/Today's topic/.test(user)) return "Today: fractions.\nFind a common denominator first.";
    if (/^Practice:/m.test(user)) return "ANSWER 1: 1\nANSWER 2: 2\nANSWER 3: 3";
    if (/Write ONE note/.test(user)) return "Find a common denominator first.";
    return "I hear you. Let's take it one step at a time.";
  };
  const data = mkdtempSync(join(tmpdir(), "orbs-school-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  // the office has its CEO and personal assistant, and a COO to open Business, where support works: the Recruiter and
  // a department open only then (owner, 10-07)
  h.inbox.addOrb("max", "Max", "ceo", { shape: "egg", eyes: "classic", hue: "honey" });
  h.inbox.addOrb("pa", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "azure" });
  h.inbox.addOrb("oto", "Oto", "coo", { shape: "bean", eyes: "classic", hue: "teal" });
  h.inbox.addOrb("cy", "Cy", "support", { shape: "bean", eyes: "classic", hue: "rose" });
  h.inbox.letGo("cy");
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }, hash: string, ready: string): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate((x) => (location.hash = x), hash);
    await page.locator(ready).waitFor({ timeout: 20_000 });
    return page;
  };
  const page = await open({ width: 1280, height: 900 }, "#/org", "[data-org]");

  // send Cy to school: Mathematics and Talking with you, the pass mark 70%
  const away = page.locator('[data-away="cy"]');
  await away.getByRole("button", { name: "Send Cy to school" }).click();
  const sheet = page.getByRole("group", { name: "Send Cy to school" });
  await sheet.locator('[data-subject="maths"]').click();
  await sheet.locator('[data-subject="talking"]').click();
  await sheet.getByRole("radio", { name: "70%" }).click();
  await sheet.getByRole("button", { name: "Send Cy to school" }).click();

  // the report card on the Away list: Mathematics graded by code (7 of 10), Talking with you waiting
  const card = page.locator('[data-report-card="cy"]');
  await card.locator('[data-school-subject="maths"] [data-scores]').filter({ hasText: "Started at 70%" }).waitFor({ timeout: 30_000 });
  const talking = card.locator('[data-school-subject="talking"]');
  await talking.getByRole("group", { name: "Rate Cy's answers" }).waitFor({ timeout: 30_000 });
  assert.equal(await talking.locator("[data-answer]").count(), 5);
  assert.deepEqual(await measure(page), [], "school on the org chart, at desk size");

  // your thumbs: four up, one down: 80%
  for (let n = 1; n <= 5; n++) await talking.getByRole("button", { name: `Thumbs ${n === 3 ? "down" : "up"} for answer ${n}` }).click();
  await talking.locator("[data-scores]").filter({ hasText: "Started at 80%" }).waitFor({ timeout: 20_000 });
  assert.equal(await talking.getByRole("group", { name: "Rate Cy's answers" }).count(), 0);

  // change Mathematics' syllabus
  const maths = card.locator('[data-school-subject="maths"]');
  await maths.getByRole("button", { name: "Change the syllabus" }).click();
  await maths.getByRole("textbox", { name: "Mathematics: the syllabus, a topic a line" }).fill("Fractions\nRatios");
  await maths.getByRole("button", { name: "Save the syllabus" }).click();
  await maths.locator("[data-syllabus]").filter({ hasText: "Fractions · Ratios" }).waitFor({ timeout: 20_000 });

  // the same at phone size
  const phone = await open({ width: 390, height: 844 }, "#/org", '[data-report-card="cy"]');
  assert.deepEqual(await measure(phone), [], "and at phone size");

  // a night's class at 70% again: the mark you set, twice in a row, a diploma (at 80% it would not be)
  await h.school.night();
  await maths.locator("text=🎓 Mathematics").waitFor({ timeout: 20_000 });
  assert.match(await card.locator("[data-diplomas]").innerText(), /Mathematics \(70%\)/);

  // the recruiter's Applied again shows it
  await page.evaluate(() => (location.hash = "#/recruiter"));
  await page.locator('[data-position="support"]').click();
  await page.locator('[data-returning="cy"]').filter({ hasText: "🎓 Mathematics" }).waitFor({ timeout: 20_000 });

  // rehired: the report card on Cy's career page, the term over
  await page.locator('[data-returning="cy"]').getByRole("button", { name: "Rehire Cy" }).click();
  await page.locator('[data-returning="cy"]').waitFor({ state: "detached", timeout: 20_000 });
  await page.evaluate(() => (location.hash = "#/career/Cy"));
  const onCareer = page.locator('[data-career="cy"] [data-report-card="cy"]');
  await onCareer.waitFor({ timeout: 20_000 });
  assert.match(await onCareer.innerText(), /Report card[\s\S]*Mathematics/i);
  assert.equal(await onCareer.getByRole("group", { name: "Rate Cy's answers" }).count(), 0, "nothing waits for thumbs once the term is over");
  assert.equal(await onCareer.getByRole("button", { name: "Change the syllabus" }).count(), 0, "the term is over");
  assert.deepEqual(await measure(page), [], "the career page with its report card");
});
