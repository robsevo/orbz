// Every hat close up on one orb, on one sheet (tools/hat_sheet.tsx): `node tools/shoot_hats.ts <out.png>
// [--size 200] [--cols 7] [--hues azure,coral] [--shape bean] [--wears "top hat,crown"] [--theme light] [--kind glasses|eyes]
// [--framing portrait] [--ears out]` (glasses and eyes are drawn close up; `--ears out`: an eared orb's ears out of its hat).
import { mkdtempSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { launch, serveDir } from "../test/harness.ts";
const APP = new URL("..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "orbs-hats-"));
await build({
  root: APP, configFile: false, logLevel: "silent", plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: out, emptyOutDir: true, lib: { entry: join(APP, "tools/hat_sheet.tsx"), formats: ["es"], fileName: () => "sheet.js" } },
});
const site = await serveDir(out);
const browser = await launch();
const file = process.argv[2]!;
const arg = (k: string): string | undefined => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const query = new URLSearchParams(
  Object.entries({ size: arg("--size"), cols: arg("--cols"), hues: arg("--hues"), shape: arg("--shape"), wears: arg("--wears"), theme: arg("--theme"), kind: arg("--kind"), framing: arg("--framing"), pose: arg("--pose"), into: arg("--into"), ears: arg("--ears") }).filter(([, v]) => v) as [string, string][],
).toString();
writeFileSync(join(out, "hats.html"), `<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module">import { mount } from "./sheet.js"; mount();</script>`);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: Number(arg("--dpr") ?? 1), colorScheme: arg("--theme") === "light" ? "light" : "dark" });
await page.addInitScript(() => { (globalThis as { __orbsTime?: number }).__orbsTime = 3.4; });
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
await page.goto(`${site.url}/hats.html${query ? `?${query}` : ""}`);
await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, undefined, { timeout: 300_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: file, fullPage: true });
await page.close();
await browser.close();
await site.close();
