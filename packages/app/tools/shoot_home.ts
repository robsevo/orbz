// Pictures of the rooms that live on a home, for the owner: `node tools/shoot_home.ts <dir>`.
// A real home in a scratch folder (stand-in keychains, a clock three days into an orb's work),
// served with the built app: the morning card and a promotion (PLAN 3.5, 3.8), the schedule editor
// (2.4), Settings with the brains, your devices with a phone's QR code and your passkeys (1.11,
// 2.7), the memory chip in a chat (2.4), his mood in the office (2.3), and the passkey sign-in a
// browser that is not signed in sees (2.7). measure()'s findings print with each.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import type { Page } from "playwright-core";
import { launch, measure } from "../test/harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { FakeClock } from "../../home/src/clock.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { approved } from "../../home/test/fixtures/bills.ts";

const APP = new URL("..", import.meta.url).pathname;
const dir = process.argv[2]!;
const out = mkdtempSync(join(tmpdir(), "orbs-shoot-home-"));
await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
const data = mkdtempSync(join(tmpdir(), "orbs-shoot-home-data-"));
const clock = new FakeClock(new Date(2026, 8, 29, 9, 0).getTime());
const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, clock, brains: { store: new MemoryStore() }, chatgpt: { store: new MemoryStore() } });
h.about.setName("Robin");
h.inbox.addOrb("dana", "Dana", "data", { shape: "bean", eyes: "classic", hue: "teal" });
h.inbox.addOrb("gus", "Gus", "devops", { shape: "bean", eyes: "classic", hue: "amber" });
for (let day = 0; day < 3; day++) {
  approved(h.events, "dana", ["Rent", "Gym", "Water", "Phone", "Car"].map((s) => `${s} ${day}`), 100 + day * 10);
  if (day < 2) clock.suspend(86_400_000);
}
const HABIT = "dana|trigger:t1|read_file>remind {subject}";
h.events.append("ladder.answered", { kind: HABIT, tier: "habit", run: 900 }, { orb: "dana" });
h.events.append("brain.spend", { tier: "big", cost_usd: 0.0123, prompt_tokens: 900, completion_tokens: 100 }, { orb: "dana" });
h.learned.add("dana", "Invoices go out on the 1st.");
clock.suspend(86_400_000);
h.events.append("habit.promoted", { kind: HABIT, task: "dana|trigger:t1|{subject}", version: 1, runs: [120, 121, 122] }, { orb: "dana" });
await h.gym.night();
h.schedules.add({ orb: "gus", name: "Morning digest", cron: "30 7 * * 1,2,3,4,5", instruction: "Summarise the night" });
h.conversations.add({ conversation: "chat:dana", orb: "dana", role: "user", content: "invoices go out on the first, always" });
h.conversations.add({ conversation: "chat:dana", orb: "dana", role: "assistant", content: "Got it: I'll have them ready on the 1st." });
h.conversations.add({ conversation: "chat:dana", orb: "dana", role: "notice", content: "Memory updated: Invoices go out on the 1st.", meta: { memory: "Invoices go out on the 1st." } });
h.start();
const d = await serve(h, { port: 0, appDir: out });
const browser = await launch();

// one browser a size, paired once: the devices list holds the two of them, as a person's would
const contexts = new Map<number, Awaited<ReturnType<typeof browser.newContext>>>();
const open = async (vp: { width: number; height: number }, hash: string): Promise<Page> => {
  let ctx = contexts.get(vp.width);
  const fresh = !ctx;
  if (!ctx) {
    ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
    contexts.set(vp.width, ctx);
  }
  const page = await ctx.newPage();
  if (fresh) {
    await page.goto(d.pairLink().replace("http://127.0.0.1", "http://localhost").replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  }
  await page.goto(`http://localhost:${d.port}/app/orbs.html?splash=0&intro=0${hash}`);
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
  return page;
};
const shot = async (page: Page, name: string): Promise<void> => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  console.log(name, "findings:", await measure(page));
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
};

for (const [size, vp] of [["desk", { width: 1280, height: 1000 }], ["phone", { width: 390, height: 844 }]] as const) {
  let page = await open(vp, "#/notices");
  await page.locator("[data-morning]").waitFor({ timeout: 20_000 });
  await shot(page, `morning-${size}`);
  await page.close();

  page = await open(vp, "#/calendar");
  await page.getByRole("button", { name: "New schedule" }).click();
  const editor = page.getByRole("region", { name: "A new schedule" });
  await editor.getByPlaceholder("Inbox sweep").fill("Inbox sweep");
  await editor.getByPlaceholder(/Sort the morning's mail/).fill("Sort the morning's mail, and keep any bill for me.");
  await editor.getByLabel("At", { exact: true }).fill("08:30");
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) await editor.getByRole("button", { name: day, exact: true }).click();
  await editor.locator("[data-preview]").getByText(/^Weekdays at 08:30/).waitFor({ timeout: 20_000 });
  await shot(page, `schedule-editor-${size}`);
  await page.close();

  page = await open(vp, "#/settings");
  await page.getByRole("button", { name: "Add a phone" }).click();
  await page.locator("[data-qr]").waitFor({ timeout: 20_000 });
  await shot(page, `settings-${size}`);
  await page.close();

  page = await open(vp, "#/chat/Dana");
  await page.locator("[data-memory]").waitFor({ timeout: 20_000 });
  await shot(page, `memory-chip-${size}`);
  await page.close();

  const card = h.conversations.addCard({ conversation: "chat:gus", orb: "gus", run: 1, kind: "approval", tool: "shell", callId: `shoot-${size}`, assistantMsg: 0, title: "Gus wants to run `pnpm deploy`", detail: "", notice: "Gus wants to run `pnpm deploy`", meta: {} });
  page = await open(vp, "#/office/Gus");
  await page.locator('[data-mood="waiting"]').waitFor({ timeout: 20_000 }).catch(() => console.log("no mood caption seen"));
  await shot(page, `mood-waiting-${size}`);
  await page.close();
  h.conversations.resolveCard(card.id, "denied");

  page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
  await page.goto(`http://localhost:${d.port}/app/orbs.html`);
  await page.getByText(/not signed in to your home yet/).waitFor({ timeout: 30_000 });
  await shot(page, `passkey-signin-${size}`);
  await page.close();
}
await browser.close();
await d.close();
await h.close();
rmSync(out, { recursive: true, force: true });
rmSync(data, { recursive: true, force: true });
