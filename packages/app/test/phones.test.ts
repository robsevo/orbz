// PLAN 2.17_t, phones first (owner, 10-06: "make it more responsive and mobile friendly app wide"): every
// room on a stocked home at 320 (a small phone), 390 (an iPhone), 768 (a tablet) and 1280 (a desk), a touch
// screen under 1024:
//   - the side menu open on a phone: no line squeezed below its height (10-06, "CEO Rob" cut at the bottom)
//   - the layout rule (harness measure: nothing wider than the window, nothing cut or spilling, no text
//     under 10, no line ending on one word, no item alone on a row);
//   - a finger's targets under 1024: every control at least 44 by 44 (WCAG 2.5.5, Apple's 44 pt); a floor
//     tag counts the hit area drawn round it (its ::after); a month's day at least 24 wide (WCAG 2.5.8) and 44 tall;
//   - a phone's text fields at 16 px or more (an iPhone zooms into a smaller one);
//   - and an iPhone never zooms into one (owner, 10-07: "when pressing on a text box, dont zoom in"): as an iPhone,
//     the page's viewport caps its scale; as an Android phone, it does not (it would lose pinch-to-zoom);
//   - a row too wide for a phone (owner, 10-07: "change the containers and add arrows to every side scroll") sits in
//     a track with an arrow at each end, dimmed where there is no more, a press moving it; a row that fits has none;
//   - an orb's profile (10-10): one Career-like hero holds orb/actions and identity, followed by compact state and
//     gesture controls immediately above its DNA;
//   - its career page on a phone (10-07: "organize it, put scrolls for sections that are too long and center the
//     orb"; 10-10: "with the others needs a scroll in that container"): the orb in the middle, the ladder in two rows
//     of three, the long lists scrolling inside their cards, all of With the others in one bounded scroll;
//   - under 480, the app edge to edge.
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
import { serve, type HomeDoor } from "../../home/src/api.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;
let data: string;
let home: Home;
let door: HomeDoor;
let session = 0;

const PLAN = ["# The launch", "", "Verified by the tests under each row.", "", "### PHASE 1 — the work", "", "| # | Feature | Description | Done |", "|---|---------|-------------|------|",
  "| 1.1 | Landing page | write and build the landing page with the pricing table | [ ] |", "| 1.1_t | Tests: landing | it renders on a phone | [ ] |"].join("\n");

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-phones-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
  // a stocked office: four orbs, a session with a plan, a chat, a bill and a reminder, two open positions
  data = mkdtempSync(join(tmpdir(), "orbs-phones-home-"));
  home = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  home.start();
  home.about.setName("Robin");
  home.inbox.addOrb("ash", "Ash", "assistant", { shape: "bean", eyes: "classic", hue: "azure" });
  home.inbox.addOrb("max", "Max", "ceo", { shape: "egg", eyes: "classic", hue: "honey", hat: "laurel" }); // your CEO (PLAN 5.13): Build stays shut without a CTO
  home.inbox.addOrb("ada", "Ada", "frontend", { shape: "egg", eyes: "classic", hue: "coral" });
  home.inbox.addOrb("milo", "Milo", "research", { shape: "pebble", eyes: "classic", hue: "teal" });
  home.inbox.addOrb("wren", "Wren", "writing", { shape: "drop", eyes: "classic", hue: "rose" });
  const s = home.team.create("The spring launch", { brainstorm: ["ada", "milo"], floor: ["ada"] });
  session = s.id;
  home.conversations.add({ conversation: `team:${s.id}:brainstorm`, orb: "milo", role: "assistant", content: "Let us start with what the customers asked for most last spring." });
  const plan = home.plans.archive({ orb: "ada", conversation: `team:${s.id}:floor`, card: 0, body: PLAN, shown: PLAN, objections: [] });
  home.plans.mark(plan.id, "approved");
  home.board.open(plan.id, PLAN);
  home.conversations.add({ conversation: "chat:ada", orb: "ada", role: "user", content: "Can you build the pricing page?" });
  home.conversations.add({ conversation: "chat:ada", orb: "ada", role: "assistant", content: "Yes. I will start with the three plans and a comparison table, then the FAQ under it." });
  const day = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  home.notices.remind({ orb: "ash", kind: "bill", title: "Rent", due: day(2), amount: "$1,200" });
  home.notices.remind({ orb: "ash", kind: "reminder", title: "Call the dentist about the appointment", due: `${day(0)}T15:00` });
  home.recruiter.setPosition("backend", true);
  home.recruiter.setPosition("planning", true);
  door = await serve(home, { port: 0, appDir: dist });
});
after(async () => {
  await browser?.close();
  await door?.close();
  await home?.close();
  for (const d of [dist, data]) if (d) rmSync(d, { recursive: true, force: true });
});

