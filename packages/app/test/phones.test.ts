// PLAN 2.17_t, phones first (owner, 10-06: "make it more responsive and mobile friendly app wide"): every
// room on a stocked home at 320 (a small phone), 390 (an iPhone), 768 (a tablet) and 1280 (a desk), a touch
// screen under 1024:
//   - the side menu open on a phone: no line squeezed below its height (10-06, "CEO Rob" cut at the bottom)
//   - the layout rule (harness measure: nothing wider than the window, nothing cut or spilling, no text
//     under 10, no line ending on one word, no item alone on a row);
//   - a finger's targets under 1024: every control at least 44 by 44 (WCAG 2.5.5, Apple's 44 pt); a floor
//     tag counts the hit area drawn round it (its ::after); a month's day at least 24 wide (WCAG 2.5.8) and 44 tall;
//   - a phone's text fields at 16 px or more (an iPhone zooms into a smaller one);
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
