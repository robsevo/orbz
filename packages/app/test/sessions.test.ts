// PLAN 2.9_t, a session in the app, end to end: a real home with a scripted model serves the built
// app, and Chromium works a session the way the owner described it (10-01: "a brainstorming tab
// with a chat next to it ... same for the floor tab, and you choose which orbs to bring into each
// session and each tab ... we want to see what theire doing").
//   - The side menu's Sessions makes one: a title, and the orbs you choose.
//   - On the Brainstorm, your words go in once; the lead answers, then each other orb adds a line
//     (PLAN 5.10), by name, as it writes; a load that lands late takes nothing away from words
//     still streaming.
//   - A conversation scrolls inside the screen, never the page (owner, 10-07); a session is deleted
//     from its card, after a second press (owner, 10-06).
//   - A decision lands as ✓ Agreed, in the chat and on the stage.
//   - On the Floor, whoever you bring in (or send out) is the home's; each one's computer is a
//     press away and one is big (rooms/Computer.tsx): the command, that it waits for your OK, and
//     what it printed once given.
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
import { PEOPLE_NAMES } from "../src/orb/spec.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";

// one flow, start to end, on a home and a real browser: in the gate, where every suite draws at
// once, it can take more than the minute a test gets by default (a hang still fails, later)
const LONG = { timeout: 150_000 };
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