const rooms = (): string[] => [
  "#/office", "#/office/Ada", "#/new", "#/chat/Ada", "#/sessions", `#/session/${session}/brainstorm`, `#/session/${session}/floor`,
  "#/notices", "#/calendar", "#/lab", "#/org", "#/career/Ada", "#/recruiter", "#/recruiter/build", "#/settings",
];

/** What a finger cannot press, and a phone's text fields under 16 px. */
function fingers(page: Page, phone: boolean): Promise<string[]> {
  return page.evaluate((phone) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role=button]")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden" || (el.tagName === "A" && cs.display === "inline")) continue;
      // a hit area round it (the floor's tags: an absolute ::after reaching past its edges) counts, as drawn
      const after = getComputedStyle(el, "::after");
      const reach = after.content !== "none" && after.content !== "normal" && after.position === "absolute" ? Math.max(0, -parseFloat(after.top) || 0) : 0;
      const slop = 2 * reach;
      const minW = el.classList.contains("orbs-calday") ? 24 : 44;
      const what = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`;
      if (r.height + slop < 44 || r.width + slop < minW) out.push(`${what} is ${Math.round(r.width)} by ${Math.round(r.height)}`);
      if (phone && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && parseFloat(cs.fontSize) < 16) out.push(`${what} has ${cs.fontSize} text`);
    }
    return [...new Set(out)];
  }, phone);
}

for (const width of [320, 390, 768, 1280]) {
  test(`every room at ${width} px: the layout rule${width < 1024 ? ", a finger's targets" : ""}${width <= 760 ? ", 16 px text fields" : ""}`, { skip, timeout: 240_000 }, async () => {
    const touch = width < 1024;
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 800 : 900 }, colorScheme: "dark", hasTouch: touch, isMobile: touch });
    try {
      const page = await ctx.newPage();
      await page.goto(door.pairLink().replace("orbs.html", "orbs.html?splash=0"));
      await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
      const problems: string[] = [];
      for (const room of rooms()) {
        await page.evaluate((x) => (location.hash = x), room);
        await page.waitForTimeout(1200);
        for (const f of await measure(page)) problems.push(`${room}: ${f.kind}: ${f.what}`);
        if (touch) for (const f of await fingers(page, width <= 760)) problems.push(`${room}: ${f}`);
        // a chat's header wraps its button to a line of its own before it squeezes who you are talking to (PLAN 2.17)
        if (room.startsWith("#/chat/")) {
          const who = await page.locator("[data-chat-who]").first().boundingBox({ timeout: 10_000 });
          if (!who || who.width < 149) problems.push(`${room}: the chat's header squeezed its name to ${who ? Math.round(who.width) : 0} px`);
        }
      }
      if (width <= 760) {
        // the side menu, open (owner, 10-06: "under orbz, it says CEO Rob but the bottom is cut off"): every
        // line whole, none squeezed below its own height, and the menu itself measured like a room
        await page.setViewportSize({ width, height: 560 }); // a short phone, its browser's bars showing: the menu is taller than the screen
        await page.getByRole("button", { name: "Menu" }).click();
        await page.waitForTimeout(700);
        const cut = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>(".orbs-side *")]
            .filter((el) => el.childElementCount === 0 && (el.textContent ?? "").trim() && el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible")
            .map((el) => `"${(el.textContent ?? "").trim().slice(0, 30)}" shows ${el.clientHeight} of ${el.scrollHeight} px`),
        );
        for (const c of cut) problems.push(`the menu: cut: ${c}`);
        for (const f of await measure(page)) problems.push(`the menu: ${f.kind}: ${f.what}`);
        await page.keyboard.press("Escape");
        await page.locator(".orbs-scrim").click({ force: true }).catch(() => {});
        await page.setViewportSize({ width, height: 800 });
      }
      if (width < 480) {
        const box = await page.locator(".orbs-window").boundingBox();
        assert.deepEqual([Math.round(box!.x), Math.round(box!.width)], [0, width], "a small phone: the app edge to edge");
      }
      assert.deepEqual(problems, [], `at ${width} px`);
    } finally {
      await ctx.close();
    }
  });
}

test("an iPhone never zooms into a text box: as an iPhone the page caps its scale; as an Android phone it does not", { skip, timeout: 120_000 }, async () => {
  const viewport = async (userAgent: string): Promise<string> => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent });
    try {
      const page = await ctx.newPage();
      await page.goto(door.pairLink().replace("orbs.html", "orbs.html?splash=0"));
      await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
      return await page.locator('meta[name="viewport"]').getAttribute("content") ?? "";
    } finally {
      await ctx.close();
    }
  };
  assert.match(await viewport("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"), /maximum-scale=1/);
  assert.doesNotMatch(await viewport("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"), /maximum-scale/, "control: Android keeps pinch-to-zoom");
});

