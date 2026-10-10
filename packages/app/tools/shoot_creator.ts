// The creator's editor, a tab at a time, for the owner: `node tools/shoot_creator.ts <dir> [--tabs Colour,Shape] [--any]`
// saves editor-<tab>-<size>.png (the editor's card) and studio-<size>.png (the screen as you see it, not the whole page),
// at desk and phone sizes; `--any` opens the orb's Any colour picker first. measure()'s findings print with each.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launch, measure, plainNewOrb, seedOffice, serveDir } from "../test/harness.ts";
const APP = new URL("..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "orbs-shoot-creator-"));
await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
const site = await serveDir(out);
const browser = await launch();
const dir = process.argv[2]!;
const arg = (k: string): string | undefined => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const tabs = (arg("--tabs") ?? "Colour").split(",");
for (const [name, vp] of [["desk", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
  await seedOffice(page);
  await page.addInitScript(() => { (globalThis as { __orbsTime?: number }).__orbsTime = 3.4; });
  await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
  await page.waitForSelector("canvas", { state: "attached" });
  await plainNewOrb(page);
  for (const tab of tabs) {
    await page.getByRole("tab", { name: tab }).click();
    if (tab === "Colour" && process.argv.includes("--any")) await page.locator('[data-colour-any="orb"]').click();
    await page.waitForTimeout(700);
    const f = await measure(page);
    console.log(name, tab, "findings:", f);
    await page.locator("[data-editor]").screenshot({ path: join(dir, `editor-${tab.toLowerCase()}-${name}.png`) });
  }
  // the screen as it is seen while choosing: scrolled to the editor's choices
  await page.locator("[data-editor]").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => scrollBy(0, 160));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dir, `studio-${name}.png`) });
  await page.close();
}
await browser.close();
await site.close();
