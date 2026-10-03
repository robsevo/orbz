// PLAN 4.2_t in the app (your connections, in Settings), on a real home with a stand-in keychain,
// a calendar served on this machine, the stand-in IMAP server and the stand-in MCP program:
//   - A page given as a calendar is refused and says why; your calendar's address is kept, never
//     shown back; its event is on the calendar's day, read only.
//   - A mail account: a wrong password says why and keeps nothing; the right one is kept.
//   - A connector that runs a program, with a secret it needs: ready with its tools; the secret
//     never reaches the page.
//   - With the kit, Notifications opens on your day in Ash's words, your event in it (PLAN 4.5).
//   - Nothing spills at desk or phone size; each is removed.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { _setAddressPolicy, blockedAddress } from "../../home/src/agent/net.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { FakeClock } from "../../home/src/clock.ts";
import { fakeImap } from "../../home/test/fakes/imap.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const SERVER = fileURLToPath(new URL("../../home/test/fixtures/mcp-server.ts", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;
const TOKEN = "tok-not-real-1234";
const SECRET_PART = "k3y-not-real-9876";
const USER = { user: "robin@example.com", password: "pw-not-real-5678" };

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-connections-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("your connections in Settings: a calendar, a mail account, a connector with a secret; none shown back", { skip, timeout: 150_000 }, async (t) => {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:review@work", `DTSTART:${ymd}T110000`, `DTEND:${ymd}T113000`, "SUMMARY:Quarterly review", "LOCATION:Room 4", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  const feed = createServer((req, res) => {
    if (req.url === `/private/${SECRET_PART}/basic.ics`) return void res.writeHead(200, { "content-type": "text/calendar" }).end(ics);
    res.writeHead(200, { "content-type": "text/html" }).end("<html>a page</html>");
  });
  await new Promise<void>((r) => feed.listen(0, "127.0.0.1", () => r()));
  const prev = _setAddressPolicy((ip) => (ip === "127.0.0.1" ? false : blockedAddress(ip))); // the home is in this process
  t.after(() => {
    _setAddressPolicy(prev);
    return new Promise<void>((r) => feed.close(() => r()));
  });
  const base = `http://127.0.0.1:${(feed.address() as { port: number }).port}`;
  const imap = await fakeImap(t, USER);

  const data = mkdtempSync(join(tmpdir(), "orbs-connections-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const store = new MemoryStore();
  // the kit too: "Your day" is Ash's carried day reading what the home hands it (PLAN 4.5)
  // the home's clock at 08:00 today: Ash's brief reads the rest of the day, so the 11:00 review is still to come
  const clock = new FakeClock(new Date(new Date().setHours(8, 0, 0, 0)).getTime());
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, kit: true, clock, connectors: { store }, brains: { store }, chatgpt: { store: new MemoryStore() } });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.goto(page.url().replace(/#.*$/, "#/settings"));
  const here = page.getByRole("region", { name: "Connections" });
  await here.waitFor({ timeout: 20_000 });
  const alert = here.getByRole("alert");

  // a calendar
  await here.getByLabel("What to call the calendar", { exact: true }).fill("Work");
  await here.getByLabel("The calendar's address", { exact: true }).fill(`${base}/page`);
  await here.getByRole("button", { name: "Add the calendar" }).click();
  await alert.waitFor({ timeout: 20_000 });
  assert.match(await alert.innerText(), /did not give a calendar/);
  assert.deepEqual(h.calendars.list(), [], "refused: nothing kept");
  await here.getByLabel("The calendar's address", { exact: true }).fill(`${base}/private/${SECRET_PART}/basic.ics`);
  await here.getByRole("button", { name: "Add the calendar" }).click();
  await here.locator('[data-calendar="work"]').waitFor({ timeout: 20_000 });
  assert.match(await here.locator('[data-calendar="work"]').innerText(), /Work\s+Read at \d\d:\d\d/);
  assert.equal(await here.getByLabel("The calendar's address", { exact: true }).inputValue(), "", "the form is cleared once it is kept");

  // a mail account
  await here.getByLabel("Your email address", { exact: true }).fill(USER.user);
  await here.getByLabel("Its mail server (IMAP)", { exact: true }).fill("127.0.0.1");
  await here.getByLabel("Its port", { exact: true }).fill(String(imap.port));
  await here.getByLabel("Its password", { exact: true }).fill("wrong");
  await here.getByRole("button", { name: "Add the account" }).click();
  await alert.waitFor({ timeout: 20_000 });
  await assert.doesNotReject(async () => assert.match(await alert.innerText(), /LOGIN/));
  assert.deepEqual(h.mail.accounts(), {}, "a wrong password keeps nothing");
  await here.getByLabel("Its password", { exact: true }).fill(USER.password);
  await here.getByRole("button", { name: "Add the account" }).click();
  await here.locator('[data-mail="robin"]').waitFor({ timeout: 20_000 });
  assert.equal(await store.get("mail:robin:password"), USER.password);

  // a connector that runs a program, with a secret it needs
  await here.getByLabel("How it is reached", { exact: true }).selectOption("command");
  await here.getByLabel("What to call it", { exact: true }).fill("Stand-in");
  await here.getByLabel("The command that runs it", { exact: true }).fill(`"${process.execPath}" "${SERVER}"`);
  await here.getByLabel("A secret it needs, as NAME=value", { exact: true }).fill(`STAND_IN_TOKEN=${TOKEN}`);
  await here.getByRole("button", { name: "Add the connector" }).click();
  await here.locator('[data-connector="stand-in"][data-state="ready"]').waitFor({ timeout: 30_000 });
  assert.match(await here.locator('[data-connector="stand-in"]').innerText(), /Ready · \d+ tools/);
  assert.equal(await store.get("connector:stand-in:stand_in_token"), TOKEN, "the secret in the keychain");
  const shown = await page.content();
  for (const secret of [TOKEN, USER.password, SECRET_PART]) assert.ok(!shown.includes(secret), `never shown back: ${secret.slice(0, 6)}…`);

  assert.deepEqual(await measure(page), [], "nothing spills at desk size");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await measure(page), [], "nor at phone size");

  // the calendar's event on today, read only
  await page.goto(page.url().replace(/#.*$/, "#/calendar"));
  const event = page.locator('[data-agenda] [data-item="event"]');
  await event.waitFor({ timeout: 20_000 });
  assert.match(await event.innerText(), /11:00–11:30 · Quarterly review[\s\S]*Work · Room 4/);
  assert.equal(await event.getByRole("button").count(), 0, "yours: changed in your calendar, not here");
  assert.deepEqual(await measure(page), [], "the calendar with your event: nothing spills");

  // and in Notifications, your day in Ash's words, with your event in it
  await page.goto(page.url().replace(/#.*$/, "#/notices"));
  const yourDay = page.getByRole("region", { name: "Your day" });
  await yourDay.waitFor({ timeout: 30_000 });
  assert.match(await yourDay.innerText(), /Quarterly review at 11 am/);
  assert.deepEqual(await measure(page), [], "your day: nothing spills");

  await page.goto(page.url().replace(/#.*$/, "#/settings"));
  await here.getByRole("button", { name: "Remove the calendar Work" }).click();
  await here.getByRole("button", { name: `Remove the mail account ${USER.user}` }).click();
  await here.getByRole("button", { name: "Remove stand-in" }).click();
  await page.waitForFunction(() => !document.querySelector("[data-calendar], [data-mail], [data-connector]"), null, { timeout: 20_000 });
  assert.equal(await store.get("connector:stand-in:stand_in_token"), null, "its secret gone with it");
});