test("an orb's desk profile has a Career-like hero, then compact controls and DNA beside the details", { skip, timeout: 120_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  try {
    const page = await ctx.newPage();
    await page.goto(door.pairLink().replace("orbs.html", "orbs.html?splash=0"));
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate(() => (location.hash = "#/office/Ada"));
    await page.locator("[data-moves]").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    const boxes = await Promise.all(["[data-profile-hero]", "[data-profile-portrait]", "[data-sheet-head]", "[data-moves]", "[data-strand-card]"].map((sel) => page.locator(sel).boundingBox()));
    assert.ok(boxes.every(Boolean));
    const hero = boxes[0]!, portrait = boxes[1]!, head = boxes[2]!, controls = boxes[3]!, dna = boxes[4]!;
    assert.ok(portrait.x + portrait.width <= head.x + 1, "as on Career, the orb sits beside its identity on a desk");
    assert.ok(hero.x <= portrait.x && hero.x <= head.x && portrait.x + portrait.width <= hero.x + hero.width + 1 && head.x + head.width <= hero.x + hero.width + 1, "the orb and its identity share the hero container");
    assert.ok(hero.y + hero.height <= controls.y + 1, "the Career-like hero comes before the controls");
    assert.ok(controls.y + controls.height <= dna.y + 1, "the controls sit directly above DNA");
    assert.ok(controls.height < 140, `the controls' card is compact (${Math.round(controls.height)} px)`);
    const orbCanvas = (await page.locator("[data-profile-portrait] canvas").boundingBox())!;
    const actions = (await page.locator("[data-profile-actions]").boundingBox())!;
    assert.ok(actions.y >= orbCanvas.y + orbCanvas.height - 1, "Chat and Career are directly under the orb");
    assert.deepEqual(await measure(page), [], "the rearranged profile keeps the layout rule");
  } finally {
    await ctx.close();
  }
});

