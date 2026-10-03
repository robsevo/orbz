// The app's icons, drawn by the real orbs (PLAN 2.7; the office on its card, owner 10-03, src/icon.tsx):
// `node tools/shoot_icons.ts` writes public/icons/orbs-192.png and orbs-512.png (the rounded card,
// its corners clear: the browser's and the desktop's icon, tools/desktop/install.sh) and
// orbs-maskable-512.png (edge to edge, the orbs inside the safe zone, the middle 80%). Run it again
// when their look changes.
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
for (const [file, size, how] of [["orbs-192.png", 192, "pad=0.06"], ["orbs-512.png", 512, "pad=0.06"], ["orbs-maskable-512.png", 512, "bleed=1"]] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1, colorScheme: "dark" });
  await page.goto(`${site.url}/icon.html?size=${size}&${how}`);
  await page.waitForFunction(() => document.querySelectorAll("[data-icon] canvas").length >= 3, undefined, { timeout: 20_000 });
  await page.waitForTimeout(800); // each still frame drawn
  await page.locator("[data-icon]").screenshot({ path: join(dir, file), omitBackground: true }); // the card's corners stay clear
  await page.close();
  console.log(`wrote ${join(dir, file)}`);
}
await browser.close();
await site.close();
rmSync(out, { recursive: true, force: true });
