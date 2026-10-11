// Every room, for an eye on how it is laid out (owner, 10-10: "organize it professionally ... just organize the containers
// better", app wide): `node tools/shoot_rooms.ts <dir> [--rooms home,org] [--sizes desk,phone]` saves <room>-<size>.png,
// the whole page. A real home in a scratch folder with a company in it (the Founder, the CEO, the assistant, the CFO, a
// few in their departments), a chat, a session with a plan on its board, schedules, a bill, the board's report (a
// stand-in model), XP and the brains' tokens. measure()'s findings print with each. The desk's rooms (`desk`,
// `desk-<tab>`, PLAN 5.22) come last: its crew hired and its floor opened only for them, on a stand-in market, so the
// rooms before them are the office as everyone has it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launch, measure } from "../test/harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";
import { standInMarket, standInRouters } from "../../home/test/fakes/market.ts";
import { keptBy, TURNS } from "../src/floor/props.ts";
import { publicDex } from "../../home/src/desk/dex.ts";

const APP = new URL("..", import.meta.url).pathname;
const dir = process.argv[2]!;
const arg = (k: string): string | undefined => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const ROOMS: [string, string][] = [
  ["home", "#/home"], ["floor", "#/office"], ["profile", "#/office/Max"], ["new", "#/new"], ["chat", "#/chat/Dana"],
  ["sessions", "#/sessions"], ["session", "#/session/1/brainstorm"], ["board", "#/session/1/floor"], ["notices", "#/notices"],
  ["calendar", "#/calendar"], ["lab", "#/lab"], ["report", "#/report"], ["stats", "#/stats/brain"], ["xp", "#/stats/xp"],
  ["org", "#/org"], ["recruiter", "#/recruiter"], ["cv", "#/recruiter"], ["career", "#/career/Max"], ["settings", "#/settings"],
];
// the desk as it opens, each tab, and the war room's screen: open on what is trending, then a pump.fun coin's page
const DESK_ROOMS: [string, string][] = [["desk", "#/desk"], ...["trade", "books", "strategies", "desk", "limits"].map((tab) => [`desk-${tab}`, "#/desk"] as [string, string]), ["desk-screen", "#/desk"], ["desk-coin", "#/desk"]];
const COIN = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const only = arg("--rooms")?.split(",");
const sizes = (arg("--sizes") ?? "desk,phone").split(",");
const cleanups: (() => unknown)[] = [];
const t = { after: (f: () => unknown) => void cleanups.push(f) } as unknown as Parameters<typeof fakeModel>[0];

const out = mkdtempSync(join(tmpdir(), "orbs-shoot-rooms-"));
await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
const model = await fakeModel(t, []);
const data = mkdtempSync(join(tmpdir(), "orbs-shoot-rooms-data-"));
const h = Home.open({
  dataDir: data, protect: [], spendCapUsd: null, chatgpt: { store: new MemoryStore() }, brains: { store: new MemoryStore() },
  brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  // the war room's screen reads the public DEX data and the chains for real (a coin's page as it is); the majors and
  // the routers stay stand-ins
  desk: { on: true, source: standInMarket(() => Date.now()), routers: standInRouters({ outPer: () => 0.0004 }), dex: publicDex() },
});
h.start();
h.about.setName("Robin");
h.about.setCompany("Acme Orbs");
const crew = [
  ["max", "Max", "ceo", "honey", "bean", "crown"], ["pip", "Pip", "assistant", "azure", "chick", "headset"], ["fin", "Fin", "cfo", "mint", "owl", "none"],
  ["ada", "Ada", "frontend", "coral", "kitty", "bow"], ["bea", "Bea", "frontend", "teal", "cub", "beanie"], ["dana", "Dana", "data", "violet", "squircle", "none"],
  ["cy", "Cy", "writing", "rose", "drop", "beret"],
] as const;
for (const [id, name, sp, hue, shape, hat] of crew) h.inbox.addOrb(id, name, sp, { shape, eyes: "big", hue, hat } as never);
h.boardroom.elect();
h.recruiter.setPosition("travel", true);
h.notices.remind({ orb: "fin", kind: "bill", title: "Hosting", due: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), amount: "$12" });
h.schedules.add({ orb: "dana", name: "Morning digest", cron: "30 7 * * 1,2,3,4,5", instruction: "Summarise the night" });
h.conversations.add({ conversation: "chat:dana", orb: "dana", role: "user", content: "invoices go out on the first, always" });
h.conversations.add({ conversation: "chat:dana", orb: "dana", role: "assistant", content: "Got it: I'll have them ready on the 1st." });
const s = h.team.create("The spring launch", { brainstorm: ["ada", "cy"], floor: ["ada"] });
h.conversations.add({ conversation: `team:${s.id}:brainstorm`, orb: "cy", role: "assistant", content: "A page, a poster and three posts: the page first." });
const spend = (orb: string | null, model: string, input: number, output: number): void =>
  void h.events.append("brain.spend", { tier: "big", model, prompt_tokens: input, cached_tokens: 0, completion_tokens: output, cost_usd: null, cost_source: "none" }, { orb, conversation: orb ? `chat:${orb}` : null });
