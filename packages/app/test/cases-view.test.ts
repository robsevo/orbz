// The desk's cases on a real home (PLAN 5.42; owner, 10-12: "investigate where we lead them ... like ZachXBT does"), on
// the stand-in chain's bundled launch (home/test/fakes/solana.ts, worked out by hand there):
//   - the Cases tab: coins pasted in (a pump.fun link), the investigator sent, the case open on its question;
//   - a case read as the investigator reads it: its coin's patterns, the money drawn as ZachXBT draws it (funders left of
//     what they funded, the deployer, its first hands, the way out on the right, no pool), each line its amount, the
//     findings with their evidence on the explorer, the write-up and how it could be played;
//   - a wallet pressed and labelled a way out; a thing you noticed kept and forgotten;
//   - a coin's page sending the investigator to it; nothing spilling at desk and phone sizes.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";
import { standInChains, standInMarket, standInRouters } from "../../home/test/fakes/market.ts";
import { MINT, standInDexFetch } from "../../home/test/fakes/dex.ts";
import { bundledLaunch, StandInChain, W } from "../../home/test/fakes/solana.ts";
import { publicDex } from "../../home/src/desk/dex.ts";
import { readHolders, readLaunch, readPatterns, readWallet } from "../../home/src/desk/trace-tools.ts";
import { keptBy, TURNS } from "../src/floor/props.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-cases-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("the desk's cases: coins pasted in and the investigator sent; a case's money drawn, its findings and write-up; a wallet labelled; what you notice kept; at desk and phone sizes", { skip, timeout: 300_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-cases-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const sol = new StandInChain();
  bundledLaunch(sol);
  const evm = standInChains({ getAccountInfo: () => ({ value: { data: { parsed: { type: "mint", info: { decimals: 6, mintAuthority: null, freezeAuthority: null } } } } }) });
  // Solana's RPC is the stand-in chain's; every other chain the desk's own stand-ins
  const fetchAll = ((input: string | URL | Request, init?: RequestInit) => (String(input).includes("api.mainnet-beta.solana.com") ? sol.fetch(input, init) : evm(input, init))) as typeof fetch;
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    desk: { on: true, source: standInMarket(() => Date.now()), routers: standInRouters({ outPer: () => 0.0004 }), fetch: fetchAll, dex: publicDex({ fetch: standInDexFetch() }) },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("max", "Max", "ceo", { shape: "bean", eyes: "classic", hue: "honey" });
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "mint" });
  for (const [id, name, sp, hue] of [["vic", "Vic", "deskhead", "lime"], ["kit", "Kit", "dealer", "amber"], ["oz", "Oz", "onchain", "teal"]] as const) h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue });
  for (const turn of TURNS) h.about.keep(keptBy(turn));
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink().replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate(() => (location.hash = "#/desk"));
    await page.locator("[data-desk-room]").waitFor({ timeout: 30_000 });
    await page.locator('[data-desk-tab="cases"]').click();
    await page.locator("[data-new-case]").waitFor();
    return page;
  };

  const page = await open({ width: 1280, height: 1000 });
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(page), [], "the Cases tab, empty, at desk size");
  // coins pasted in: a pump.fun link names the coin; the investigator (the on-chain job) is the one offered
  await page.locator("[data-case-coins]").fill(`look at https://pump.fun/coin/${W.MINT} please`);
  await page.locator("[data-case-question]").fill("Is this launch bundled?");
  assert.equal((await page.locator("[data-case-go]").textContent())?.trim(), "Send Oz to 1 coin", "the on-chain job first, its head after");
  await page.locator("[data-case-go]").click();
  await page.locator("[data-case]").waitFor();
  assert.equal(h.cases.list().length, 1);
  assert.equal(h.cases.get(1)!.question, "Is this launch bundled?");
  assert.deepEqual([h.events.ofType("desk.sent").at(-1)?.orb, (h.events.ofType("desk.sent").at(-1)?.data as { case?: number }).case], ["oz", 1], "Oz sent, and walks to the war room's screen");

  // the case read as the investigator reads it (its tools' own work, on the stand-in chain), then kept and closed
  const c = h.cases.get(1)!;
  const s = h.sleuth();
  await readLaunch(c, `solana:${W.MINT}`, s);
  await readHolders(c, `solana:${W.MINT}`, s);
  for (const w of [W.DEV!, W.MULE!, W.B1!, W.B2!]) await readWallet(c, w, s, `solana:${W.MINT}`);
  h.cases.save(c);
  await readPatterns(h.cases.get(1)!, h.cases, s, []);
  h.cases.find(1, "oz", "MOM funded the deployer and two first hands within the hour before launch", ["mom-dev", "mom-b1", "mom-b2"], "strong");
  h.cases.close(1, "MOM funded DEV, B1 and B2 in the hour before launch; they took 23% in its first slot.", "Wary: that supply sits with one hand. Watch MOM's next wallets.");
  await page.locator("[data-case-back]").click();
  await page.locator('[data-case-row="1"]').click();
  await page.locator("[data-flow-chart]").waitFor();
  // each wallet's place (an exchange by its side: out where its money came out, in where money went in)
  const cols: Record<string, number> = await page.locator("[data-flow-node]").evaluateAll((els) => Object.fromEntries(els.map((e) => [`${e.getAttribute("data-flow-node")}${e.getAttribute("data-side") ? `:${e.getAttribute("data-side")}` : ""}`, Number((e.querySelector("circle") as SVGCircleElement).getAttribute("cx"))])));
  assert.ok(!(W.CURVE! in cols), "the pool is not drawn");
  assert.ok(cols[W.GRAN!]! < cols[W.MOM!]! && cols[W.MOM!]! < cols[W.DEV!]! && cols[W.DEV!]! < cols[W.B1!]!, "the money left to right as it ran");
  assert.equal(cols[`${W.CEX}:in`], Math.max(...Object.values(cols)), "the exchange the money went into, on the far right");
  assert.ok(cols[`${W.CEX}:out`]! < cols[W.B3!]!, "the same exchange where it paid B3, left of B3");
  const chart = await page.locator("[data-flow-chart]").boundingBox();
  const room = await page.locator("[data-flow]").boundingBox();
  assert.ok(chart!.width <= room!.width + 1, "fitted to its box at desk size");
  assert.ok((await page.locator(`[data-flow-edge="${W.MOM}>${W.DEV}"] text`).first().textContent())?.includes("1.00 SOL"));
  assert.deepEqual(await page.locator("[data-pattern]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pattern"))), ["bundled", "devHeavy", "fresh", "devSold", "soldTogether", "cashOut"]);
  assert.equal(await page.locator('[data-finding="strong"] a').count(), 3, "its evidence, each on the explorer");
  assert.match((await page.locator('[data-finding="strong"] a').first().getAttribute("href")) ?? "", /^https:\/\/solscan\.io\/account\//, "a short test signature reads as an address: the explorer's account page");
  await page.locator("[data-writeup]").waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(page), [], "a case, at desk size");

  // a wallet pressed and labelled a way out
  await page.locator(`[data-flow-node="${W.MOM}"]`).click();
  await page.locator("[data-label-words]").fill("MOM's main wallet");
  await page.locator("[data-label-save]").click();
  await page.waitForFunction((a) => document.querySelector(`[data-flow-node="${a}"]`)?.textContent?.includes("MOM's main wallet"), W.MOM, { timeout: 10_000 });
  assert.equal(h.cases.labels()[0]!.label, "MOM's main wallet");

  // a thing you noticed, kept and forgotten
  await page.locator("[data-case-back]").click();
  await page.locator("[data-noticed-words]").fill("deployers funded within the hour before launch");
  await page.locator("[data-noticed-keep]").click();
  await page.locator("[data-noticed-row]").waitFor();
  assert.equal(h.cases.noticed().length, 1);
  await page.locator("[data-noticed-row] button").click();
  await page.waitForFunction(() => !document.querySelector("[data-noticed-row]"), null, { timeout: 10_000 });

  // a coin's page: the investigator sent to it, its case open on the Cases tab
  await page.locator("[data-war-screen]").click();
  await page.locator("[data-token-search]").fill(MINT);
  await page.locator(`[data-token-page="solana:${MINT}"]`).waitFor({ timeout: 20_000 });
  assert.equal((await page.locator("[data-look-go]").textContent())?.trim().startsWith("Send Oz to look into"), true);
  await page.locator("[data-look-go]").click();
  await page.locator('[data-case="2"]').waitFor({ timeout: 20_000 });
  assert.deepEqual(h.cases.get(2)!.coins.map((k) => k.key), [`solana:${MINT}`]);

  // a phone
  const phone = await open({ width: 390, height: 844 });
  await phone.locator('[data-case-row="1"]').click();
  await phone.locator("[data-flow-chart]").waitFor();
  await phone.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(phone), [], "a case, at phone size: the chart scrolls inside its box");
  const shown = await phone.locator("[data-flow]").evaluate((el) => {
    const dev = el.querySelector('[data-role="deployer"] circle')!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return dev.left >= box.left && dev.right <= box.right && el.scrollWidth > el.clientWidth;
  });
  assert.ok(shown, "wider than the phone, it opens on the deployer");
  if (process.env.CASES_SHOTS) {
    await page.locator("[data-case-back]").click();
    await page.locator('[data-case-row="1"]').click();
    await page.locator("[data-flow-chart]").waitFor();
    await page.screenshot({ path: join(process.env.CASES_SHOTS, "case-desk.png"), fullPage: true });
    await phone.screenshot({ path: join(process.env.CASES_SHOTS, "case-phone.png"), fullPage: true });
  }
});
