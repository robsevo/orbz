// PLAN 2.4_t, the app on its home, end to end: a real home (in this process, on a scratch data
// directory) serves the built app, and Chromium opens the pairing link it prints.
//   - The link pairs the browser, and its code leaves the address.
//   - The first open's story asks your name and the home keeps it.
//   - A fresh home's office starts empty: the first orb is the one you make (owner, 10-01).
//   - An orb hired in the creator is the home's, look and all.
//   - One let go is archived there: out of the office, kept.
//   - A reload is still paired, and does not play the story again.
//   - Opened afresh with no address, as the desktop launcher opens it: the office, never New orb
//     (owner, 10-06: "we always default to new orb when opening").
//   - A used link, or a browser never paired, is said plainly, not shown as an empty office.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { findChrome, launch, profile } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve, type HomeDoor } from "../../home/src/api.ts";

// one flow, start to end, on a home and a real browser: in the gate, where every suite draws at
// once, it can take more than the minute a test gets by default (a hang still fails, later)
const LONG = { timeout: 150_000 };
const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;
let dataDir: string;
let home: Home;
let door: HomeDoor;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-link-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  dataDir = mkdtempSync(join(tmpdir(), "orbs-link-home-"));
  home = Home.open({ dataDir, protect: [], spendCapUsd: null });
  home.start();
  door = await serve(home, { port: 0, appDir: dist });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await door?.close();
  await home?.close();
  for (const d of [dist, dataDir]) if (d) rmSync(d, { recursive: true, force: true });
});

// one visit, in three steps (as one test it ran past a test's minute in the gate, where every
// suite draws at once): each step goes on from where the last one left the page
let visit: { ctx: BrowserContext; page: Page } | null = null;
after(async () => {
  await visit?.ctx.close().catch(() => {});
});

