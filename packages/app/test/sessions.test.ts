// PLAN 2.9_t, a session in the app, end to end: a real home with a scripted model serves the built
// app, and Chromium works a session the way the owner described it (10-01: "a brainstorming tab
// with a chat next to it ... same for the floor tab, and you choose which orbs to bring into each
// session and each tab ... we want to see what theire doing").
//   - The side menu's Sessions makes one: a title, and the orbs you choose.
//   - On the Brainstorm, your words go in once and each orb answers in turn, by name, as he writes;
//     a load that lands late takes nothing away from words still streaming.
//   - A decision lands as ✓ Agreed, in the chat and on the stage.
//   - On the Floor, whoever you bring in (or send out) is the home's; each one's computer shows the
//     tool he used, on what, that it waits for your OK, and what came back once given.
//   - Each tab is an address: Back goes from the Floor to the Brainstorm.
//   - At phone size nothing spills and nothing scrolls sideways.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-sessions-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("a session: the orbs you bring in, the Brainstorm's turns and what was agreed, the Floor's computers", { skip }, async (t) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const model = await fakeModel(t, [
    { chunks: ["Saturday works, ", "at the park."], hold: held }, // Hazel, on the Brainstorm: held open mid-reply
    { calls: [{ name: "agree", args: { decision: "Saturday, at the park" } }] }, // Milo agrees
    { chunks: ["Agreed: Saturday."] },
    { calls: [{ name: "shell", args: { command: "echo invite-made" } }] }, // Hazel, on the Floor
    { chunks: ["The invite is made."] },
  ]);
  const data = mkdtempSync(join(tmpdir(), "orbs-sessions-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { decide: () => "allow", passWaitMs: 20 },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "planning", { shape: "bean", eyes: "classic", hue: "amber" });
  h.inbox.addOrb("milo", "Milo", "research", { shape: "bean", eyes: "classic", hue: "teal" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.getByText("CEO Robin").waitFor({ timeout: 30_000 });

  // a new session, from the side menu
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  assert.equal(await page.evaluate(() => location.hash), "#/sessions");
  const making = page.getByRole("region", { name: "A new session" });
  await making.getByRole("button", { name: "Start the session" }).click();
  await making.getByText("A session needs a title").waitFor();
  assert.equal(h.team.list().length, 0, "nothing is made without a title");
  await making.getByRole("textbox", { name: "What the session is for" }).fill("A birthday party");
  assert.equal(await making.getByRole("button", { name: "Hazel" }).getAttribute("aria-pressed"), "true", "the office's first is in to start with");
  await making.getByRole("button", { name: "Milo" }).click();
  await making.getByRole("button", { name: "Start the session" }).click();
  await page.waitForFunction(() => location.hash === "#/session/1/brainstorm");
  assert.deepEqual(h.team.get(1), { ...h.team.get(1)!, title: "A birthday party", brainstorm: ["hazel", "milo"], floor: ["hazel", "milo"] });
  await page.locator('[data-member="milo"]').waitFor(); // the address changes before the page is drawn
  assert.equal(await page.locator("[data-member]").count(), 2);

  // the Brainstorm: your words once, each orb in turn, by name, as he writes
  const brainstorm = page.getByRole("textbox", { name: "Say something to the Brainstorm" });
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 }); // from here on, nothing it says is missed
  // the page's loads are held back until her words are on screen: a load landing late (a loaded
  // machine) must not take her words away (it did: any new message cleared every orb's)
  const heldLoads: (() => void)[] = [];
  let holding = true;
  const loads = /\/conversations\/[^/]+\/messages/;
  await page.route(loads, async (route) => {
    if (holding) await new Promise<void>((r) => heldLoads.push(r));
    await route.continue();
  });
  await brainstorm.fill("Plan a party for June");
  await brainstorm.press("Enter");
  // her words show as she writes them: the model holds her reply open until they have been seen
  const writing = page.locator('[data-role="live"][data-from="hazel"]', { hasText: "at the park." });
  await writing.waitFor({ timeout: 20_000 });
  holding = false;
  for (const go of heldLoads.splice(0)) go();
  await page.locator('[data-role="user"]', { hasText: "Plan a party for June" }).waitFor({ timeout: 20_000 });
  assert.equal(await writing.count(), 1, "your words, loaded late, take nothing away from hers");
  await page.unroute(loads);
  assert.equal(await page.locator('[data-role="assistant"][data-from="hazel"]').count(), 0, "before her reply is kept");
  release();
  await page.locator('[data-role="assistant"][data-from="hazel"]', { hasText: "at the park." }).waitFor({ timeout: 20_000 });
  await page.locator("[data-agreed]", { hasText: "Saturday, at the park" }).waitFor({ timeout: 20_000 });
  await page.getByRole("region", { name: "Agreed so far" }).getByText("✓ Saturday, at the park").waitFor();
  await page.locator('[data-role="assistant"][data-from="milo"]', { hasText: "Agreed: Saturday." }).waitFor({ timeout: 20_000 });
  const log = page.getByRole("log", { name: "The conversation" });
  assert.ok((await log.innerText()).includes("Hazel"), "with more than one orb, each is named");
  assert.equal(await page.locator('[data-role="user"]').count(), 1, "your words, once");

  // the Floor: send Milo out, and Hazel's computer shows what she does
  await page.getByRole("tab", { name: "Floor" }).click();
  await page.waitForFunction(() => location.hash === "#/session/1/floor");
  await page.locator('[data-computer="milo"]').waitFor();
  assert.equal(await page.locator("[data-computer]").count(), 2);
  await page.getByRole("button", { name: "Bring someone in" }).click();
  await page.locator("header").getByRole("button", { name: "Milo" }).click();
  for (let i = 0; i < 40 && h.team.get(1)!.floor.length !== 1; i++) await page.waitForTimeout(50);
  assert.deepEqual(h.team.get(1)!.floor, ["hazel"], "who works a tab is the home's");
  assert.deepEqual(h.team.get(1)!.brainstorm, ["hazel", "milo"], "and only that tab's");
  await page.getByRole("button", { name: "Done" }).click();
  assert.equal(await page.locator("[data-computer]").count(), 1);
  const floor = page.getByRole("textbox", { name: "Say something to the Floor" });
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });
  await floor.fill("Make the invite");
  await floor.press("Enter");
  const computer = page.locator('[data-computer="hazel"]');
  // acting asks first: his computer says so, and the card waits beside it
  await computer.getByText("waiting for your OK…").waitFor({ timeout: 20_000 });
  await page.locator("[data-card]").getByRole("button", { name: "Approve" }).click();
  await computer.locator('[data-act="shell"] [data-result]', { hasText: "invite-made" }).waitFor({ timeout: 20_000 });
  assert.match(await computer.innerText(), /▸ shell echo invite-made\s+invite-made/, "the tool, on what, and what came back");
  await page.locator('[data-role="assistant"][data-from="hazel"]', { hasText: "The invite is made." }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-role="user"]', { hasText: "Plan a party" }).count(), 0, "the Floor's chat is its own");
  assert.ok(!h.conversations.list("team:1:floor").some((m) => m.content.includes("Plan a party")));

  // each tab is an address
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#/session/1/brainstorm");
  await page.locator('[data-role="assistant"][data-from="hazel"]', { hasText: "at the park." }).waitFor({ timeout: 10_000 });

  // a phone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.deepEqual(await measure(page), [], "nothing spills at phone size");
  await page.getByRole("tab", { name: "Floor" }).click();
  await page.waitForFunction(() => location.hash === "#/session/1/floor");
  assert.deepEqual(await measure(page), [], "nor on the Floor");
});