spend("dana", "gpt-5.1", 8_000, 900);
spend("pip", "gpt-5.1-mini", 2_000, 400);
for (const [orb, n] of [["ada", 40], ["pip", 25], ["dana", 15]] as const) h.events.append("xp.earned", { amount: n, reason: "work", source: 1, at: Date.now() }, { orb });
model.replies.push(
  "Idea: Sell the office's habits to small shops as a service. They already work, so each sale is nearly all profit.\nWho pays: Small shops, about $30 a month each.\nCosts: $0 to start, $0 a month.\nFirst step: List the three habits that work best.",
  "Idea: Offer a weekly brief to founders. It costs us an hour.\nWho pays: Founders, $10 a month.\nCosts: nothing.\nFirst step: Write the first brief.",
);
await h.reports.make().catch((e: Error) => console.log("no report:", e.message));
const d = await serve(h, { port: 0, appDir: out });
const browser = await launch();
/** The desk's crew and its work, and its floor opened: only before its own rooms. */
const desk = async (): Promise<void> => {
  const crew = [
    ["vic", "Vic", "deskhead", "lime", "bean", "bowler"], ["kit", "Kit", "dealer", "amber", "kitty", "headset"], ["quinn", "Quinn", "quant", "violet", "owl", "none"],
    ["oz", "Oz", "onchain", "teal", "drop", "antenna"], ["rae", "Rae", "risk", "coral", "cub", "hard hat"],
  ] as const;
  for (const [id, name, sp, hue, shape, hat] of crew) h.inbox.addOrb(id, name, sp, { shape, eyes: "big", hue, hat } as never);
  const ema = (a: number, b: number, op: string) => ({ all: [{ left: { kind: "ema", period: a }, op, right: { kind: "ema", period: b } }] }) as never;
  const spec = { name: "EMA cross · BTC 1h", symbol: "BTC", timeframe: "1h", entry: ema(9, 21, "crosses_above"), exit: ema(9, 21, "crosses_below"), stopLossPct: 3, takeProfitPct: 6, sizePct: 50 } as never;
  const row = h.desk.save(spec, "quinn", await h.desk.backtest(spec));
  await h.desk.run(row.id, "kit");
  await h.desk.paperTrade("vic", "ETH", "buy", 1_500);
  h.desk.note("oz", "SOL", "Unlocks this month", "About 2% of the supply unlocks on the 28th; the last two unlocks were sold into within a week.");
  for (const t of TURNS) h.about.keep(keptBy(t));
};
const shoot = async (rooms: [string, string][]): Promise<void> => {
for (const size of sizes) {
  const vp = size === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 900 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.addInitScript(() => { (globalThis as { __orbsTime?: number }).__orbsTime = 3.4; });
  await page.goto(d.pairLink().replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  for (const [room, hash] of rooms) {
    if (only && !only.includes(room)) continue;
    await page.evaluate((x) => (location.hash = x), hash);
    await page.waitForTimeout(1800);
    // a tab of the desk's own; the war room's screen, pressed (on a phone, from the floor's own tab)
    if (room === "desk-screen" || room === "desk-coin") {
      if (await page.locator('[data-desk-tab="floor"]').count()) await page.locator('[data-desk-tab="floor"]').click();
      await page.locator("[data-war-screen]").click();
      await page.locator("[data-token-desk]").waitFor({ timeout: 20_000 });
      if (room === "desk-coin") {
        await page.locator("[data-token-search]").fill(COIN);
        await page.locator("[data-token-page] [data-candles]").waitFor({ timeout: 60_000 }).catch(() => undefined);
      } else {
        await page.locator("[data-token-row]").first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(2500);
      console.log(room, size, "findings:", JSON.stringify(await measure(page)).slice(0, 300));
      await page.screenshot({ path: join(dir, `${room}-${size}.png`) });
      await page.locator("[data-token-close]").click();
      continue;
    }
    if (room.startsWith("desk-")) {
      await page.locator(`[data-desk-tab="${room.split("-")[1]}"]`).click();
      await page.waitForTimeout(1500);
    }
    // an applicant's profile (its CV), opened from its card: the screen as it shows, the dialog over the room
    if (room === "cv") {
      await page.locator("[data-profile-open]").first().click();
      await page.locator("[data-profile]").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1200);
      console.log(room, size, "findings:", JSON.stringify(await measure(page)).slice(0, 300));
      await page.screenshot({ path: join(dir, `${room}-${size}.png`) });
      await page.keyboard.press("Escape");
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    const f = await measure(page).catch((e: Error) => [`measure failed: ${e.message}`]);
    console.log(room, size, "findings:", JSON.stringify(f).slice(0, 300));
    await page.screenshot({ path: join(dir, `${room}-${size}.png`), fullPage: true });
  }
  await ctx.close();
}
};
await shoot(ROOMS);
if (!only || only.some((r) => r.startsWith("desk"))) {
  await desk();
  await shoot(DESK_ROOMS);
}
await browser.close();
await d.close();
await h.close();
for (const f of cleanups) await f();
rmSync(out, { recursive: true, force: true });
rmSync(data, { recursive: true, force: true });
