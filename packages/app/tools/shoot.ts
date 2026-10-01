// Renders the character creator at desk and phone sizes, each picker tab included, and saves the
// pictures the owner looks at: `node tools/shoot.ts <dir>` (measure() findings are printed too).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launch, measure, serveDir } from "../test/harness.ts";
const APP = new URL("..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "orbs-shoot-"));
await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
const site = await serveDir(out);
const browser = await launch();
const dir = process.argv[2]!;
for (const [name, vp] of [["desk", { width: 1280, height: 1100 }], ["phone", { width: 390, height: 844 }]] as const) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.addInitScript(() => { (globalThis as { __orbsTime?: number }).__orbsTime = 3.4; });
  await page.goto(`${site.url}/orbs.html`);
  await page.waitForSelector("canvas", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  console.log(name, "errors:", errs.slice(0, 3), "findings:", (await measure(page)).slice(0, 6));
  await page.screenshot({ path: join(dir, `orbs-${name}.png`), fullPage: true });
  if (name === "desk") {
    for (const tab of ["Shape", "Eyes", "Wears", "Voice", "Personality"]) {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(400);
      const panel = page.getByRole("tablist").locator("..");
      await panel.screenshot({ path: join(dir, `tab-${tab.toLowerCase()}.png`) });
      console.log(tab, "findings:", (await measure(page)).slice(0, 4));
    }
  }
  await page.close();
}
await browser.close();
await site.close();
