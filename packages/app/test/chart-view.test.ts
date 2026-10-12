// PLAN 5.32_t, the desk's chart in a real browser on a real home (owner, 10-11: "for the charts, more advanced, we want
// to be able to right click and add lets say indicators, or an orbs strategy so we can see it visually. paper or live";
// "time before a bar closes too"), on a stand-in market, DEX and chains:
//   - the time left on the bar forming now, under the last price, counting down on the page's clock;
//   - right-click the chart: its menu where it was pressed; RSI added in a pane of its own, its numbers changed from its
//     legend, still there after a reload (kept in this browser); Escape closes the menu and only it;
//   - Kit's strategy on paper: its lines, its trades in and out where the home's own paper desk makes them on these bars,
//     where Kit runs it on paper from; live: Kit's real trade on this coin and nothing of its paper;
//   - Kit's own trades here, on paper; the chart cleared;
//   - nothing spilling with panes, the legend and the menu open, at desk and phone sizes; on a phone the menu a sheet,
//     from ƒx or a long press.
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
import { drawn } from "../../home/src/desk/chart.ts";
import { publicDex } from "../../home/src/desk/dex.ts";
import type { Strategy } from "../../home/src/desk/strategy.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";
import { standInChains, standInMarket, standInRouters } from "../../home/test/fakes/market.ts";
import { MINT, POOL, standInDexFetch } from "../../home/test/fakes/dex.ts";
import { keptBy, TURNS } from "../src/floor/props.ts";
import { closesAt } from "../src/ui/candles.ts";
import { SYMBOLS } from "../src/desk/kit.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;
before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-chart-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  if (skip) return;
  await browser?.close();
  rmSync(dist, { recursive: true, force: true });
});

const COIN = `solana:${MINT}`;
const LIVE = 0.1777; // the stand-in Jupiter's price now
// the coins by market cap, as the stand-in CoinGecko says: stablecoins among them, ETH over BTC
const RANKED = ["ETH", "BTC", "USDT", "SOL", "XRP", "USDC", "BNB", "DOGE", "TRX", "ADA", "LINK", "ZEC", "HYPE"];
const ema = (a: number, b: number, op: "crosses_above" | "crosses_below") => ({ all: [{ left: { kind: "ema" as const, period: a }, op, right: { kind: "ema" as const, period: b } }] });
const WAVE: Strategy = { name: "Wave cross", symbol: COIN, timeframe: "15m", sizePct: 50, entry: ema(5, 13, "crosses_above"), exit: ema(5, 13, "crosses_below") };

