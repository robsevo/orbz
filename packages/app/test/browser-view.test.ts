// PLAN 4.1's view, on a real home with a real browser of his own and a stand-in web (shop.test,
// this machine, named through the guard's resolver seam):
//   - his Browser tab: asleep until he opens a page; then the still of his screen, its address,
//     and his face where he clicked, new with every act;
//   - your hand on it: take over and hand back reach his computer; a reset takes two presses, and
//     signs him out;
//   - a password saved in Settings is listed by site and username and never shown back: once
//     saved, it is in no field and nowhere in the page;
//   - nothing spills at desk or phone size.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test, type TestContext } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { chromiumPath } from "../../home/src/computer/browser.ts";
import { web } from "../../home/test/fakes/web.ts";

const LONG = { timeout: 150_000 };
const APP = fileURLToPath(new URL("..", import.meta.url));
const EXE = chromiumPath();
const skip = findChrome() && EXE ? false : "no Chromium on this machine";
const PASSWORD = "hunter2-correct-horse";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-browser-view-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

/** With ORBS_SHOTS=<dir>, a picture of each stage for the owner. */
const shot = async (page: Page, name: string): Promise<void> => {
  if (process.env.ORBS_SHOTS) await page.screenshot({ path: join(process.env.ORBS_SHOTS, `browser-${name}.png`) });
};

async function onHome(t: TestContext) {
  const data = mkdtempSync(join(tmpdir(), "orbs-browser-view-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, computer: { executable: EXE, store: new MemoryStore() } });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "data", { shape: "bean", eyes: "classic", hue: "amber" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.getByText("CEO Robin").waitFor({ timeout: 30_000 });
  return { h, page };
}

test("his Browser tab: the still of his screen, its address, his face where he clicked; take over, hand back, a reset in two presses", { skip, ...LONG }, async (t) => {
  const site = await web(t);
  const { h, page } = await onHome(t);
  await page.getByRole("button", { name: "Chat with Hazel" }).click();
  const computer = page.locator('[data-computer="hazel"]');
  await computer.getByRole("tab", { name: "Browser" }).click();
  await computer.getByText("His browser is asleep: it wakes when he opens a page.").waitFor();
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });

  await h.computers.open("hazel", site.url("shop.test", "/shop"));
  await computer.locator("[data-address]", { hasText: "/shop" }).waitFor({ timeout: 20_000 });
  assert.equal(await computer.locator("[data-browser-cursor]").count(), 0, "he has only looked: no cursor yet");
  await h.computers.click("hazel", "About us");
  await computer.locator("[data-address]", { hasText: "/about" }).waitFor({ timeout: 20_000 });
  const img = computer.locator("[data-browser] img");
  await page.waitForFunction((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0, await img.elementHandle());
  assert.equal(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth), 1280, "his whole screen, as he sees it");
  assert.match(String(await computer.getByRole("link", { name: "Open Hazel's screen at full size" }).getAttribute("href")), /\/orbs\/hazel\/screen\.jpg\?shot=\d+$/, "a press opens it at its own size");
  await computer.locator("[data-browser-cursor]").waitFor();
  const c = (await computer.locator("[data-browser-cursor]").boundingBox())!;
  const b = (await img.boundingBox())!;
  const [cx, cy] = [c.x + c.width / 2, c.y + c.height / 2]; // his face's middle is where he clicked
  assert.ok(cx > b.x && cx < b.x + b.width && cy > b.y && cy < b.y + b.height, `his face is on his screen, where he clicked (${Math.round(cx)},${Math.round(cy)} in ${JSON.stringify(b)})`);
  await shot(page, "after-a-click");

  await computer.getByRole("button", { name: "Take over" }).click();
  await computer.getByText("You have his computer: his browser waits until you hand it back.").waitFor();
  assert.equal(h.computers.takenOver("hazel"), true, "your hand reached his computer");
  await assert.rejects(h.computers.click("hazel", "About us"), /the person has your computer/);
  await computer.getByRole("button", { name: "Hand back" }).click();
  await computer.getByRole("button", { name: "Take over" }).waitFor();
  assert.equal(h.computers.takenOver("hazel"), false);

  await computer.getByRole("button", { name: "Reset his browser" }).click();
  await computer.getByText("Sign him out of every site?").waitFor();
  await computer.getByRole("button", { name: "Keep" }).click();
  assert.equal(h.events.ofType("computer.reset").length, 0, "one press asks; Keep keeps");
  await computer.getByRole("button", { name: "Reset his browser" }).click();
  await computer.getByRole("button", { name: "Reset", exact: true }).click();
  await computer.getByText("His browser is asleep: it wakes when he opens a page.").waitFor({ timeout: 20_000 });
  assert.equal(h.events.ofType("computer.reset").length, 1, "the second press resets him");

  assert.deepEqual(await measure(page), [], "nothing spills at desk size");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "nor at phone size");
  await shot(page, "phone");
});

test("a password saved in Settings is listed by site and username, and never shown back", { skip, ...LONG }, async (t) => {
  const { h, page } = await onHome(t);
  await page.evaluate(() => (location.hash = "#/settings"));
  const panel = page.getByRole("region", { name: "Passwords" });
  await panel.waitFor();
  await panel.getByLabel("The site's sign-in address", { exact: true }).fill("https://login.test/login");
  await panel.getByLabel("Username", { exact: true }).fill("robin");
  await panel.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await panel.getByRole("button", { name: "Save the password" }).click();
  await panel.locator('[data-password="login.test"]').waitFor();
  assert.match(await panel.locator('[data-password="login.test"]').innerText(), /login\.test\s+robin/);
  assert.equal(await panel.getByLabel("Password", { exact: true }).inputValue(), "", "the field is empty once it is saved");
  assert.ok(!(await page.content()).includes(PASSWORD), "and the password is nowhere in the page");
  assert.deepEqual(h.vault.list().map((e) => [e.site, e.username]), [["login.test", "robin"]], "kept on the home");
  await shot(page, "passwords");

  await panel.getByLabel("The site's sign-in address", { exact: true }).fill("not a site");
  await panel.getByLabel("Username", { exact: true }).fill("x");
  await panel.getByLabel("Password", { exact: true }).fill("y");
  await panel.getByRole("button", { name: "Save the password" }).click();
  await panel.getByRole("alert").waitFor();
  assert.match(await panel.getByRole("alert").innerText(), /is not a site's address/);

  await panel.getByRole("button", { name: "Remove the password for robin on login.test" }).click();
  await panel.locator('[data-password="login.test"]').waitFor({ state: "detached" });
  assert.deepEqual(h.vault.list(), []);
  assert.deepEqual(await measure(page), [], "nothing spills at desk size");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "nor at phone size");
});
