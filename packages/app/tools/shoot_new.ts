// Pictures of what the 10-02 batch adds, for the owner: `node tools/shoot_new.ts <dir>`. A real home
// in a scratch folder with the kit running (Ash's day), a calendar served on this machine and a
// stand-in inbox: Notifications opening on "Your day" with a promotion under it (the squeezed notice,
// fixed), Settings' Connections and themes, the calendar with your event, the creator's Business
// specialties (Investor, Crypto), a chat's Attach, the office in four of the new themes, and the
// first open's brains step. measure()'s findings print with each.
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import type { Page } from "playwright-core";
import { launch, measure } from "../test/harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { _setAddressPolicy, blockedAddress } from "../../home/src/agent/net.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { FakeClock } from "../../home/src/clock.ts";
import { fakeImap } from "../../home/test/fakes/imap.ts";

const APP = new URL("..", import.meta.url).pathname;
const dir = process.argv[2]!;
const out = mkdtempSync(join(tmpdir(), "orbs-shoot-new-"));
await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });

// today's calendar, served here (the home is in this process, so loopback is let through for it)
const d0 = new Date();
const ymd = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, "0")}${String(d0.getDate()).padStart(2, "0")}`;
const ics = [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  ["Standup", "090000", "093000", "Office"], ["Dentist", "093500", "100000", "Smile Clinic"], ["Lunch with Sam", "123000", "133000", ""], ["Quarterly review", "130000", "140000", "Room 4"],
].flatMap((e) => (typeof e === "string" ? [e] : ["BEGIN:VEVENT", `UID:${e[0]}`, `DTSTART:${ymd}T${e[1]}`, `DTEND:${ymd}T${e[2]}`, `SUMMARY:${e[0]}`, ...(e[3] ? [`LOCATION:${e[3]}`] : []), "END:VEVENT"]))
  .concat(["END:VCALENDAR", ""]).join("\r\n");
const feed = createServer((_q, r) => void r.writeHead(200, { "content-type": "text/calendar" }).end(ics));
await new Promise<void>((ok) => feed.listen(0, "127.0.0.1", () => ok()));
_setAddressPolicy((ip) => (ip === "127.0.0.1" ? false : blockedAddress(ip)));
const fake = { after: (f: () => unknown) => void cleanups.push(f) } as unknown as Parameters<typeof fakeImap>[0];
const cleanups: (() => unknown)[] = [];
const imap = await fakeImap(fake, { user: "robin@example.com", password: "pw-not-real-5678" });
imap.deliver(`From: Dana Reyes <dana@example.com>\r\nSubject: Lunch Thursday?\r\nDate: ${new Date(Date.now() - 86_400_000).toUTCString()}\r\n\r\nAre you free?\r\n`);

const data = mkdtempSync(join(tmpdir(), "orbs-shoot-new-data-"));
const store = new MemoryStore();
// the home's clock at 08:00 today, so "Your day" has the day still ahead of it
const clock = new FakeClock(new Date(new Date().setHours(8, 0, 0, 0)).getTime());
const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, kit: true, clock, connectors: { store }, brains: { store }, chatgpt: { store: new MemoryStore() } });
h.about.setName("Robin");
h.inbox.addOrb("dana", "Dana", "investor", { shape: "bean", eyes: "classic", hue: "teal" });
h.inbox.addOrb("gus", "Gus", "crypto", { shape: "bean", eyes: "classic", hue: "amber" });
h.start();
await h.calendars.add("work", "Work", `http://127.0.0.1:${(feed.address() as { port: number }).port}/work.ics`);
await h.mail.add("home", { host: "127.0.0.1", port: imap.port, tls: false, user: "robin@example.com", address: "robin@example.com" }, "pw-not-real-5678");
h.notices.remind({ orb: "dana", kind: "bill", title: "Rent", due: `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`, amount: "$1,200" });
// a promotion waiting (the notice that was squeezed on a phone)
h.events.append("promotion.proposed", { from: "Junior", to: "Mid", evidence: { xp: { has: 331 }, tasks: { has: ["dana|trigger:t1|{subject}"] } } }, { orb: "dana" });
const d = await serve(h, { port: 0, appDir: out });
const browser = await launch();

const contexts = new Map<string, Awaited<ReturnType<typeof browser.newContext>>>();
const open = async (vp: { width: number; height: number }, hash: string, theme?: string): Promise<Page> => {
  const key = `${vp.width}`;
  let ctx = contexts.get(key);
  const fresh = !ctx;
  if (!ctx) {
    ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
    contexts.set(key, ctx);
  }
  const page = await ctx.newPage();
  if (fresh) {
    await page.goto(d.pairLink().replace("http://127.0.0.1", "http://localhost").replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  }
  await page.addInitScript((t) => {
    if (t) localStorage.setItem("orbs.theme", t);
    else localStorage.removeItem("orbs.theme");
  }, theme ?? null);
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
  await page.getByRole("region", { name: "Your day" }).waitFor({ timeout: 30_000 });
  await shot(page, `your-day-${size}`);
  await page.close();

  page = await open(vp, "#/settings");
  await page.getByRole("region", { name: "Connections" }).waitFor({ timeout: 20_000 });
  await page.locator("[data-calendar]").first().waitFor({ timeout: 20_000 });
  await shot(page, `settings-connections-${size}`);
  await page.close();

  page = await open(vp, "#/calendar");
  await page.locator('[data-agenda] [data-item="event"]').first().waitFor({ timeout: 20_000 });
  await shot(page, `calendar-events-${size}`);
  await page.close();

  page = await open(vp, "#/new");
  await page.getByRole("tab", { name: "Specialty" }).click();
  await page.getByRole("button", { name: /^Investor/ }).scrollIntoViewIfNeeded();
  await shot(page, `specialty-business-${size}`);
  await page.close();

  page = await open(vp, "#/chat/Dana");
  await page.getByRole("button", { name: /Attach|Give him a file|File/ }).first().waitFor({ timeout: 20_000 }).catch(() => console.log("no attach button seen"));
  await shot(page, `chat-attach-${size}`);
  await page.close();
}

for (const theme of ["midnight", "forest", "sand", "rose", "contrast"]) {
  const page = await open({ width: 390, height: 844 }, "#/office/Dana", theme);
  await shot(page, `theme-${theme}-phone`);
  await page.close();
}

// the first open, on a home that does not know you yet: the brains step
const h2data = mkdtempSync(join(tmpdir(), "orbs-shoot-new-first-"));
const h2 = Home.open({ dataDir: h2data, protect: [], spendCapUsd: null, brains: { store: new MemoryStore() }, chatgpt: { store: new MemoryStore() } });
h2.start();
const d2 = await serve(h2, { port: 0, appDir: out });
for (const [size, vp] of [["desk", { width: 1280, height: 1000 }], ["phone", { width: 390, height: 844 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(d2.pairLink().replace("orbs.html#", "orbs.html?splash=0#"));
  await page.locator("[data-onboarding]").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Skip the story" }).click();
  await page.getByRole("textbox", { name: "Your name" }).fill("Robin");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Skip the story" }).click();
  await page.locator("[data-brains-step]").waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Add a local coder" }).click();
  await shot(page, `first-open-brains-${size}`);
  await ctx.close();
}

await browser.close();
await d.close();
await d2.close();
await h.close();
await h2.close();
for (const f of cleanups) await f();
feed.close();
rmSync(out, { recursive: true, force: true });
rmSync(data, { recursive: true, force: true });
rmSync(h2data, { recursive: true, force: true });
