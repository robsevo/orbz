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
