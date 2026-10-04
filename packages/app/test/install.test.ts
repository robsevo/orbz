// PLAN 2.7_t (the PWA installs): served by a home, the app is installable by Chromium's own
// check (a manifest, its icons, served where a browser trusts it), and the manifest's colours are
// the tokens' (the build writes them; no file names a colour by hand).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import { chromium } from "playwright-core";
import { findChrome } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { SURFACES } from "../src/design/tokens.ts";
import { hex } from "../src/design/color.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-install-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
});
after(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("an iPhone's icon and the title bar's: the page names them; the iPhone's is a full square with no clear pixel; the app is Orbz", { skip }, () => {
  const html = readFileSync(join(dist, "orbs.html"), "utf8");
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="icons\/orbs-apple-180\.png" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Orbz" \/>/, "the name under the icon (owner, 10-03)");
  // a PNG's header: its width, height and colour type (2 is RGB, no alpha; 6 has alpha)
  const ihdr = (f: string): number[] => {
    const b = readFileSync(join(dist, "icons", f));
    return [b.readUInt32BE(16), b.readUInt32BE(20), b[25]!];
  };
  assert.deepEqual(ihdr("orbs-apple-180.png"), [180, 180, 2], "180 by 180 and opaque: an iPhone rounds it itself and paints a clear pixel black");
  for (const n of [32, 16]) {
    assert.match(html, new RegExp(`<link rel="icon" type="image/png" sizes="${n}x${n}" href="icons/orbs-${n}\\.png" />`), `the title bar's ${n}`);
    assert.deepEqual(ihdr(`orbs-${n}.png`).slice(0, 2), [n, n]);
  }
});

test("served by a home, the app installs: a manifest from the tokens, its icons, nothing Chromium objects to", { skip, timeout: 120_000 }, async (t) => {
  const manifest = JSON.parse(readFileSync(join(dist, "manifest.webmanifest"), "utf8")) as { theme_color: string; background_color: string; icons: { src: string; sizes: string; purpose: string }[]; display: string };
  assert.deepEqual([manifest.theme_color, manifest.background_color, manifest.display], [hex(SURFACES.dark.ground), hex(SURFACES.dark.ground), "standalone"]);
  for (const i of manifest.icons) assert.ok(readFileSync(join(dist, i.src)).subarray(1, 4).toString() === "PNG", `${i.src} is a picture`);
  const data = mkdtempSync(join(tmpdir(), "orbs-install-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, brains: { store: new MemoryStore() }, chatgpt: { store: new MemoryStore() } });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin"); // past the first open's story, to the office
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  // a real profile: a new context is incognito, and Chromium never installs from one
  const profile = mkdtempSync(join(tmpdir(), "orbs-install-profile-"));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findChrome()!, headless: true, viewport: { width: 390, height: 844 },
    args: ["--font-render-hinting=none", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  t.after(() => ctx.close());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(d.pairLink().replace("http://127.0.0.1", "http://localhost"));
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(installabilityErrors, [], "installable");
  // control: a page of the same build with no manifest is not, and Chromium says so
  await page.goto(`http://localhost:${d.port}/app/specimen.html`);
  const { installabilityErrors: none } = await cdp.send("Page.getInstallabilityErrors");
  assert.ok(none.some((e) => /manifest/.test(e.errorId)), `the check can fail: ${JSON.stringify(none)}`);
});