test("a session: the orbs you bring in, the Brainstorm's turns and what was agreed, the Floor's computers", { skip, ...LONG }, async (t) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const model = await fakeModel(t, [
    // Hazel leads the Brainstorm: held open mid-reply, then she records what was agreed
    { chunks: ["Saturday works, ", "at the park."], hold: held, calls: [{ name: "agree", args: { decision: "Saturday, at the park" } }] },
    { chunks: ["Saturday it is."] },
    { chunks: ["Agreed: Saturday."] }, // Milo chimes in
    { calls: [{ name: "shell", args: { command: "echo invite-made" } }] }, // Hazel, on the Floor
    { chunks: ["The invite is made."] },
  ]);
  const data = mkdtempSync(join(tmpdir(), "orbs-sessions-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { decide: (def) => (def.name === "shell" ? "ask" : "allow"), passWaitMs: 20 }, // a command asks, as it would by default
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
  await page.getByText("Founder Robin").waitFor({ timeout: 30_000 });

  // a new session, from the side menu
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  assert.equal(await page.evaluate(() => location.hash), "#/sessions");
  const making = page.getByRole("region", { name: "A new session" });
  await making.getByRole("button", { name: "Start the session" }).click();
  await making.getByText("A session needs a title").waitFor();
  assert.equal(h.team.list().length, 0, "nothing is made without a title");
  await making.getByRole("textbox", { name: "What the session is for" }).fill("A birthday party");
  const hazelPick = making.locator('[data-crew-pick="hazel"]');
  const [tile, portrait] = await Promise.all([hazelPick.boundingBox(), hazelPick.locator("canvas").boundingBox()]);
  assert.ok(tile && portrait);
  assert.ok(portrait.width >= 64, `Who's in shows Hazel much bigger (${Math.round(portrait.width)} px wide)`);
  assert.ok(tile.width > tile.height * 1.35 && tile.width > portrait.width * 2, `her tile is a wide rectangle (${Math.round(tile.width)} by ${Math.round(tile.height)})`);
  assert.ok(parseFloat(await hazelPick.evaluate((el) => getComputedStyle(el).borderRadius)) <= 12, "the rectangle has restrained corners");
  // every name the dice can give shows whole in such a tile (a twin of Hazel's, beside it, each name in turn): at a fixed
  // 148 px, 33 of them were cut, Humphrey the widest at 64 px (measured 10-10)
  const cut = await hazelPick.evaluate((tile, names) => {
    const twin = tile.cloneNode(true) as HTMLElement;
    const name = twin.querySelector<HTMLElement>("[data-crew-name]")!;
    tile.after(twin);
    const cut = names.filter((n) => ((name.textContent = n), name.scrollWidth > name.clientWidth));
    twin.remove();
    return cut;
  }, PEOPLE_NAMES);
  assert.deepEqual(cut, [], "every name from our list shows whole in its tile");
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
  // a computer for each of them, a press away; one is shown big
  await page.locator('[data-show="milo"]').waitFor();
  assert.equal(await page.locator("[data-show]").count(), 2);
  await page.locator('[data-show="milo"]').click();
  await page.locator('[data-computer="milo"]').waitFor();
  assert.equal(await page.locator("[data-computer]").count(), 1, "one computer big at a time");
  await page.getByRole("button", { name: "Bring someone in" }).click();
  // the crew's own pick (an orb's computer has buttons named for it too: its picture in picture, its full screen)
  await page.locator('header [data-crew-pick="milo"]').click();
  for (let i = 0; i < 40 && h.team.get(1)!.floor.length !== 1; i++) await page.waitForTimeout(50);
  assert.deepEqual(h.team.get(1)!.floor, ["hazel"], "who works a tab is the home's");
  assert.deepEqual(h.team.get(1)!.brainstorm, ["hazel", "milo"], "and only that tab's");
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator('[data-computer="hazel"]').waitFor();
  assert.equal(await page.locator("[data-show]").count(), 0, "with only Hazel on the Floor, hers is the only computer");
  const floor = page.getByRole("textbox", { name: "Say something to the Floor" });
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });
  await floor.fill("Make the invite");
  await floor.press("Enter");
  const computer = page.locator('[data-computer="hazel"]');
  // acting asks first: her computer says so, and the card waits beside it
  await computer.locator("[data-doing]", { hasText: "waiting for your OK" }).waitFor({ timeout: 20_000 });
  await computer.getByRole("tab", { name: "Terminal" }).click();
  await computer.getByText("waiting for your OK…").waitFor();
  await page.locator("[data-card]").getByRole("button", { name: "Approve" }).click();
  await computer.getByText("invite-made", { exact: true }).waitFor({ timeout: 20_000 });
  assert.match(await computer.innerText(), /\$ echo invite-made\s+invite-made/, "the command, and what it printed");
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

test("a conversation scrolls inside the screen, never the page: what you type stays in view, reading back is left alone, Jump to latest; a session is deleted from its card, after a second press", { skip, ...LONG }, async (t) => {
  const model = await fakeModel(t, []);
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
  const s = h.team.create("A long talk", { brainstorm: ["hazel", "milo"], floor: ["hazel"] });
  const other = h.team.create("Keep this one", { brainstorm: ["hazel"] });
  const conv = `team:${s.id}:brainstorm`;
  // a long board on the Floor: taller than a phone's room for it
  const BOARD = ["# The party", "", "Verified by the tests under each row.", "", "### PHASE 1 — the party", "", "| # | Feature | Description | Done |", "|---|---------|-------------|------|",
    ...Array.from({ length: 12 }, (_, i) => [`| 1.${i + 1} | Part ${i + 1} | part ${i + 1} | [ ] |`, `| 1.${i + 1}_t | Tests: part ${i + 1} | it exists | [ ] |`]).flat()].join("\n");
  const board = h.plans.archive({ orb: "hazel", conversation: `team:${s.id}:floor`, card: 0, body: BOARD, shown: BOARD, objections: [] });
  h.plans.mark(board.id, "approved");
  h.board.open(board.id, BOARD);
  // a long conversation already there (owner, 10-07: "or else i have to scroll ALLL THE WAY DOWN ... AND ALL THE WAY UP AGAIN")
  for (let i = 1; i <= 40; i++) h.conversations.add({ conversation: conv, orb: i % 2 ? "hazel" : "milo", role: "assistant", content: `Line ${i}: ${"a thought about the party, ".repeat(i % 5 + 1)}` });
  // a long decision (owner, 10-08: its "✓" stood over its "AGREED")
  h.conversations.add({ conversation: conv, orb: "hazel", role: "notice", content: "✓ Agreed", meta: { agreed: "Run the party's skill gym every night at nine, each free orb choosing and practising a skill the team can use." } });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark", hasTouch: size.width < 1024 });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.getByText("Founder Robin").first().waitFor({ state: "attached", timeout: 30_000 });
    await page.evaluate((id) => (location.hash = `#/session/${id}/brainstorm`), s.id);
    await page.locator('[data-stream="open"]').waitFor({ timeout: 30_000 });
    await page.getByText("Line 40:").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    const log = page.getByRole("log", { name: "The conversation" });
    const box = page.getByRole("textbox", { name: "Say something to the Brainstorm" });
    const at = () => page.evaluate(() => {
      const l = document.querySelector<HTMLElement>('[role="log"]')!;
      return { page: document.scrollingElement!.scrollHeight - window.innerHeight, top: l.scrollTop, rest: l.scrollHeight - l.scrollTop - l.clientHeight, scrolls: l.scrollHeight > l.clientHeight + 1 };
    });
    let a = await at();
    assert.ok(a.page <= 1, `${size.width}: the page does not scroll (${a.page} px past the screen)`);
    assert.ok(a.scrolls, `${size.width}: the conversation scrolls on its own`);
    assert.equal(await log.evaluate((el) => getComputedStyle(el).scrollbarWidth), "thin", "its scroll bar is the app's: thin, quiet (owner, 10-07)");
    assert.ok(a.rest <= 2, `${size.width}: it opens at its latest line`);
    const b = await box.boundingBox();
    assert.ok(b && b.y + b.height <= size.height, `${size.width}: what you type stays on the screen`);
    // reading back: a new reply does not pull you down; Jump to latest says it is there
    await log.evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(200);
    h.conversations.add({ conversation: conv, orb: "milo", role: "assistant", content: `And one more, at ${size.width}.` });
    const jump = page.getByRole("button", { name: "↓ Jump to latest" });
    await jump.waitFor({ timeout: 20_000 });
    a = await at();
    assert.ok(a.top < 50, `${size.width}: you stay where you were reading (${a.top})`);
    await jump.click();
    await page.waitForTimeout(200);
    a = await at();
    assert.ok(a.rest <= 2, `${size.width}: Jump to latest takes you to the end`);
    await page.getByText(`And one more, at ${size.width}.`).waitFor();
    assert.equal(await jump.count(), 0, "and goes once you are there");
    assert.deepEqual(await measure(page), [], `${size.width}: nothing spills`);
    // a decision's mark and its word on one line, however long the decision (owner, 10-08: "Agreed and checkmark
    // should always be on same line")
    const mark = await page.locator("[data-agreed-mark]").first().evaluate((el) => {
      const words = el.firstChild as Text;
      const top = (from: number, to: number): number => {
        const r = document.createRange();
        r.setStart(words, from);
        r.setEnd(words, to);
        return Math.round(r.getBoundingClientRect().top);
      };
      return { mark: top(0, 1), word: top(words.data.length - 1, words.data.length) };
    });
    assert.equal(mark.word, mark.mark, `${size.width}: ✓ and AGREED on one line`);
    // the box you write in (owner, 10-08: "Say something to the brainstorm doesnt fit in the text box"): its words
    // fit its one line, its name stays whole; written in, it grows to its cap, Send kept at its foot
    const words = await box.evaluate((el: HTMLTextAreaElement) => {
      const cs = getComputedStyle(el);
      const probe = Object.assign(document.createElement("span"), { textContent: el.placeholder });
      probe.style.cssText = `position:absolute;white-space:pre;font:${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      document.body.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return { placeholder: el.placeholder, fits: width <= el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
    });
    assert.ok(words.fits, `${size.width}: "${words.placeholder}" fits the box`);
    if (size.width === 1280) assert.equal(words.placeholder, "Say something to the Brainstorm", "a desk has room for all of it");
    // grows by a line or more from empty (its width varies: since 10-10 it runs the composer's whole width), never past
    // its cap
    const empty = await box.evaluate((el) => el.getBoundingClientRect().height);
    await box.fill("A long message, to see the box grow with what is written in it. ".repeat(4));
    const grown = await box.evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(grown >= empty + 20 && grown <= 200, `${size.width}: the box grows with what you write, up to its cap (${empty} to ${grown} px)`);
    const send = await page.getByRole("button", { name: "Send" }).boundingBox();
    assert.ok(send && send.height < 50, `${size.width}: Send keeps its height (${send?.height} px)`);
    await box.fill("");
    if (size.width === 390) {
      // a phone's keyboard shrinks only the part of the page you see, as a pinch does, and the browser pans the page
      // up to the box (owner, 10-08: "The chat in mobile navigates to a empty bottom"): the room keeps the page's
      // height, so there is no nothing under it to pan onto
      const room = page.locator("[data-session]");
      const tall = await room.evaluate((el) => el.getBoundingClientRect().height);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
      await page.waitForFunction(() => (window.visualViewport?.height ?? 900) < 500, undefined, { timeout: 10_000 });
      await page.waitForTimeout(300);
      assert.equal(await room.evaluate((el) => el.getBoundingClientRect().height), tall, "the room keeps its height when only what you see shrinks");
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      await cdp.detach();
    }
    // a private chat the same, his computer beside it scrolling on its own
    for (let i = 1; i <= 40; i++) if (size.width === 390) h.conversations.add({ conversation: "chat:hazel", orb: "hazel", role: "assistant", content: `Chat line ${i}: ${"a plan for Saturday, ".repeat(i % 4 + 1)}` });
    await page.evaluate(() => (location.hash = "#/chat/Hazel"));
    await page.getByText("Chat line 40:").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    a = await at();
    assert.ok(a.page <= 1 && a.scrolls && a.rest <= 2, `${size.width}: a private chat scrolls inside the screen (${JSON.stringify(a)})`);
    const typed = await page.getByRole("textbox", { name: "Message Hazel" }).boundingBox();
    assert.ok(typed && typed.y + typed.height <= size.height, `${size.width}: what you type to Hazel stays on the screen`);
    if (size.width === 390) {
      // a narrow Floor: the work or the chat, each the whole height, a switch between them (10-07)
      await page.evaluate((id) => (location.hash = `#/session/${id}/floor`), s.id);
      await page.locator('[data-show-choice="work"][aria-pressed="true"]').waitFor({ timeout: 20_000 });
      assert.equal(await page.getByRole("log", { name: "The conversation" }).isVisible(), false, "the work first, the chat out of the way");
      // the work scrolls as a whole: nothing in it squeezed to fit (10-07: the computers' row went to a sliver)
      await page.getByText("1.12").first().waitFor({ state: "attached", timeout: 20_000 });
      const pane = await page.evaluate(() => {
        const p = document.querySelector<HTMLElement>(".orbs-pane")!;
        return { scrolls: p.scrollHeight > p.clientHeight + 1, squeezed: [...p.children].filter((c) => (c as HTMLElement).scrollHeight > (c as HTMLElement).clientHeight + 1 && getComputedStyle(c).overflowY !== "visible").length };
      });
      assert.deepEqual(pane, { scrolls: true, squeezed: 0 }, "the work scrolls, and nothing in it is cut");
      await page.locator('[data-show-choice="talk"]').click();
      await page.getByRole("log", { name: "The conversation" }).waitFor({ state: "visible" });
      await page.waitForTimeout(300);
      a = await at();
      assert.ok(a.page <= 1 && a.rest <= 2, `the Floor's chat, shown, at its latest line, the page still (${JSON.stringify(a)})`);
    }
    if (size.width === 1280) {
      await page.evaluate((id) => (location.hash = `#/session/${id}/floor`), s.id);
      await page.getByRole("log", { name: "The conversation" }).waitFor({ state: "visible", timeout: 20_000 });
      assert.equal(await page.locator(".orbs-switch").isVisible(), false, "side by side on a desk: no switch");
      break;
    }
    await ctx.close();
  }
  // deleting: a press asks, the second does it; Keep keeps it
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.getByText("Founder Robin").first().waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/sessions"));
  const card = page.locator(`[data-session-card="${s.id}"]`);
  await card.waitFor({ timeout: 20_000 });
  await card.getByRole("button", { name: "Delete A long talk" }).click();
  await card.getByRole("button", { name: "Keep" }).click();
  assert.equal(h.team.list().length, 2, "Keep keeps it");
  await card.getByRole("button", { name: "Delete A long talk" }).click();
  await card.getByText("Delete this session? Its chats go with it.").waitFor();
  await card.getByRole("button", { name: "Delete it" }).click();
  await card.waitFor({ state: "detached", timeout: 20_000 });
  assert.deepEqual(h.team.list().map((x) => x.id), [other.id], "gone from the home");
  assert.equal(h.conversations.list(`team:${s.id}:brainstorm`).length, 0, "with its chats");
  await page.locator(`[data-session-card="${other.id}"]`).waitFor();
});
