// Pictures of the opening splash for the owner: `node tools/shoot_splash.ts <dir>` (held by a slow
// stand-in home so the waking can be caught at rest).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launch, serveDir } from "../test/harness.ts";
const APP = new URL("..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "orbs-shoot-splash-"));
await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
const site = await serveDir(out);
const browser = await launch();
const dir = process.argv[2]!;
for (const [name, vp] of [["desk", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]] as const) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
  await page.addInitScript(() => { (globalThis as { __orbsReady?: Promise<unknown> }).__orbsReady = new Promise(() => {}); });
  await page.goto(`${site.url}/orbs.html`);
  await page.getByText("Waking your home…").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(dir, `splash-${name}.png`) });
  await page.close();
}
await browser.close();
await site.close();
