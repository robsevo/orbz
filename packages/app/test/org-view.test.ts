// PLAN 5.6_t: the org chart and career pages, on a real home, at desk and phone sizes (and PLAN 5.44_t, its brand card; 5.45_t and 5.46_t, the culture and the brand watch on the chart).
//   - the org chart: everyone by the kind of work they do, the lead of each kind first;
//   - drawn as a tree (owner, 10-08: "like a family tree or corporate latter"): you, the CEO, the heads, the teams,
//     with its lines; hung down on a desk, run down the page on a phone;
//   - a face opens his career page: his level and the next one's evidence, his age and days in the
//     company, the radar, his habits;
//   - his weekly card: a notice that opens his career page;
//   - let go, his habits handed to another orb; away on the org chart; rehired, back in the office;
//   - nothing spills, at desk or phone size.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { habitDir } from "../../home/src/gym/compile.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-org-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("the org chart and a career page; let go with a hand-off, away, rehired; let go and sent to school from a profile; desk and phone", { skip, timeout: 150_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-org-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "frontend", { shape: "bean", eyes: "classic", hue: "amber" }); // the first of his kind: he leads it
  h.inbox.addOrb("bea", "Bea", "frontend", { shape: "bean", eyes: "classic", hue: "teal" });
  h.inbox.addOrb("cy", "Cy", "writing", { shape: "bean", eyes: "classic", hue: "rose" });
  const key = "ada|trigger:t1|read_file {subject}";
  mkdirSync(habitDir(data, { orb: "ada", key }, 1), { recursive: true });
  writeFileSync(join(habitDir(data, { orb: "ada", key }, 1), "habit.py"), "# the steps\n");
  h.events.append("habit.promoted", { kind: key, task: "ada|trigger:t1|{subject}", version: 1, runs: [1, 2, 3] }, { orb: "ada" });

  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/org"));

  const org = page.locator("[data-org]");
  await org.waitFor({ timeout: 20_000 });
  const frontend = org.locator('[data-kind="frontend"]');
  await frontend.getByRole("button", { name: /^Ada, Senior, leads Frontend Builder work/ }).waitFor();
  await frontend.getByRole("button", { name: /^Bea, Junior$/ }).waitFor();
  await org.locator('[data-kind="writing"]').getByRole("button", { name: /^Cy, Senior, leads/ }).waitFor();
  // the company's shape (owner, 10-07): you at its top, the Founder; each department under its head, or none yet
  assert.match(await org.locator("[data-founder]").innerText(), /Founder\s+Robin/i);
  assert.deepEqual(await org.locator("[data-department]").evaluateAll((ds) => ds.map((d) => d.getAttribute("data-department"))), ["build", "make"], "the departments with orbs, in the company's order");
  assert.equal(await org.locator('[data-department="build"] [data-head]').innerText(), "No CTO yet");
  assert.equal(await org.locator('[data-department="build"] [data-kind="frontend"]').count(), 1, "its kinds of work inside it");
  // the office's culture (PLAN 5.45) over the tree: the home's score, its three parts; the brand watch (5.46) waits for a CEO
  const culture = h.culture.now();
  await page.locator(`[data-culture="${culture.score}"]`).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator("[data-culture-word]").innerText(), culture.word);
  assert.deepEqual(await page.locator("[data-culture-part]").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-culture-part"))), ["brands", "together", "floor"]);
  assert.match(await page.getByRole("region", { name: "Brand watch" }).innerText(), /No CEO yet/);
  assert.deepEqual(await measure(page), [], "the org chart, at desk size");

  // a face opens his career page
  await frontend.getByRole("button", { name: /^Ada, Senior/ }).click();
  const career = page.locator('[data-career="ada"]');
  await career.waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(() => location.hash), "#/career/Ada");
  const words = await career.innerText();
  assert.match(words, /Senior Frontend Builder/);
  assert.match(words, /Age 0 days · 0 days in the company/);
  assert.match(words, /trigger:t1/, "his habit is on his page");
  await career.getByRole("img", { name: /Leans toward/ }).waitFor();
  // richer (owner, 10-07): the ladder with its rung, its seven traits, its level; the whole orb, hat and all
  await career.locator('[data-rung="Senior"][aria-current="step"]').waitFor();
  assert.equal(await career.locator("[data-trait]").count(), 7);
  assert.match(await career.locator("[data-level]").innerText(), /^Lv\. \d+$/);
  assert.equal(await career.locator("[data-career-portrait]").evaluate((el) => getComputedStyle(el.querySelector("canvas")!.parentElement!).overflow === "hidden" ? "cut" : "whole"), "whole");
  // what it wants, and the office by XP (owner, 10-07: "they also want to be the best orb also")
  assert.match(await career.locator("[data-ambition]").innerText(), /^Ada wants to be the best orb in the office, not only the best Frontend Builder: the most XP, and your approval\.$/);
  assert.deepEqual(await career.locator("[data-rank-orb]").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-rank-orb"))), h.ranking().map((r) => r.orb), "the office by XP, the most first");
  assert.equal(await career.locator('[data-rank-orb][aria-current="true"]').getAttribute("data-rank-orb"), "ada", "it, marked");
  assert.match(await career.locator("[data-standing]").innerText(), new RegExp(`^${h.ranking().findIndex((r) => r.orb === "ada") + 1}(st|nd|rd|th) of 3, `));
  // its brand (PLAN 5.44): the home's score and word, its fortnight, and the five parts that make it
  const brand = h.brand.of("ada");
  await career.locator(`[data-brand="${brand.score}"]`).waitFor();
  assert.equal(await career.locator("[data-brand-word]").innerText(), brand.word);
  assert.deepEqual(await career.locator("[data-brand-part]").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-brand-part"))), ["people", "work", "ideas", "helping", "record"]);
  await career.locator("[data-brand-spark]").waitFor();
  assert.deepEqual(await measure(page), [], "his career page, at desk size");

  // his week: a notice for you, a press from his career page
  h.events.append("performance.card", { orb: "cy", xp: 0, xpBefore: 0, approved: 0, judged: 0, regressions: 0, idleDays: 0, suggest: "keep", why: "0 XP this week (0 the week before); nothing judged this week; no regression; worked today" }, { orb: "cy" });
  await page.evaluate(() => (location.hash = "#/notices"));
  const cy = page.locator('[data-notices="cy"]');
  await cy.waitFor({ timeout: 20_000 });
  assert.match(await cy.innerText(), /Cy's week: keep going[\s\S]*Weekly card · 0 XP this week/);
  await cy.getByRole("button", { name: "Cy's career" }).click();
  await page.locator('[data-career="cy"]').waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(() => location.hash), "#/career/Cy");
  assert.match(await page.locator('[data-career="cy"]').innerText(), /This week: Keep going/i); // a heading, in capitals on the page

  // let go from his card in the office, his habits handed to Bea
  await page.evaluate(() => (location.hash = "#/office/Ada"));
  await page.getByRole("button", { name: "Let Ada go…" }).click();
  const ask = page.getByRole("group", { name: "Let Ada go?" });
  await ask.getByRole("combobox").selectOption("bea");
  await ask.getByRole("button", { name: "Let Ada go", exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Let Ada go…"), undefined, { timeout: 20_000 });
  for (let i = 0; i < 50 && !h.inbox.orb("ada")!.letGoAt; i++) await page.waitForTimeout(100);
  assert.ok(h.inbox.orb("ada")!.letGoAt, "Ada was let go");
  assert.ok(h.events.ofType("habit.promoted").some((e) => e.orb === "bea" && e.data.task === "bea|trigger:t1|{subject}"), "his habit is Bea's now");

  // away on the org chart; rehired from there, back in the office
  await page.evaluate(() => (location.hash = "#/org"));
  const away = page.locator('[data-away="ada"]');
  await away.waitFor({ timeout: 20_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "the org chart with someone away, at phone size");
  await away.getByRole("button", { name: "Rehire Ada" }).click();
  await away.waitFor({ state: "detached", timeout: 20_000 });
  assert.equal(h.inbox.orb("ada")!.letGoAt, null, "rehired");

  // Bea's career page at phone size: the habit Ada handed her says where it came from
  await page.evaluate(() => (location.hash = "#/career/Bea"));
  const bea = page.locator('[data-career="bea"]');
  await bea.waitFor({ timeout: 20_000 });
  assert.match(await bea.innerText(), /trigger:t1 \{subject\} \(v1\), from Ada/);
  assert.deepEqual(await measure(page), [], "a career page, at phone size");

  // school from where you let an orb go (owner, 10-06: "we dont see the send to school option"):
  // one press lets Cy go and opens the org chart on Cy's school sheet
  await page.evaluate(() => (location.hash = "#/office/Cy"));
  await page.getByRole("button", { name: "Let Cy go…" }).click();
  await page.getByRole("group", { name: "Let Cy go?" }).getByRole("button", { name: "Let Cy go and send to school" }).click();
  await page.waitForFunction(() => location.hash === "#/org/school/cy", undefined, { timeout: 20_000 });
  const sheet = page.locator('[data-away="cy"] [data-school-sheet="cy"]');
  await sheet.waitFor({ timeout: 20_000 });
  assert.ok(h.inbox.orb("cy")!.letGoAt, "Cy was let go");
  await sheet.getByRole("button", { name: "Send Cy to school" }).waitFor();
  assert.deepEqual(await measure(page), [], "the school sheet, opened from a profile, at phone size");
  // leaving the chart once Cy's sheet was scrolled into view: the next room opens, the page whole (an effect that hands
  // React scrollIntoView's Promise as its clean-up tears the page down as the chart closes)
  await page.evaluate(() => (location.hash = "#/office"));
  await page.locator("[data-floor]").waitFor({ timeout: 20_000 });
});

test("the board on the org chart (owner, 10-07): its seats by their posts, an odd number; a proposal put from it is voted, each member's vote and why; desk and phone", { skip, timeout: 150_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-org-board-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.about.setCompany("Acme Orbs");
  for (const [id, name, sp, hue] of [["max", "Max", "ceo", "honey"], ["pip", "Pip", "assistant", "azure"], ["ada", "Ada", "frontend", "amber"], ["bea", "Bea", "frontend", "teal"]] as const) h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue });
  h.boardroom.elect();
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/org"));
  const board = page.locator("[data-board]");
  await board.waitFor({ timeout: 20_000 });
  assert.equal(await board.locator("[data-board-size]").innerText(), "3 seats, always an odd number");
  assert.deepEqual(await board.locator("[data-seat]").evaluateAll((ss) => ss.map((x) => x.getAttribute("data-seat"))), ["chair", "secretary", "vice"], "the CEO in the Chair, your assistant its Secretary, the best of the rest its Vice Chair");
  assert.match(await board.locator('[data-seat="chair"]').innerText(), /Max\s+Chairperson/);
  model.replies.push("YES — we need one.", "YES — agreed.", "NO — too soon.");
  await board.getByLabel("Put a proposal to the board").fill("Hire a CTO this month");
  await board.getByRole("button", { name: "Put it to the vote" }).click();
  const carried = board.locator('[data-proposal="carried"]');
  await carried.waitFor({ timeout: 20_000 });
  assert.match(await carried.innerText(), /Hire a CTO this month[\s\S]*Carried 2–1/);
  assert.deepEqual(await carried.locator("[data-vote]").evaluateAll((vs) => vs.map((v) => v.getAttribute("data-vote"))), ["yes", "yes", "no"], "each member's vote");
  assert.match(await carried.innerText(), /Max \(Chairperson\): Yes, we need one\./);
  assert.deepEqual(await measure(page), [], "the board, at desk size");
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, isMobile: true })).newPage();
  t.after(() => phone.context().close());
  await phone.goto(d.pairLink());
  await phone.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await phone.evaluate(() => (location.hash = "#/org"));
  await phone.locator("[data-board] [data-proposal]").first().waitFor({ timeout: 20_000 });
  await phone.waitForTimeout(500);
  assert.deepEqual(await measure(phone), [], "and at phone size");
});

