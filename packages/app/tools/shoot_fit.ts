// Every shape in every hat, and in every pair of glasses, on one sheet each (owner, 10-01: "some
// accessories arent fitting the heads of the orbs right. please fix per shape"):
// `node tools/shoot_fit.ts <dir>` saves fit-hats.png and fit-glasses.png there.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { launch, serveDir } from "../test/harness.ts";
const APP = new URL("..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "orbs-fit-"));
await build({
  root: APP, configFile: false, logLevel: "silent", plugins: [react()], // the sheet alone, as one module
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: out, emptyOutDir: true, lib: { entry: join(APP, "tools/fit_sheet.tsx"), formats: ["es"], fileName: () => "sheet.js" } },
});
const site = await serveDir(out);
const browser = await launch();
const dir = process.argv[2]!;
for (const kind of ["hat", "glasses"] as const) {
  writeFileSync(join(out, `${kind}.html`), `<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module">import { mount } from "./sheet.js"; mount("${kind}");</script>`);
  const page = await browser.newPage({ viewport: { width: 2600, height: 1600 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await page.addInitScript(() => { (globalThis as { __orbsTime?: number }).__orbsTime = 3.4; });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  await page.goto(`${site.url}/${kind}.html`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(dir, `fit-${kind === "hat" ? "hats" : "glasses"}.png`), fullPage: true });
  await page.close();
}
await browser.close();
await site.close();
