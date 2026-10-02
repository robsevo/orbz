// PLAN 2.11_t, the notification centre in the app, on a real home:
//   - The side menu counts what is out, quietly (a badge).
//   - The room groups it by orb: a bill coming due with its amount and day, an approval waiting.
//   - An approval opens where its card waits; answered, it is put away (and what he says after is
//     finished work).
//   - Putting one away on one device puts it away on the other, as it happens.
//   - Nothing spills at phone or desk size.
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
  dist = mkdtempSync(join(tmpdir(), "orbs-notices-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const tomorrow = (): string => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("the notification centre: counted on the side menu, grouped by orb, opening where it came from, put away on every device", { skip }, async (t) => {
  const model = await fakeModel(t, [{ calls: [{ name: "shell", args: { command: "echo backup" } }] }, { chunks: ["Okay, I left it alone."] }]);
  const data = mkdtempSync(join(tmpdir(), "orbs-notices-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { decide: (def) => (def.name === "shell" ? "ask" : "allow"), passWaitMs: 20 },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  h.inbox.addOrb("hazel", "Hazel", "devops", { shape: "bean", eyes: "classic", hue: "amber" });
  h.notices.remind({ orb: "ada", kind: "bill", title: "Rent", due: tomorrow(), amount: "$1,200" });
  h.inbox.send("hazel", "chat:hazel", "back up the site");
  for (let i = 0; i < 40 && !h.conversations.openCard("chat:hazel"); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(h.conversations.openCard("chat:hazel"), "control: Hazel waits on a card");

  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const device = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 }); // paired, the office open (a phone's menu starts hidden)
    return page;
  };
  const desk = await device({ width: 1280, height: 900 });
  const menu = desk.getByRole("button", { name: "Notifications, 2 waiting" });
  await menu.waitFor({ timeout: 20_000 });
  assert.equal(await desk.locator("[data-badge]").innerText(), "2");
  await menu.click();
  assert.equal(await desk.evaluate(() => location.hash), "#/notices");
  const ada = desk.locator('[data-notices="ada"]');
  await ada.waitFor();
  assert.match(await ada.innerText(), /Ada[\s\S]*Rent is due tomorrow[\s\S]*Bill · \$1,200 · Due /);
  const hazel = desk.locator('[data-notices="hazel"]');
  assert.match(await hazel.innerText(), /Hazel[\s\S]*Waiting for your OK/);
  // the side menu: Hazel's dot says he waits for you, from the moment the page opened (PLAN 2.3, 2.4)
  await desk.locator('[data-mood-dot="waiting"]').waitFor({ timeout: 20_000 });
  assert.equal(await desk.locator("[data-mood-dot]").count(), 1, "only Hazel waits");
  assert.deepEqual(await measure(desk), [], "nothing spills at desk size");

  // a phone, the same office: it hears the rent put away on the desk
  const phone = await device({ width: 390, height: 844 });
  await phone.goto(phone.url().replace(/#.*$/, "#/notices"));
  await phone.locator('[data-notices="ada"]').waitFor({ timeout: 20_000 });
  await phone.locator('[data-stream="open"]').waitFor({ timeout: 20_000 }); // listening: what the desk does now shows as it happens
  assert.deepEqual(await measure(phone), [], "nor at phone size");
  // one live stream a page, however many rooms and orbs listen (a browser keeps ~6 connections to a host)
  for (let i = 0; i < 100 && h.live.listenerCount("event") !== 2; i++) await new Promise((r) => setTimeout(r, 50)); // a closed one leaves the home a moment later
  assert.equal(h.live.listenerCount("event"), 2, "the desk's one and the phone's one");
  await ada.getByRole("button", { name: "Put away: Rent is due tomorrow" }).click();
  await phone.locator('[data-notices="ada"]').waitFor({ state: "detached", timeout: 20_000 });
  assert.equal(h.notices.list().length, 1, "away on the home");
  await desk.getByRole("button", { name: "Notifications, 1 waiting" }).waitFor();

  // an approval opens where its card waits
  await hazel.getByRole("button", { name: "Open" }).click();
  assert.equal(await desk.evaluate(() => location.hash), "#/chat/Hazel");
  await desk.locator("[data-card]").waitFor({ timeout: 20_000 });
  await desk.locator("[data-card]").getByRole("button", { name: "Deny" }).click();
  // answered, the approval is put away; what he says after it is finished work, the one notice out
  for (let i = 0; i < 60 && !h.notices.list().some((n) => n.kind === "done"); i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(h.notices.list().map((n) => [n.kind, n.title, n.detail]), [["done", "Hazel finished", "Okay, I left it alone."]]);
  await desk.getByRole("button", { name: "Notifications, 1 waiting" }).waitFor({ timeout: 20_000 });
});
