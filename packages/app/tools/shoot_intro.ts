// Pictures of the first-open story, Settings and the phone menu, for the owner:
// `node tools/shoot_intro.ts <dir>`.
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { build } from "vite";
import type { Page } from "playwright-core";
import { launch, serveDir } from "../test/harness.ts";

const APP = new URL("..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "orbs-shoot-intro-"));
await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
const site = await serveDir(out);
const browser = await launch();
const dir = process.argv[2]!;
const beat = (p: Page) => p.locator("[data-onboarding]").getAttribute("data-onboarding");
for (const [name, vp] of [["desk", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/orbs.html?splash=0`);
  await page.locator("[data-onboarding]").waitFor();
  const shot = new Set<string>();
  for (let n = 0; n < 60; n++) {
    const b = (await beat(page))!;
    if (!shot.has(b)) {
      shot.add(b);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: join(dir, `intro-${b}-${name}.png`) });
    }
    if (b === "hire") break;
    if (b === "ask-name") {
      await page.getByRole("textbox", { name: "Your name" }).fill("Robin");
      await page.keyboard.press("Enter");
    } else await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
  }
  await page.getByRole("button", { name: "Show me the office" }).click();
  await page.waitForTimeout(800);
  if (name === "phone") {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(dir, "menu-phone.png") });
    await page.keyboard.press("Escape");
  }
  await page.goto(`${site.url}/orbs.html?splash=0#/settings`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(dir, `settings-${name}.png`), fullPage: true });
  await ctx.close();
}
await browser.close();
await site.close();
