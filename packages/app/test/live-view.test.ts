// PLAN 4.6_t's view, at phone size, on a real home with a real browser of his own and a stand-in
// web: you watch his screen live; you take over, and a press on his screen is a click there (the
// link under it opens), what you type lands in his page; his terminal takes your command, run in
// his sandbox, while you have him; you hand him back; nothing spills.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { chromiumPath } from "../../home/src/computer/browser.ts";
import { web } from "../../home/test/fakes/web.ts";

const LONG = { timeout: 150_000 };
const APP = fileURLToPath(new URL("..", import.meta.url));
const EXE = chromiumPath();
const skip = findChrome() && EXE ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-live-view-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const shot = async (page: Page, name: string): Promise<void> => {
  if (process.env.ORBS_SHOTS) await page.screenshot({ path: join(process.env.ORBS_SHOTS, `live-${name}.png`) });
};

test("at phone size: watch him live, take over, press his screen, type on his page, run a command, hand back", { skip, ...LONG }, async (t) => {
  const site = await web(t);
  const data = mkdtempSync(join(tmpdir(), "orbs-live-view-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, computer: { executable: EXE } });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "data", { shape: "bean", eyes: "classic", hue: "amber" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 }); // the app is up (at phone size the side menu, with the CEO badge, is folded away)
  await h.computers.open("hazel", site.url("shop.test", "/big-link"));
  await page.evaluate(() => (location.hash = "#/chat/hazel"));
  // a phone's chat opens on the conversation; his computer is a press away (10-07)
  await page.getByRole("button", { name: "Hazel's computer" }).click();
  const computer = page.locator('[data-computer="hazel"]');
  await computer.getByRole("tab", { name: "Browser" }).click();
  await page.locator('[data-stream="open"]').waitFor({ state: "attached", timeout: 20_000 }); // the chat, behind his computer on a phone

  await computer.getByRole("button", { name: "Watch live" }).click();
  const live = computer.locator("img[data-live]");
  await page.waitForFunction((el) => (el as HTMLImageElement).naturalWidth > 0, await live.elementHandle(), { timeout: 20_000 });
  assert.equal(await computer.getByText("live", { exact: true }).count(), 1, "it says it is live");

  // a picture in picture (owner, 10-11: "resizeable pip in chat or sessions when taking control or just viewing orbs
  // computer, full screen option"): it floats inside the phone, sized from its corner, moved by its top, never past an edge
  await computer.locator("[data-computer-pip]").click();
  assert.equal(await computer.getAttribute("data-floating"), "true", "his live computer floats over the chat");
  const boxOf = async () => (await computer.boundingBox())!;
  const b0 = await boxOf();
  assert.ok(b0.x >= 0 && b0.y >= 0 && b0.x + b0.width <= 390.5 && b0.y + b0.height <= 844.5, `inside the phone (${JSON.stringify(b0)})`);
  const pull = async (at: { x: number; y: number }, dx: number, dy: number): Promise<void> => {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + dx, at.y + dy, { steps: 5 });
    await page.mouse.up();
  };
  const grip = (await computer.locator("[data-computer-grip]").boundingBox())!;
  await pull({ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, -40, -120);
  const b1 = await boxOf();
  assert.ok(Math.abs(b1.height - (b0.height - 120)) <= 2 && b1.width < b0.width && b1.width >= 299.5, `smaller from its corner, never under its least (${JSON.stringify([b0, b1])})`);
  const top = (await computer.locator("[data-computer-head]").boundingBox())!;
  await pull({ x: top.x + 70, y: top.y + top.height / 2 }, -300, -200);
  const b2 = await boxOf();
  assert.ok(Math.abs(b2.y - (b1.y - 200)) <= 2 && Math.abs(b2.x) <= 0.5, `moved by its top, and stopped at the phone's edge (${JSON.stringify([b1, b2])})`);
  // full screen where the browser has none for a part of a page (an iPhone): the whole window; Escape leaves it
  await page.evaluate(() => Object.defineProperty(Element.prototype, "requestFullscreen", { value: undefined, configurable: true }));
  await computer.locator("[data-computer-fullscreen]").click();
  await page.locator('[data-computer="hazel"][data-fullscreen="true"]').waitFor();
  const whole = await boxOf();
  assert.ok(Math.abs(whole.x) < 1 && Math.abs(whole.y) < 1 && Math.abs(whole.width - 390) < 1 && Math.abs(whole.height - 844) < 1, `the whole window (${JSON.stringify(whole)})`);
  await page.keyboard.press("Escape");
  await page.locator('[data-computer="hazel"][data-fullscreen="false"][data-floating="true"]').waitFor();

  await computer.getByRole("button", { name: "Take over" }).click();
  await computer.getByText("You have Hazel's computer: a press on the screen clicks there, and Hazel waits until you hand it back.").waitFor();
  await shot(page, "taken-over");
  const box = (await live.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await computer.locator("[data-address]", { hasText: "/about" }).waitFor({ timeout: 20_000 });

  await computer.getByLabel("Go to an address").fill(site.url("shop.test", "/big-field"));
  await computer.getByRole("button", { name: "Go", exact: true }).click();
  await computer.locator("[data-address]", { hasText: "/big-field" }).waitFor({ timeout: 20_000 });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await computer.getByLabel("Type on Hazel's page").fill("hello from Robin");
  await computer.getByRole("button", { name: "Type", exact: true }).click();
  const titleNow = (): string => {
    try {
      return (JSON.parse(readFileSync(h.computers.screen("hazel").meta, "utf8")) as { title: string }).title;
    } catch {
      return "";
    }
  };
  for (let i = 0; i < 100 && titleNow() !== "hello from Robin"; i++) await page.waitForTimeout(100);
  assert.equal(titleNow(), "hello from Robin", "what you typed landed in his page");

  await computer.getByRole("tab", { name: "Terminal" }).click();
  await computer.getByLabel("A command for Hazel's terminal").fill("echo hi from Robin");
  await computer.getByRole("button", { name: "Run", exact: true }).click();
  // its output, not the command's own line (which says the same words)
  await computer.locator("[data-yours] pre").filter({ hasText: /^hi from Robin/ }).first().waitFor({ timeout: 20_000 });
  assert.match(await computer.locator("[data-yours] pre").last().innerText(), /^hi from Robin/, "his terminal ran your command");
  assert.deepEqual(await measure(page), [], "nothing spills at phone size, in your hands");
  await shot(page, "terminal");

  await computer.getByRole("tab", { name: "Browser" }).click();
  await computer.getByRole("button", { name: "Hand back" }).click();
  await computer.getByRole("button", { name: "Take over" }).waitFor();
  assert.equal(h.computers.takenOver("hazel"), false, "handed back");
  await computer.locator("[data-computer-pip]").click();
  assert.equal(await computer.getAttribute("data-floating"), "false", "the computer returns to its place in chat");
  await computer.getByRole("tab", { name: "Terminal" }).click(); // on its own tab, where the line would be
  await computer.getByRole("tab", { name: "Terminal", selected: true }).waitFor();
  assert.equal(await computer.getByLabel("A command for Hazel's terminal").count(), 0, "and the terminal is his again");
});
