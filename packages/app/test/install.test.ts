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
