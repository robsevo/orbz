// The news on the floor (PLAN 5.43; owner, 10-12: "a news section too that we can click on that could affect crypto
// prices. like the chart, click and news modal comes up"), on a real home with stand-in feeds and a stand-in market:
// the research corner's TV pressed, the stories newest first, could move it, a coin's move since and its chart from a
// story, Escape; nothing spilling at desk and phone sizes.
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
import { standInDexFetch } from "../../home/test/fakes/dex.ts";
import { publicDex } from "../../home/src/desk/dex.ts";
import { SOURCES } from "../../home/src/desk/news.ts";
import { keptBy, TURNS } from "../src/floor/props.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-news-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const rfc = (t: number): string => new Date(t).toUTCString();
const rss = (title: string, link: string, at: number, desc: string): string => `<rss><channel><item><title>${title}</title><link>${link}</link><pubDate>${rfc(at)}</pubDate><description>${desc}</description></item></channel></rss>`;

test("the news: the research corner's TV pressed, the stories, could move it, a coin's chart from a story; desk and phone", { skip, timeout: 300_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-news-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const now = Date.now();
  // one story a feed: three of kinds that have moved prices, one that has not (an art show)
  const feeds: Record<string, string> = {
    [SOURCES[0]!.url]: rss("Bitcoin ETF sees record inflows", "https://coindesk.example/etf", now - 3_600_000, "Funds took in the most since launch."),
    [SOURCES[1]!.url]: rss("Ethereum listing on a new exchange", "https://ct.example/eth", now - 3 * 3_600_000, "Deposits open Monday."),
    [SOURCES[2]!.url]: rss("Solana network outage halts blocks", "https://decrypt.example/sol", now - 20 * 60_000, "Validators restarted the network."),
    [SOURCES[3]!.url]: rss("A new art show opens downtown", "https://theblock.example/art", now - 2 * 3_600_000, "Nothing to do with prices."),
  };
  const chains = standInChains({});
  const fetchAll = ((input: string | URL | Request, init?: RequestInit) => {
    const u = String(input);
    if (u in feeds) return Promise.resolve(new Response(feeds[u]));
    if (SOURCES.some((s) => s.url === u)) return Promise.resolve(new Response("", { status: 503 }));
    return chains(input, init);
  }) as typeof fetch;
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
  h.inbox.addOrb("oz", "Oz", "onchain", { shape: "bean", eyes: "classic", hue: "teal" });
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
    return page;
  };

  const page = await open({ width: 1280, height: 1000 });
  await page.locator("[data-news-screen]").click();
  await page.locator("[data-news-desk]").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-story]").length === 4, null, { timeout: 20_000 });
  assert.deepEqual(await page.locator("[data-story]").evaluateAll((els) => els.map((e) => e.getAttribute("data-story"))), ["https://decrypt.example/sol", "https://coindesk.example/etf", "https://theblock.example/art", "https://ct.example/eth"], "newest first");
  assert.match((await page.locator("[data-news-sources]").textContent()) ?? "", /Not read just now: CryptoSlate, Bitcoin Magazine\./, "a feed that failed is said");
  assert.match((await page.locator('[data-story="https://coindesk.example/etf"] [data-story-coin="BTC"]').textContent()) ?? "", /^BTC[+−]\d+\.\d% since$/, "its move since, from the market");
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(page), [], "the news, at desk size");
  await page.locator('[data-news-filter="moving"]').click();
  assert.deepEqual(await page.locator("[data-story]").evaluateAll((els) => els.map((e) => e.getAttribute("data-moving"))), ["true", "true", "true"], "the art show left out");
  await page.locator('[data-news-filter="coin:SOL"]').click();
  assert.equal(await page.locator("[data-story]").count(), 1);
  // a story's coin: its chart on the war room's screen
  await page.locator('[data-news-filter="all"]').click();
  await page.locator('[data-story="https://coindesk.example/etf"] [data-story-coin="BTC"]').click();
  await page.locator('[data-major-page="BTC"]').waitFor({ timeout: 20_000 });
  assert.equal(await page.locator("[data-news-desk]").count(), 0, "the news closed for the chart");
  await page.locator("[data-token-close]").click();
  // Escape closes it
  await page.locator("[data-news-screen]").click();
  await page.locator("[data-news-desk]").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-news-desk]"), null, { timeout: 5_000 });

  const phone = await open({ width: 390, height: 844 });
  await phone.locator("[data-news-screen]").click();
  await phone.locator("[data-news-desk]").waitFor();
  await phone.waitForFunction(() => document.querySelectorAll("[data-story]").length === 4, null, { timeout: 20_000 });
  await phone.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(phone), [], "the news, at phone size");
  if (process.env.NEWS_SHOTS) {
    await page.locator("[data-news-screen]").click();
    await page.locator("[data-news-desk]").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(process.env.NEWS_SHOTS, "news-desk.png") });
    await phone.screenshot({ path: join(process.env.NEWS_SHOTS, "news-phone.png") });
    await page.keyboard.press("Escape");
    await page.locator("[data-desk-floor]").screenshot({ path: join(process.env.NEWS_SHOTS, "floor-tv.png") });
  }
});