test("the pairing link opens the app on the home: your name and your first orb are the home's", { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  visit = { ctx, page };
  await page.goto(door.pairLink());
  await page.locator("[data-onboarding]").waitFor({ timeout: 30_000 });
  assert.doesNotMatch(await page.evaluate(() => location.hash), /pair=/, "the code is spent, and off the address");
  await page.getByRole("button", { name: "Skip the story" }).click();
  await page.getByRole("textbox", { name: "Your name" }).fill("Robin");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Skip the story" }).click();
  // your company's name (owner, 10-07: "the user first picks his own name, the company name, hires the CEO")
  await page.getByRole("textbox", { name: "Your company's name" }).fill("Acme Orbs");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Skip the story" }).click();
  assert.deepEqual(home.inbox.orbs(), [], "a fresh home's office is empty: the first orb is the one you make");
  // the brains, on a real home: what he can think with, none of it required
  const step = page.locator("[data-brains-step]");
  await step.getByRole("button", { name: "Continue with ChatGPT" }).waitFor();
  assert.equal(await step.getByLabel("Your Gemini key", { exact: true }).count(), 1);
  await step.getByRole("button", { name: "Skip for now" }).click();
  for (let n = 0; n < 20 && !(await page.getByRole("button", { name: "Make me" }).isVisible()); n++) await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Make me" }).click();
  await page.getByText("Founder Robin").waitFor();
  assert.equal(home.about.get().name, "Robin", "the home keeps what the office calls you");

  // your first orb, your CEO (owner, 10-07), who then shows you round: skipped, it ends on making your assistant
  await page.getByRole("textbox", { name: "Name" }).fill("Pip");
  await page.getByRole("button", { name: "Create Pip" }).click();
  await page.getByRole("button", { name: "Skip the tour" }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Make my assistant" }).click();
  await page.locator("[data-onboarding]").waitFor({ state: "detached" });
  for (let i = 0; i < 50 && !home.inbox.orbs().length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(home.inbox.orbs().map((o) => [o.name, o.specialty]), [["Pip", "ceo"]], "the home has him, and only him: your CEO");
  assert.equal((home.inbox.orbs()[0]!.look as { shape?: string }).shape, "bean", "and his look, as the story showed him");

});

test("a hire, and a let-go, are the home's: one let go is archived there, out of the office and kept", { skip }, async () => {
  assert.ok(visit, "after the first step");
  const { page } = visit;
  await page.getByRole("button", { name: "New orb" }).first().click();
  await page.getByRole("textbox", { name: "Name" }).fill("Wren");
  await page.getByRole("button", { name: "Create Wren" }).click();
  await page.waitForFunction(() => document.querySelector("h2")?.textContent === "Wren");
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(home.inbox.orbs().map((o) => o.name), ["Pip", "Wren"]);
  await page.getByRole("button", { name: "Let Wren go…" }).click();
  await page.getByRole("group", { name: "Let Wren go?" }).getByRole("button", { name: "Let Wren go", exact: true }).click();
  // the page moves to Pip on its own timer: under the gate's load a fixed wait ended before it ran, and the
  // next step reloaded Wren's address (10-06, reproduced by reloading at once)
  await page.waitForFunction(() => location.hash === "#/office/Pip", undefined, { timeout: 30_000 });
  assert.ok(!home.inbox.orbs().some((o) => o.name === "Wren"), "out of the office");
  assert.ok(home.inbox.orbs({ all: true }).find((o) => o.name === "Wren")?.letGoAt, "archived, kept");

});

test("a reload is still paired, does not play the story again, and keeps the office", { skip }, async () => {
  assert.ok(visit, "after the first steps");
  const { page } = visit;
  await page.reload();
  await page.getByText("Founder Robin").waitFor({ timeout: 30_000 });
  assert.equal(await page.locator("[data-onboarding]").count(), 0);
  // his page once the home has answered (your name shows first, from this browser: counting at once lost the race in the gate)
  await page.getByRole("heading", { name: "Pip" }).waitFor({ timeout: 30_000 });
});

test("opened afresh with no address, as the desktop launcher opens it: the home page, never New orb", { skip, ...LONG }, async () => {
  assert.ok(visit, "after the first steps");
  const { page } = visit;
  await page.goto(`http://127.0.0.1:${door.port}/app/orbs.html`);
  await page.getByText("Founder Robin").waitFor({ timeout: 30_000 });
  await page.locator("[data-home-page]").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole("button", { name: /^Create / }).count(), 0, "not the creator");
  assert.notEqual(await page.evaluate(() => location.hash), "#/new", "and the address never says New orb");
  assert.equal(await page.locator("[data-home-page] [data-tile]").count(), 4, "the home page (owner, 10-07), the day at a glance");
});

test("a used link, or a browser never paired, is said plainly", { skip }, async () => {
  const link = door.pairLink();
  const first = await browser.newContext();
  const spending = await first.newPage();
  await spending.goto(link);
  // spent once it has paired: the code leaves the address (a fixed wait lost the race in the gate)
  await spending.waitForFunction(() => !location.hash.includes("pair="), undefined, { timeout: 30_000 });
  await first.close();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(link);
    await page.getByText(/Can't reach your home: that pairing link is used or lapsed/).waitFor({ timeout: 30_000 });
    await page.goto(`http://127.0.0.1:${door.port}/app/orbs.html`);
    await page.getByText(/Can't reach your home: this browser is not signed in to your home yet/).waitFor({ timeout: 30_000 });
  } finally {
    await ctx.close();
  }
});

test("a private chat with an orb: your words, his reply as it streams, a card that waits for your OK", { skip, ...LONG }, async (t) => {
  const { fakeModel } = await import("../../home/test/fakes/model.ts");
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const model = await fakeModel(t, [
    { chunks: ["Hello ", "**Robin**, ", "what are we doing today?"], hold: held },
    { calls: [{ name: "shell", args: { command: "echo planted-from-chat" } }] },
    { chunks: ["Done: it said hello."] },
  ]);
  const data = mkdtempSync(join(tmpdir(), "orbs-chat-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { decide: (def) => (def.name === "shell" ? "ask" : "allow"), passWaitMs: 20 },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ash", "Ash", "general", { shape: "bean", eyes: "classic", hue: "azure" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.getByText("Founder Robin").waitFor({ timeout: 30_000 });
  await profile(page, "Ash"); // the office opens on its floor; the chat is on Ash's profile
  await page.getByRole("button", { name: "Chat with Ash" }).click();
  assert.equal(await page.evaluate(() => location.hash), "#/chat/Ash");
  const box = page.getByRole("textbox", { name: "Message Ash" });
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });
  await box.fill("hi **there**");
  await box.press("Enter");
  // his words show as he writes them: the model holds the reply open until they have been seen
  await page.locator('[data-role="live"]', { hasText: "what are we doing today?" }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-role="assistant"]').count(), 0, "before the reply is kept");
  release();
  const reply = page.locator('[data-role="assistant"]', { hasText: "what are we doing today?" });
  await reply.waitFor({ timeout: 20_000 });
  // formatted as he wrote it (owner, 10-05: "**5 people**" showed its asterisks): bold, and no marks left
  assert.equal(await reply.locator("strong").innerText(), "Robin");
  assert.equal(await reply.innerText(), "Hello Robin, what are we doing today?");
  assert.equal(await page.locator('[data-role="user"]', { hasText: "hi **there**" }).count(), 1, "your words, yours, as you typed them");
  // a command waits on a card until you answer it
  await box.fill("say hello in the shell");
  await box.press("Enter");
  const card = page.locator("[data-card]");
  await card.waitFor({ timeout: 20_000 });
  assert.match(await card.innerText(), /echo planted-from-chat/);
  await card.getByRole("button", { name: "Approve" }).click();
  await page.locator('[data-role="assistant"]', { hasText: "Done: it said hello." }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator("[data-card]").count(), 0, "answered, the card is gone");
  // and it is a private chat: no other conversation holds it
  assert.ok(h.conversations.list("chat:ash").some((m) => m.content === "hi **there**"));
});
