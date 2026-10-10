// PLAN 1.11_t in the app (the brains, in Settings), on a real home with a stand-in keychain and a
// fake Gemini:
//   - The order as it stands: ChatGPT, Gemini, the local coder, each not set up.
//   - A Gemini key kept (checked by Gemini first) makes it ready, its model named; the key never
//     comes back to the page. A key Gemini refuses says why, and nothing is kept.
//   - A local coder kept is ready; removed, it is not. Nothing spills at desk or phone size.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;
const KEY = "test-gemini-key-not-real-0123456789";

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-brains-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("the brains in Settings: the order, a Gemini key kept (never shown back), a refused one, a local coder", { skip, timeout: 150_000 }, async (t) => {
  const gemini = await fakeModel(t, []);
  gemini.models = ["models/gemini-3.5-flash", "models/gemini-3.8-flash"];
  const data = mkdtempSync(join(tmpdir(), "orbs-brains-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const store = new MemoryStore();
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, brains: { store, geminiBase: gemini.url }, chatgpt: { store: new MemoryStore() } });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.goto(page.url().replace(/#.*$/, "#/settings"));
  const brains = page.getByRole("region", { name: "Brains" });
  await brains.locator("[data-brain]").first().waitFor({ timeout: 20_000 });
  const order = async () => brains.locator("[data-brain]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-brain")}:${e.getAttribute("data-state")}`));
  assert.deepEqual(await order(), ["chatgpt:absent", "gemini:absent", "local:absent"]);
  assert.ok(await brains.getByRole("button", { name: "Continue with ChatGPT" }).isVisible());

  // your projects folder (owner, 10-04): off in a test home, a folder of yours, on, copied now
  const folder = page.getByRole("region", { name: "Your projects folder" });
  await folder.waitFor({ timeout: 20_000 });
  assert.match(await folder.innerText(), /Off: nothing is copied/);
  const out = mkdtempSync(join(tmpdir(), "orbs-projects-ui-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  await folder.getByLabel("Projects folder").fill("not/a/whole/path");
  await folder.getByRole("button", { name: "Use this folder" }).click();
  await folder.getByRole("alert").waitFor({ timeout: 10_000 });
  assert.match(await folder.getByRole("alert").innerText(), /whole path/);
  await folder.getByLabel("Projects folder").fill(out);
  await folder.getByRole("button", { name: "Use this folder" }).click();
  await folder.getByRole("button", { name: "Copying: off" }).click();
  await folder.getByRole("button", { name: "Copying: on" }).waitFor({ timeout: 10_000 });
  await folder.getByRole("button", { name: "Copy now" }).click();
  await folder.locator("[data-projects-last]").filter({ hasText: /Last copied just now/ }).waitFor({ timeout: 10_000 });
  assert.equal(h.projects.state().dir, out);

  // web search: off at a glance until a key is kept, then on, in green (owner, 10-04)
  assert.equal(await brains.locator("[data-search]").getAttribute("data-search"), "off");
  await brains.getByLabel("Your Tavily key").fill("tvly-test-not-a-real-key-000000000000");
  await brains.getByLabel("Your Tavily key").locator("xpath=ancestor::*[.//button[normalize-space()='Keep']][1]").getByRole("button", { name: "Keep" }).click();
  await brains.locator('[data-search="on"]').waitFor({ timeout: 20_000 });
  assert.match(await brains.locator("[data-search]").innerText(), /On: your orbs can search the web/);
  const [shown, green] = await brains.locator("[data-search]").evaluate((el) => {
    const probe = document.createElement("i");
    probe.style.color = "var(--ok)";
    el.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).color, want];
  });
  assert.equal(shown, green, "in the theme's own green");

  await brains.getByLabel("Your Gemini key").fill(KEY);
  await brains.getByRole("button", { name: "Keep" }).first().click();
  await brains.locator('[data-brain="gemini"][data-state="ready"]').waitFor({ timeout: 20_000 });
  assert.match(await brains.innerText(), /Gemini · gemini-3\.8-flash/);
  assert.equal(await brains.getByLabel("Your Gemini key").inputValue(), "", "the key never comes back to the page");
  assert.ok(!(await page.content()).includes(KEY));

  gemini.modelsStatus = 401;
  await brains.getByLabel("Your Gemini key").fill("test-gemini-key-not-real-refused-0000");
  await brains.getByRole("button", { name: "Keep" }).first().click();
  await brains.getByRole("alert").waitFor({ timeout: 20_000 });
  assert.equal(h.brains.status().gemini?.model, "gemini-3.8-flash", "refused, nothing changed: the key that worked is the one kept");
  assert.match(await brains.getByRole("alert").innerText(), /key/i);

  await brains.getByLabel("Its address").fill(gemini.url);
  await brains.getByLabel("Its model").fill("coder");
  await brains.getByRole("button", { name: "Keep" }).last().click();
  await brains.locator('[data-brain="local"][data-state="ready"]').waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(page), [], "nothing spills at desk size");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await measure(page), [], "nor at phone size");
  await brains.getByRole("button", { name: "Remove" }).last().click();
  await brains.locator('[data-brain="local"][data-state="absent"]').waitFor({ timeout: 20_000 });
});

// owner, 10-10: "organize it professionally ... just organize the containers better". Settings has an index beside its
// sections on a wide screen: a press takes you to one and lights it; the last, which can never reach the top, too.
test("Settings' index: a press takes you to its section and lights it, the last one too", { skip, timeout: 120_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-settings-index-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, brains: { store: new MemoryStore() }, chatgpt: { store: new MemoryStore() } });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.goto(page.url().replace(/#.*$/, "#/settings"));
  const index = page.getByRole("navigation", { name: "Settings sections" });
  await index.waitFor({ timeout: 20_000 });
  const lit = (): Promise<string[]> => index.locator('[aria-current="location"]').allInnerTexts();
  const top = (name: string): Promise<number> => page.getByRole("region", { name }).evaluate((el) => el.getBoundingClientRect().top);
  // the control: the brains start below the fold, and You is the one lit
  assert.ok((await top("Brains")) > 900, "control: the brains are below the fold");
  assert.deepEqual(await lit(), ["You"]);
  await index.getByRole("link", { name: "Brains" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Brains"]')!.getBoundingClientRect().top < innerHeight * 0.3, undefined, { timeout: 10_000 });
  assert.deepEqual(await lit(), ["Brains"], "the brains lit");
  assert.equal(await page.evaluate(() => location.hash), "#/settings", "still Settings: a way round the page, not another place");
  // the last one: as far down as the page goes, lit
  await index.getByRole("link", { name: "Devices" }).click();
  await page.waitForFunction(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 2, undefined, { timeout: 10_000 });
  await page.waitForTimeout(300);
  assert.deepEqual(await lit(), ["Devices"], "the last section lit");
  assert.ok((await top("Your devices")) < 900, "and in view");
});

test("the first open asks what he thinks with: a Gemini key kept there, then you make him", { skip, timeout: 150_000 }, async (t) => {
  const gemini = await fakeModel(t, []);
  gemini.models = ["models/gemini-3.8-flash"];
  const data = mkdtempSync(join(tmpdir(), "orbs-brains-first-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, brains: { store: new MemoryStore(), geminiBase: gemini.url }, chatgpt: { store: new MemoryStore() } });
  t.after(() => h.close());
  h.start();
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator("[data-onboarding]").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Skip the story" }).click();
  await page.getByRole("textbox", { name: "Your name" }).fill("Robin");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Skip the story" }).click();
  // your company's name (owner, 10-07: "the user first picks his own name, the company name, hires the CEO")
  await page.getByRole("textbox", { name: "Your company's name" }).fill("Acme Orbs");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Skip the story" }).click();
  // what it can spend (PLAN 5.20, owner 10-08): a skip still asks
  await page.getByRole("button", { name: "Nothing yet" }).click();
  await page.getByRole("button", { name: "Skip the story" }).click();
  const step = page.locator("[data-brains-step]");
  await step.getByLabel("Your Gemini key", { exact: true }).fill(KEY);
  await step.getByRole("button", { name: "Keep" }).first().click();
  await step.locator('[data-brain-done="gemini"]').waitFor({ timeout: 20_000 });
  assert.match(await step.innerText(), /✓ Gemini, gemini-3\.8-flash/);
  assert.ok(!(await page.content()).includes(KEY), "the key never comes back to the page");
  assert.equal(h.brains.status().gemini?.model, "gemini-3.8-flash", "kept by the home, as in Settings");
  assert.deepEqual(await measure(page), [], "the step fits a phone");
  await step.getByRole("button", { name: "Next" }).click();
  for (let n = 0; n < 20 && !(await page.getByRole("button", { name: "Make me" }).isVisible()); n++) await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Make me" }).click();
  await page.locator("[data-onboarding]").waitFor({ state: "detached" });
  assert.equal(await page.getByRole("tablist").count(), 1, "then the creator");
});