test("the desk's chart: the bar's clock; indicators from its right-click menu, kept; a strategy on paper and live; an orb's trades; at desk and phone sizes", { skip, timeout: 300_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-chart-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const chains = standInChains({
    getBalance: () => ({ value: 2_000_000_000 }),
    getTokenAccountsByOwner: () => ({ value: [] }),
    getTokenSupply: (p) => (p[0] === MINT ? { value: { decimals: 6, amount: "1", uiAmountString: "1" } } : null),
    getAccountInfo: () => ({ value: { data: { parsed: { type: "mint", info: { decimals: 6, mintAuthority: null, freezeAuthority: null } } } } }),
    getSignatureStatuses: () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
  });
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    desk: { on: true, source: standInMarket(() => Date.now(), { ranks: () => RANKED }), routers: standInRouters({ outPer: () => 680 }), fetch: chains, dex: publicDex({ fetch: standInDexFetch({ chart: () => Date.now(), jupiter: () => LIVE }) }) },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("max", "Max", "ceo", { shape: "bean", eyes: "classic", hue: "honey" });
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "mint" });
  for (const [id, name, sp, hue] of [["vic", "Vic", "deskhead", "lime"], ["kit", "Kit", "dealer", "amber"], ["quinn", "Quinn", "quant", "violet"], ["oz", "Oz", "onchain", "teal"], ["rae", "Rae", "risk", "coral"]] as const) {
    h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue });
  }
  for (const turn of TURNS) h.about.keep(keptBy(turn));
  // Kit's strategy, run on paper on this coin; a paper trade of its own here; a real trade it asked for, said yes to,
  // built and sent
  const kept = h.desk.save(WAVE, "kit");
  await h.desk.run(kept.id, "kit");
  await h.desk.paperTrade("kit", COIN, "buy", 100);
  const asked = await h.swaps.ask({ by: "kit", chain: "solana", sell: "SOL", buy: MINT, amount: "0.5", why: "the wave's low" });
  h.swaps.answer(asked.id, true);
  await h.swaps.build(asked.id, "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
  h.swaps.sent(asked.id, "5".repeat(88));
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
  const coin = async (page: Page): Promise<void> => {
    await page.locator("[data-war-screen]").click();
    await page.locator("[data-token-desk]").waitFor();
    if (!(await page.locator(`[data-token-page="${COIN}"]`).count())) await page.locator("[data-token-search]").fill(MINT);
    await page.locator("[data-token-page] [data-candles]").waitFor({ timeout: 20_000 });
  };
  const legend = (page: Page) => page.locator("[data-chart-legend] [data-layer]").evaluateAll((els) => els.map((e) => e.getAttribute("data-layer")));
  const menuOpen = async (page: Page): Promise<void> => {
    await page.locator("[data-chart-menu-open]").click();
    await page.locator("[data-chart-menu] [role=dialog]").waitFor();
  };

  const page = await open({ width: 1280, height: 1000 });
  // the tape: the top 10 by market cap, the largest first (no stablecoin), each
  // pressed opening its chart on the war room's screen; a pointer over the tape holds it still (owner, 10-11: "have top
  // 10 cryptos clickable on the top there where you see the up and down")
  await page.locator("[data-tick]").first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await page.locator("[data-tick]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tick"))), ["ETH", "BTC", "SOL", "XRP", "BNB", "DOGE", "TRX", "ADA", "LINK", "ZEC"]);
  assert.ok(SYMBOLS.includes("HYPE"), "the eleventh by market cap is a major too, and left off");
  // a coin on it pressed (pressed as a button is, not aimed at: the tape moves, and a coin may be under the menu's edge)
  await page.locator('[data-tick="ETH"]').dispatchEvent("click");
  await page.locator('[data-major-page="ETH"] [data-candles]').waitFor({ timeout: 20_000 });
  // the top 10 traded from their pages (owner, 10-11: "add the ability to trade the top 10 too"): ETH swapped from your
  // wallet on Base; XRP, with no market on the chains a wallet here trades on, says so
  await page.locator('[data-major-page="ETH"] [data-token-trade]').waitFor();
  assert.equal(await page.locator('[data-major-page="ETH"] [data-no-route]').count(), 0, "ETH has a market here");
  await page.locator('[data-major-page="ETH"] [data-trade-mode="real"]').click();
  assert.match(await page.locator('[data-major-page="ETH"] [data-token-trade]').innerText(), /Buy ETH[\s\S]*Pay with/, "its swap, from your wallet");
  await page.locator("[data-token-close]").click();
  await page.locator("[data-token-desk]").waitFor({ state: "detached" });
  await page.locator('[data-tick="XRP"]').dispatchEvent("click");
  await page.locator('[data-major-page="XRP"] [data-no-route]').waitFor({ timeout: 20_000 });
  assert.match(await page.locator('[data-major-page="XRP"] [data-no-route]').innerText(), /XRP has no market on the chains your wallet trades on/);
  // on paper, any of them (PLAN 5.38): XRP's real money closed, its paper open, filled at the market's price
  assert.equal(await page.locator('[data-major-page="XRP"] [data-trade-mode="real"]').isDisabled(), true, "no real money where it has no market");
  await page.locator('[data-major-page="XRP"] [data-paper-preset="10"]').click();
  await page.locator('[data-major-page="XRP"] [data-paper-go]').click();
  await page.locator('[data-major-page="XRP"] [data-paper-said]', { hasText: /^Bought .* at the market's price, less the desk's usual fee and slippage\.$/ }).waitFor({ timeout: 20_000 });
  await page.locator("[data-token-close]").click();
  await page.locator("[data-token-desk]").waitFor({ state: "detached" });
  // the screen's list: the majors first, then what trends (owner: "put the majors on top")
  await page.locator("[data-war-screen]").click();
  await page.locator("[data-majors]").waitFor();
  assert.ok(await page.evaluate(() => document.querySelector("[data-majors]")!.getBoundingClientRect().bottom <= document.querySelector("[data-trending]")!.getBoundingClientRect().top), "the majors above what trends, on the screen");
  await page.locator("[data-token-close]").click();
  await page.locator("[data-token-desk]").waitFor({ state: "detached" });
  await coin(page);
  // the time left on the bar forming now (15-minute bars), under the last price, counting down
  const clock = page.locator("[data-bar-clock]");
  const left = await clock.textContent();
  assert.match(left!, /^\d\d:\d\d$/, "under an hour: minutes and seconds");
  const want = await page.evaluate(() => Date.now());
  const secs = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  assert.ok(Math.abs(secs(left!) - (closesAt("15m", want)! - want) / 1000) <= 2, `${left} is the time to the next quarter hour on the page's clock`);
  await page.waitForFunction((was) => document.querySelector("[data-bar-clock]")?.textContent !== was, left, { timeout: 5000 });
  assert.deepEqual(await legend(page), ["ema1", "ema2"], "a first chart: the 20 and 50-bar EMAs it always had");

  // right-click: the menu where it was pressed; RSI added in a pane of its own
  const svg = page.locator("[data-token-page] [data-candles] svg[data-panes]");
  const box = (await svg.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + 80 };
  // the market now (owner, 10-11: "the candlestick freezes at what we started the chart on, price too"): within seconds
  // the forming bar closes at Jupiter's price, and the page's price says it
  await page.locator(`svg[data-panes] [data-last="${LIVE}"]`).waitFor({ timeout: 15_000 });
  await page.locator("[data-token-price]", { hasText: `$${LIVE}` }).waitFor({ timeout: 15_000 });
  // zoom (owner: "be able to zoom in and out of chart"): the wheel where the pointer is, the buttons, a drag back in
  // time and back to the latest bar, a double-click as it was
  const view = async (): Promise<[number, number]> => (await svg.getAttribute("data-view"))!.split(":").map(Number) as [number, number];
  const [fit, start] = await view();
  assert.ok(start < 0, `a little room after the latest bar as it opens (${start}), not clipped at the right (owner, 10-11: "we dont want it to be clipped to the right")`);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -500);
  await page.waitForFunction((f) => Number(document.querySelector("svg[data-panes]")!.getAttribute("data-view")!.split(":")[0]) < f, fit);
  const [closer] = await view();
  await page.locator('[data-zoom="in"]').click();
  assert.ok((await view())[0] < closer, "zoomed in again");
  await page.locator('[data-zoom="out"]').click();
  await page.locator('[data-zoom="out"]').click();
  assert.ok((await view())[0] > closer, "and out");
  assert.equal(await page.locator('[data-zoom="latest"]').count(), 0, "at the latest bar, nothing to go back to");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 240, at.y, { steps: 8 });
  await page.mouse.up();
  assert.ok((await view())[1] > 0, "dragged right: back in time");
  await page.locator('[data-zoom="latest"]').click();
  const [zoomed, back] = await view();
  assert.ok(back < 0 && back >= -Math.ceil(zoomed * 0.1), `back to the latest bar, a little room after it (${back} of ${zoomed})`);
  assert.equal(await page.locator('[data-zoom="latest"]').count(), 0);
  // dragged left: room after the latest bar, half the chart at most
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 2_000, at.y, { steps: 10 });
  await page.mouse.up();
  const [span, room] = await view();
  assert.equal(room, -Math.floor(span / 2), "dragged left as far as it goes: half the chart is room after the latest bar");
  await page.mouse.dblclick(at.x, at.y);
  assert.deepEqual(await view(), [fit, start], "a double-click: as it was");
  // the price scale pressed and dragged (owner, 10-11: "press and hold on the price to the right and be able to size the
  // graph, make it smaller bigger"): down squeezes the bars, up stretches them, a double-click puts it back
  const scale = async (): Promise<number> => Number(await svg.getAttribute("data-yscale"));
  const grip = (await page.locator("[data-token-page] [data-price-scale]").boundingBox())!;
  const drag = async (dy: number): Promise<void> => {
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + dy, { steps: 6 });
    await page.mouse.up();
  };
  await drag(120);
  assert.ok((await scale()) > 1.5, `dragged down: squeezed (${await scale()})`);
  await drag(-300);
  assert.ok((await scale()) < 1, `dragged up: stretched (${await scale()})`);
  await page.mouse.dblclick(grip.x + grip.width / 2, grip.y + grip.height / 2);
  assert.equal(await scale(), 1, "a double-click: as it was");
  await page.mouse.click(at.x, at.y, { button: "right" });
  const dialog = page.locator("[data-chart-menu] [role=dialog]");
  await dialog.waitFor();
  const placed = (await dialog.boundingBox())!;
  assert.ok(Math.abs(placed.x - at.x) <= 2 && Math.abs(placed.y - at.y) <= 2, "where it was pressed");
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(page), [], "the menu open, at desk size");
  await page.locator('[data-add-study="rsi"]').click();
  await dialog.waitFor({ state: "detached" });
  await page.locator('svg[data-panes="1"] [data-pane-of^="rsi"]').waitFor();
  const rsi = (await legend(page)).find((x) => x!.startsWith("rsi"))!;
  assert.match(await page.locator(`[data-layer="${rsi}"]`).innerText(), /^RSI 14/);
  // its numbers changed from its legend
  await page.locator(`[data-layer-edit="${rsi}"]`).click();
  await page.locator(`[data-study-edit="${rsi}"] [data-study-number="0"]`).fill("7");
  await page.locator(`[data-layer="${rsi}"]`, { hasText: "RSI 7" }).waitFor();
  await page.locator("[data-study-done]").click();
  // Escape closes the menu and only it
  await menuOpen(page);
  await page.keyboard.press("Escape");
  await page.locator("[data-chart-menu]").waitFor({ state: "detached" });
  assert.equal(await page.locator("[data-token-desk]").count(), 1, "the screen it is on stays open");
  // kept in this browser: after a reload, the same chart
  await page.reload();
  await page.locator("[data-desk-room]").waitFor({ timeout: 30_000 });
  await coin(page);
  assert.deepEqual(await legend(page), ["ema1", "ema2", rsi]);
  assert.match(await page.locator(`[data-layer="${rsi}"]`).innerText(), /^RSI 7/);

  // Kit's strategy on paper: its two averages, its trades in and out, where Kit runs it on paper from
  await menuOpen(page);
  await page.locator(`[data-draw-strategy="${kept.id}"][data-mode="paper"]`).click();
  const paper = `strategy:${kept.id}:paper`;
  await page.locator(`[data-layer-marks="${paper}"] [data-mark-kind="signal"]`).first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await page.locator(`[data-line^="${paper}:"]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-line"))), [`${paper}:EMA 5`, `${paper}:EMA 13`]);
  assert.equal(await page.locator(`[data-layer-marks="${paper}"] [data-start]`).count(), 1, "where Kit runs it on paper from");
  assert.match(await page.locator(`[data-layer="${paper}"]`).innerText(), /Wave cross · Kit[\s\S]*paper · \d+ trades?/);
  // where the home's own paper desk makes them, on the same bars
  const bars = await h.dex.candles("solana", POOL, MINT, "15m", 300);
  const ins = drawn(WAVE, bars, Date.now()).trades.map((x) => x.entryT);
  const shown = (await page.locator(`[data-layer-marks="${paper}"] [data-mark="buy"]`).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-t")))));
  assert.ok(shown.length >= 2, "more than one way in on the wave");
  assert.deepEqual(shown.filter((x) => x < bars.at(-2)!.t), ins.filter((x) => x >= shown[0]! && x < bars.at(-2)!.t), "each way in where the paper desk took it");
  // live: Kit's real trade on this coin, nothing of its paper
  await menuOpen(page);
  await page.locator(`[data-draw-strategy="${kept.id}"][data-mode="live"]`).click();
  const live = `strategy:${kept.id}:live`;
  await page.locator(`[data-layer="${live}"]`).waitFor();
  assert.equal(await page.locator(`[data-layer="${paper}"]`).count(), 0, "one or the other");
  assert.deepEqual(await page.locator(`[data-layer-marks="${live}"] [data-mark]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-mark-kind"))), ["real"]);
  assert.match(await page.locator(`[data-layer="${live}"]`).innerText(), /live · 1 real trade here/);
  // Kit's own trades here, on paper
  await menuOpen(page);
  assert.match(await page.locator('[data-draw-orb="kit"][data-mode="paper"]').locator("xpath=../..").innerText(), /Kit[\s\S]*1 on paper · 1 real/);
  await page.locator('[data-draw-orb="kit"][data-mode="paper"]').click();
  await page.locator('[data-layer-marks="orb:kit:paper"] [data-mark-kind="paper"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(page), [], "panes, the legend and the trades, at desk size");

  // a phone: the menu a sheet, from ƒx or a long press; a pane under the price; nothing spilling
  const phone = await open({ width: 390, height: 844 });
  await coin(phone);
  await phone.locator("[data-chart-menu-open]").click();
  const sheet = (await phone.locator("[data-chart-menu] [role=dialog]").boundingBox())!;
  assert.deepEqual([Math.round(sheet.x), Math.round(sheet.width), Math.round(sheet.y + sheet.height)], [0, 390, 844], "a sheet from the bottom, the phone's width");
  await phone.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(phone), [], "the menu, at phone size");
  await phone.locator('[data-add-study="macd"]').click();
  await phone.locator('[data-pane-of^="macd"]').waitFor();
  await phone.waitForTimeout(300);
  assert.deepEqual(await measure(phone), [], "two panes and the legend, at phone size");
  const pbox = (await phone.locator("[data-token-page] [data-candles] svg[data-panes]").boundingBox())!;
  await phone.evaluate(({ x, y }) => {
    const el = document.querySelector("[data-token-page] [data-candles] svg[data-panes]")!;
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", isPrimary: true, clientX: x, clientY: y }));
  }, { x: pbox.x + 100, y: pbox.y + 60 });
  await phone.locator("[data-chart-menu] [role=dialog]").waitFor({ timeout: 3000 });
  // the chart cleared
  await phone.locator("[data-chart-clear]").click();
  await phone.locator("[data-chart-legend]").waitFor({ state: "detached" });
  assert.equal(await phone.locator("svg[data-panes]").getAttribute("data-panes"), "0");
});