test("a phone's scrolling rows; an orb's compact controls above its DNA and Chat/Career under it; the career page organized", { skip, timeout: 120_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, isMobile: true });
  try {
    const page = await ctx.newPage();
    await page.goto(door.pairLink().replace("orbs.html", "orbs.html?splash=0"));
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    // the floor's rooms, a chip each (its gestures were the example till 10-07, when they left their track)
    await page.evaluate(() => (location.hash = "#/office"));
    const moves = page.locator(".side-scroll", { has: page.locator("[data-view-choice]") });
    await moves.waitFor({ timeout: 20_000 });
    // at its start, and settled there: in a busy gate the row's own scroll to the chosen room can land after ours, and the
    // arrows follow a scroll a frame or more later (10-07: red in a full gate, green alone), so it is set again until the
    // left arrow says it is at the start
    await page.waitForFunction(() => {
      const track = [...document.querySelectorAll(".side-scroll")].find((t) => t.querySelector("[data-view-choice]"));
      const row = track?.querySelector(".one-line");
      if (!track || !row) return false;
      row.scrollLeft = 0;
      return track.querySelector<HTMLButtonElement>('.side-arrow[data-side="left"]')?.disabled === true;
    }, undefined, { timeout: 15_000 });
    assert.equal(await moves.getAttribute("data-over"), "true", "the rooms are wider than a phone: in a track");
    const left = moves.getByRole("button", { name: "Scroll left" });
    const right = moves.getByRole("button", { name: "Scroll right" });
    assert.deepEqual([await left.isDisabled(), await right.isDisabled()], [true, false], "at its start: more only to the right");
    const at = () => moves.locator(".one-line").evaluate((el) => el.scrollLeft);
    await right.click();
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll(".side-scroll")].find((t) => t.querySelector("[data-view-choice]"))!.querySelector(".one-line")!;
      return row.scrollLeft > 40;
    }, undefined, { timeout: 5_000 });
    assert.equal(await left.isDisabled(), false, "moved on: more to the left now");
    for (let i = 0; i < 12 && !(await right.isDisabled()); i++) {
      await right.click();
      await page.waitForTimeout(500);
    }
    assert.equal(await right.isDisabled(), true, `at its end: no more to the right (at ${await at()})`);
    // control: an orb's moods fit a phone, so they are a plain row
    await page.evaluate(() => (location.hash = "#/office/Ada"));
    const moods = page.locator(".side-scroll", { has: page.getByRole("button", { name: "Listening" }) });
    await moods.waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    assert.equal(await moods.getAttribute("data-over"), null);
    assert.equal(await moods.locator(".side-arrow").count(), 0, "no arrows on a row that fits");
    // its moods a little more square, its gestures small and quieter under them, two rows, no track (owner, 10-07: "make
    // the awake listening etc a little more square ... take out the wheel under it, put those as smaller containers
    // under awake lisening etc with a dimmer font color")
    const look = (l: ReturnType<typeof page.locator>) => l.evaluate((el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return { radius: parseFloat(cs.borderTopLeftRadius), colour: cs.color, size: parseFloat(cs.fontSize), top: Math.round(r.top), bottom: r.bottom, h: r.height };
    });
    const mood = await look(page.locator("[data-mood-pick]").nth(1));
    assert.ok(mood.radius <= 8 && mood.h <= 32, `the moods are compact, squarer boxes (${JSON.stringify(mood)})`);
    const gestures = page.locator("[data-gesture-pick]");
    assert.equal(await gestures.count(), 9);
    assert.equal(await page.locator(".side-scroll [data-gesture-pick]").count(), 0, "not in a track");
    const g = await Promise.all([...Array(9).keys()].map((i) => look(gestures.nth(i))));
    const quiet = await page.evaluate(() => { const p = document.createElement("span"); p.style.color = "var(--text-3)"; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    assert.ok(g.every((x) => x.h <= 32 && x.size < mood.size && x.radius <= 10), `smaller boxes (${JSON.stringify(g[0])})`);
    assert.ok(g.every((x) => x.colour === quiet) && quiet !== mood.colour, "a dimmer word than the moods'");
    assert.ok(g[0]!.top > mood.bottom - 1, "under the moods");
    assert.deepEqual([new Set(g.slice(0, 5).map((x) => x.top)).size, new Set(g.slice(5).map((x) => x.top)).size, g[5]!.top > g[0]!.top], [1, 1, true], "two rows, five then four");
    // Chat and Career directly under the orb. Its name and description, compact controls, then DNA follow in that order.
    const cradle = page.locator("[data-cradle]");
    const portrait = (await cradle.locator("canvas").first().boundingBox())!;
    const actions = page.locator("[data-profile-actions]");
    const actionBox = (await actions.boundingBox())!;
    assert.ok(actionBox.y >= portrait.y + portrait.height - 1, "Chat and Career under the orb");
    for (const [sel, words, label] of [["[data-chat-with]", "Chat", "Chat with Ada"], ["[data-career-open]", "Career", "Ada's career"]] as const) {
      const b = actions.locator(sel);
      assert.deepEqual([await b.innerText(), await b.getAttribute("aria-label")], [words, label]);
    }
    assert.equal(await page.locator("[data-sheet-head] [data-chat-with], [data-sheet-head] [data-career-open]").count(), 0, "the buttons left the name line");
    const [heroBox, headBox, controlsBox, dnaBox] = await Promise.all(["[data-profile-hero]", "[data-sheet-head]", "[data-moves]", "[data-strand-card]"].map((sel) => page.locator(sel).boundingBox()));
    assert.ok(heroBox && headBox && controlsBox && dnaBox);
    assert.ok(headBox.x >= heroBox.x && headBox.x + headBox.width <= heroBox.x + heroBox.width + 1, "the name and description share the orb's hero container");
    assert.ok(heroBox.y + heroBox.height <= controlsBox.y + 1, "the whole Career-like hero is above the controls");
    assert.ok(controlsBox.y + controlsBox.height <= dnaBox.y + 1, "the compact controls are immediately above DNA");
    // its career page: the orb in the middle, the ladder two rows of three, the long lists scrolling in their cards
    await page.evaluate(() => (location.hash = "#/career/Ada"));
    const head = page.locator("[data-career-head]");
    await head.waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    const [orb, card] = [(await page.locator("[data-career-portrait]").boundingBox())!, (await head.boundingBox())!];
    assert.ok(Math.abs(orb.x + orb.width / 2 - (card.x + card.width / 2)) <= 3, `the orb in the middle (${Math.round(orb.x + orb.width / 2)} of ${Math.round(card.x + card.width / 2)})`);
    const rungs = await page.locator("[data-rung]").evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().top)));
    assert.deepEqual([new Set(rungs.slice(0, 3)).size, new Set(rungs.slice(3)).size, rungs[3]! > rungs[0]!], [1, 1, true], "the ladder: two rows of three");
    assert.ok(await page.locator('[data-career="ada"] .orbs-tall').count() >= 1, "a long list scrolls inside its card");
    const social = page.getByLabel("With the others, every friend, meeting and lesson");
    const socialBox = await social.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { max: parseFloat(cs.maxHeight), overflow: cs.overflowY };
    });
    assert.ok(socialBox.max <= 0.49 * 844, `With the others is bounded to part of the screen (${socialBox.max} px)`);
    assert.equal(socialBox.overflow, "auto", "With the others has one vertical scroll");
  } finally {
    await ctx.close();
  }
});
