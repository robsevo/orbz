// Renders the app at desk and phone sizes, an orb in the office and a new orb on every tab, and
// saves the pictures the owner looks at: `node tools/shoot.ts <dir>` (measure() findings print too).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launch, measure, plainNewOrb, serveDir } from "../test/harness.ts";
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
  await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
  await page.waitForSelector("canvas", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  console.log(name, "office", "errors:", errs.slice(0, 3), "findings:", await measure(page));
  await page.screenshot({ path: join(dir, `office-${name}.png`), fullPage: true });
  await plainNewOrb(page);
  await page.waitForTimeout(500);
  console.log(name, "new", "findings:", await measure(page));
  await page.screenshot({ path: join(dir, `new-${name}.png`), fullPage: true });
  for (const tab of ["Personality", "Specialty", "Shape", "Eyes", "Hat", "Glasses", "Colour", "Voice"]) {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(400);
    const panel = page.getByRole("tablist").locator("..");
    if (name === "desk") await panel.screenshot({ path: join(dir, `tab-${tab.toLowerCase()}.png`) });
    const f = await measure(page);
    if (f.length) console.log(name, tab, "findings:", f);
  }
  await page.close();
}
await browser.close();
await site.close();
