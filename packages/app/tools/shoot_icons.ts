// The app's icons, drawn by the real orb (PLAN 2.7): `node tools/shoot_icons.ts` writes
// public/icons/orbs-192.png, orbs-512.png and orbs-maskable-512.png (him inside the maskable
// safe zone, the middle 80%). Run it again when his look changes.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launch, serveDir } from "../test/harness.ts";

const APP = new URL("..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "orbs-shoot-icons-"));
await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true, rollupOptions: { input: { icon: "icon.html" } } } });
const site = await serveDir(out);
const browser = await launch();
const dir = join(APP, "public", "icons");
mkdirSync(dir, { recursive: true });
for (const [file, size, pad] of [["orbs-192.png", 192, 0.06], ["orbs-512.png", 512, 0.06], ["orbs-maskable-512.png", 512, 0.16]] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1, colorScheme: "dark" });
  await page.goto(`${site.url}/icon.html?size=${size}&pad=${pad}`);
  await page.locator("[data-icon] canvas, [data-icon] img").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600); // the still frame drawn
  await page.locator("[data-icon]").screenshot({ path: join(dir, file) });
  await page.close();
  console.log(`wrote ${join(dir, file)}`);
}
await browser.close();
await site.close();
rmSync(out, { recursive: true, force: true });