test("the org chart is a tree (owner, 10-08: \"like a family tree or corporate latter\"): you, the CEO, each head on a bar under the CEO, each team under its head, every orb once, with its lines; hung down on a desk, run down the page on a phone", { skip, timeout: 150_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-org-tree-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.about.setCompany("Acme Orbs");
  // Tess a second CTO: in Build's team under Gus, its head
  const crew = [["max", "Max", "ceo"], ["pip", "Pip", "assistant"], ["gus", "Gus", "cto"], ["ada", "Ada", "frontend"], ["bea", "Bea", "frontend"], ["tess", "Tess", "cto"], ["cy", "Cy", "writing"]] as const;
  for (const [id, name, sp] of crew) h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue: "teal" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }, phone: boolean) => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark", ...(phone && { hasTouch: true, isMobile: true }) });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate(() => (location.hash = "#/org"));
    await page.locator('[data-org-tree] [data-org-orb="tess"]').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    return page;
  };
  /** Where each part of the tree is, and the lines drawn for it. */
  const read = (page: Awaited<ReturnType<typeof open>>) => page.evaluate(() => {
    const box = (el: Element | null) => {
      const r = el!.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), mid: Math.round(r.left + r.width / 2) };
    };
    const tree = document.querySelector("[data-org-tree]")!;
    const pseudo = (el: Element, which: "::before" | "::after") => {
      const s = getComputedStyle(el, which);
      return s.content === "none" ? null : { top: s.borderTopWidth, left: s.borderLeftWidth, right: s.borderRightWidth, bottom: s.borderBottomWidth };
    };
    const branches = [...tree.querySelectorAll(".orbs-tree-rung > li")];
    return {
      layout: tree.getAttribute("data-layout"),
      departments: [...tree.querySelectorAll("[data-department]")].map((x) => x.getAttribute("data-department")),
      heads: Object.fromEntries([...tree.querySelectorAll("[data-department]")].map((x) => [x.getAttribute("data-department"), x.querySelector("[data-head]")!.getAttribute("data-head")])),
      orbs: [...tree.querySelectorAll("[data-org-orb]")].map((x) => x.getAttribute("data-org-orb")),
      founder: box(tree.querySelector("[data-founder]")),
      ceo: box(tree.querySelector('[data-department="exec"] [data-head]')),
      branchHeads: branches.map((b) => box(b.querySelector("[data-head]"))),
      branches: branches.map((b) => box(b)),
      teams: [...tree.querySelectorAll('[data-department="build"] [data-kind]')].map((k) => ({ kind: k.getAttribute("data-kind"), top: box(k).top, orbs: [...k.querySelectorAll("[data-org-orb]")].map((x) => x.getAttribute("data-org-orb")) })),
      stems: [...tree.querySelectorAll(".orbs-tree-stem")].map((x) => box(x)),
      lines: { branch: branches.map((b) => [pseudo(b, "::before"), pseudo(b, "::after")]), kind: pseudo(tree.querySelector('[data-department="build"] [data-kind]')!, "::before") },
    };
  });

  // a desk: hung down like a family tree
  const page = await open({ width: 1280, height: 900 }, false);
  let at = await read(page);
  assert.equal(at.layout, "down");
  assert.deepEqual(at.departments, ["exec", "build", "make", "life"], "the CEO, then the departments in the company's order");
  assert.deepEqual(at.heads, { exec: "max", build: "gus", make: "none", life: "pip" });
  assert.equal(await page.locator('[data-department="make"] [data-head]').innerText(), "No CMO yet");
  assert.deepEqual([...at.orbs].sort(), crew.map(([id]) => id).sort(), "every orb on the tree once");
  assert.deepEqual(at.teams, [{ kind: "frontend", top: at.teams[0]!.top, orbs: ["ada", "bea"] }, { kind: "cto", top: at.teams[1]!.top, orbs: ["tess"] }], "Build's team under Gus: Ada leading Bea, then Tess");
  // its rungs: you over the CEO over the heads, the heads side by side, each team under its head
  assert.ok(at.founder.bottom < at.ceo.top && at.ceo.bottom < Math.min(...at.branchHeads.map((b) => b.top)), `you, then the CEO, then the heads (${JSON.stringify([at.founder, at.ceo, at.branchHeads[0]])})`);
  assert.ok(at.branchHeads.every((b) => Math.abs(b.top - at.branchHeads[0]!.top) <= 1), "the heads on one rung");
  assert.ok(at.branchHeads.every((b, i) => i === 0 || b.left > at.branchHeads[i - 1]!.right), "side by side");
  assert.ok(at.teams.every((k) => k.top > at.branchHeads[0]!.bottom), "Build's team under its head");
  // its lines: a stem from you to the CEO and from the CEO to the bar, which reaches every head (a drop to each, the
  // bar's ends rounded), and an elbow to each kind of work
  assert.equal(at.stems.length, 2);
  assert.ok(at.stems[0]!.top >= at.founder.bottom - 1 && at.stems[0]!.bottom <= at.ceo.top + 1 && at.stems[1]!.top >= at.ceo.bottom - 1, "the stems between the rungs");
  assert.ok(at.stems[1]!.mid > at.branches[0]!.mid && at.stems[1]!.mid < at.branches.at(-1)!.mid, "the CEO's stem lands on the bar");
  assert.deepEqual(at.lines.branch.map(([b, a]) => [b?.top ?? "0px", b?.right ?? "0px", a?.top ?? "0px", a?.left ?? "0px"]), [["0px", "0px", "2px", "2px"], ["2px", "0px", "2px", "2px"], ["2px", "2px", "0px", "0px"]], "first: a drop and the bar on; between: the bar both ways; last: the bar in and its drop");
  assert.deepEqual(at.lines.kind && [at.lines.kind.left, at.lines.kind.bottom], ["2px", "2px"], "an elbow to a kind of work");
  assert.deepEqual(await measure(page), [], "the tree, at desk size");
  // a face on it still opens a career page
  await page.locator('[data-org-tree] [data-org-orb="tess"]').click();
  await page.locator('[data-career="tess"]').waitFor({ timeout: 20_000 });

  // a phone: the same tree run down the page, each rung stepped in under the one above
  const phone = await open({ width: 390, height: 844 }, true);
  at = await read(phone);
  assert.equal(at.layout, "side");
  assert.deepEqual([...at.orbs].sort(), crew.map(([id]) => id).sort());
  assert.ok(at.founder.bottom < at.ceo.top && at.ceo.bottom < at.branchHeads[0]!.top, "you, then the CEO, then the heads");
  assert.ok(at.branches.every((b, i) => i === 0 || b.top > at.branches[i - 1]!.bottom), "one department under another");
  assert.ok(at.branchHeads.every((b) => b.left > at.ceo.left + 10), "stepped in under the CEO");
  assert.deepEqual(at.lines.branch.map(([b]) => b && [b.left, b.bottom]), at.branches.map(() => ["2px", "2px"]), "an elbow to each department");
  assert.deepEqual(await measure(phone), [], "the tree, at phone size");
});
