// Measures every picker thumbnail: its margins to each edge of its frame and how many pieces it is
// in. The limits in test/characters.test.ts were set from what this printed.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launch, serveDir } from "../test/harness.ts";
const out = mkdtempSync(join(tmpdir(), "orbs-margins-"));
await build({ root: new URL("..", import.meta.url).pathname, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
const site = await serveDir(out);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2, colorScheme: "dark" });
await page.addInitScript(() => { (globalThis as { __orbsTime?: number }).__orbsTime = 3.4; });
await page.goto(`${site.url}/orbs.html`);
await page.waitForSelector("canvas", { state: "attached" });
for (const tab of ["Shape", "Wears"]) {
  await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button[data-pick]")].map((b) => {
    const c = b.querySelector("canvas")!; const W = c.width, H = c.height;
    const d = c.getContext("2d")!.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H); let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let i = 0; i < W * H; i++) if (d[i * 4 + 3]! >= 128) { m[i] = 1; const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    // connected pieces (4-neighbour), counting those of 6+ pixels
    const seen = new Uint8Array(W * H); let pieces = 0;
    for (let i = 0; i < W * H; i++) if (m[i] && !seen[i]) { let n = 0; const st = [i]; seen[i] = 1; while (st.length) { const j = st.pop()!; n++; const x = j % W; for (const k of [j - 1, j + 1, j - W, j + W]) if (k >= 0 && k < W * H && m[k] && !seen[k] && !((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1))) { seen[k] = 1; st.push(k); } } if (n >= 6) pieces++; }
    return `${b.dataset.pick}: W${W} H${H} top${(y0 / H).toFixed(3)} bottom${((H - 1 - y1) / H).toFixed(3)} left${(x0 / W).toFixed(3)} right${((W - 1 - x1) / W).toFixed(3)} pieces${pieces}`;
  }));
  console.log(rows.join("\n"));
}
await browser.close(); await site.close();
