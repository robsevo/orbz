// The app's icons, drawn by the real orbs (PLAN 2.7; the office on its card, owner 10-03, src/icon.tsx):
// `node tools/shoot_icons.ts` writes public/icons/orbs-192.png and orbs-512.png (the rounded card,
// its corners clear: the browser's and the desktop's icon, tools/desktop/install.sh) and
// orbs-maskable-512.png (edge to edge, the orbs inside the safe zone, the middle 80%), orbs-apple-180.png
// (an iPhone's home screen: edge to edge and opaque, since the phone rounds it and paints a clear pixel
// black) and orbs-32.png and orbs-16.png (the window's title bar and a tab: the card made smaller in
// halving steps, which keeps the three orbs clear where drawing them that small would blur them). Run
// it again when their look changes.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
for (const [file, size, how] of [["orbs-192.png", 192, "pad=0.06"], ["orbs-512.png", 512, "pad=0.06"], ["orbs-maskable-512.png", 512, "bleed=1"], ["orbs-apple-180.png", 180, "bleed=1&room=0.88"]] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1, colorScheme: "dark" });
  await page.goto(`${site.url}/icon.html?size=${size}&${how}`);
  await page.waitForFunction(() => document.querySelectorAll("[data-icon] canvas").length >= 3, undefined, { timeout: 20_000 });
  await page.waitForTimeout(800); // each still frame drawn
  await page.locator("[data-icon]").screenshot({ path: join(dir, file), omitBackground: true }); // the card's corners stay clear
  await page.close();
  console.log(`wrote ${join(dir, file)}`);
}
// the title bar's sizes, from the 512 card, halved step by step on a canvas
{
  const page = await browser.newPage();
  const big = `data:image/png;base64,${readFileSync(join(dir, "orbs-512.png")).toString("base64")}`;
  for (const size of [32, 16]) {
    const png = await page.evaluate(async ({ src, size }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      let c = document.createElement("canvas");
      c.width = c.height = img.width;
      c.getContext("2d")!.drawImage(img, 0, 0);
      while (c.width > size) {
        const next = document.createElement("canvas");
        next.width = next.height = Math.max(size, Math.round(c.width / 2));
        const g = next.getContext("2d")!;
        g.imageSmoothingQuality = "high";
        g.drawImage(c, 0, 0, next.width, next.height);
        c = next;
      }
      return c.toDataURL("image/png").split(",")[1]!;
    }, { src: big, size });
    writeFileSync(join(dir, `orbs-${size}.png`), Buffer.from(png, "base64"));
    console.log(`wrote ${join(dir, `orbs-${size}.png`)}`);
  }
  await page.close();
}
await browser.close();
await site.close();
rmSync(out, { recursive: true, force: true });
