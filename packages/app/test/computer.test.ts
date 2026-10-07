// PLAN 2.8_t, his computer (rooms/Computer.tsx), in a private chat on a real home with a scripted
// model: he writes a dataset, a document, a dashboard's numbers, a page and a calendar.
//   - While he works, his computer shows the file he is making, as what it is, and he is the
//     cursor, on the part he changed last.
//   - Each kind is drawn as itself: the dataset's table, the document, the bars, the page in its
//     sandbox, the calendar's events. Its numbers are the file's: the rows, the columns, the bars.
//   - The cursor is only ever on what his last step acted on: elsewhere it is out of sight.
//   - Finishing is a chime (and his hop).
//   - Nothing spills at phone or desk size.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Locator, Page } from "playwright-core";
import { findChrome, launch, measure, profile } from "./harness.ts";
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
  dist = mkdtempSync(join(tmpdir(), "orbs-computer-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const CSV = "month,total\nJan,12\nFeb,30\nMar,21\n";
const ICS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261009T100000", "SUMMARY:Q1 review", "END:VEVENT", "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261003", "SUMMARY:Rent due", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
/** With ORBS_SHOTS=<dir>, a picture of each stage for the owner. */
const shot = async (page: Page, name: string): Promise<void> => {
  if (process.env.ORBS_SHOTS) await page.screenshot({ path: join(process.env.ORBS_SHOTS, `computer-${name}.png`) });
};
const write = (path: string, content: string) => ({ calls: [{ name: "write_file", args: { path, content } }] });

/** Whether his cursor's middle is inside `el`, once it has finished gliding there (a fixed wait
 * reads it mid-glide on a loaded machine). */
async function cursorOn(page: Page, el: Locator): Promise<boolean> {
  await page.waitForFunction(() => {
    const c = document.querySelector("[data-cursor]");
    return Boolean(c) && c!.getAnimations().every((a) => a.playState !== "running");
  });
  const c = await page.locator("[data-cursor]").boundingBox();
  const b = await el.boundingBox();
  if (!c || !b) return false;
  const [x, y] = [c.x + c.width / 2, c.y + c.height / 2];
  return x >= b.x - 2 && x <= b.x + b.width + 2 && y >= b.y - 2 && y <= b.y + b.height + 2;
}

test("his computer: each kind of work as itself, its numbers the file's, him as the cursor, a chime when done", { skip, ...LONG }, async (t) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const model = await fakeModel(t, [
    write("sales.csv", CSV),
    { ...write("report.md", "# Q1\n\nSales grew **a lot**.\n\n- Jan 12\n- Feb 30"), hold: held }, // held: we look while he works
    write("sales.json", '[{"month":"Jan","total":12},{"month":"Feb","total":30},{"month":"Mar","total":21}]'),
    write("page.html", "<h1>Q1 sales</h1><p>Up and to the right.</p>"),
    write("team.ics", ICS),
    { chunks: ["The Q1 pack is ready."] },
  ]);
  const data = mkdtempSync(join(tmpdir(), "orbs-computer-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { decide: () => "allow", passWaitMs: 20 },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "data", { shape: "bean", eyes: "classic", hue: "amber" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  await ctx.addInitScript(() => {
    (globalThis as { __orbsSounds?: unknown[] }).__orbsSounds = []; // the sounds it plays, kept for the test
  });
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.getByText("Founder Robin").waitFor({ timeout: 30_000 });
  await profile(page, "Hazel"); // the office opens on its floor; the chat is on Hazel's profile
  await page.getByRole("button", { name: "Chat with Hazel" }).click();
  const computer = page.locator('[data-computer="hazel"]');
  await computer.waitFor();
  assert.equal(await page.locator("[data-cursor]").count(), 0, "before he does anything, no cursor");
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });
  const box = page.getByRole("textbox", { name: "Message Hazel" });
  await box.fill("Make the Q1 pack");
  await box.press("Enter");

  // while he works: the dataset he just wrote, its counts the file's, the cursor on its last row
  await computer.locator('[data-kind="dataset"]').waitFor({ timeout: 20_000 });
  assert.equal(await computer.locator("[data-counts]").innerText(), "3 rows · 2 columns");
  assert.deepEqual(await computer.locator("tbody tr").allInnerTexts(), ["Jan\t12", "Feb\t30", "Mar\t21"]);
  await page.locator("[data-cursor]").waitFor();
  assert.ok(await cursorOn(page, computer.locator("tbody tr").last()), "he is the cursor, on the row he wrote last");
  await shot(page, "dataset-working");
  release();

  // done: the last thing he made is open (the calendar), a chime, and the cursor on its last event
  await page.locator('[data-role="assistant"]', { hasText: "The Q1 pack is ready." }).waitFor({ timeout: 30_000 });
  await computer.locator('[data-kind="calendar"]').waitFor({ timeout: 20_000 });
  const events = await computer.innerText();
  assert.ok(events.indexOf("2026-10-03") < events.indexOf("2026-10-09 10:00"), "its events in order");
  assert.match(events, /Rent due[\s\S]*Q1 review/);
  assert.ok(await cursorOn(page, computer.locator("[data-act]", { hasText: "Q1 review" })), "on the event he wrote last");
  await shot(page, "calendar-done");
  const sounds = await page.evaluate(() => ((globalThis as { __orbsSounds?: { sound: string }[] }).__orbsSounds ?? []).map((s) => s.sound));
  assert.ok(sounds.includes("create"), `a chime when he finished (${sounds.join(", ")})`);

  // on a tab where his last step did not act, he is not there: he never points at what he did not touch
  await computer.getByRole("tab", { name: "Terminal" }).click();
  await computer.getByText("No commands yet.").waitFor();
  assert.equal(await page.locator("[data-cursor]").count(), 0, "no step acted here: no cursor");
  // his Files: everything he made, the last one where the cursor is
  await computer.getByRole("tab", { name: "Files" }).click();
  await computer.locator('[data-file="team.ics"]').waitFor();
  assert.deepEqual(await computer.locator("[data-file]").evaluateAll((els) => els.map((e) => e.getAttribute("data-file"))), ["page.html", "report.md", "sales.csv", "sales.json", "team.ics"]);
  assert.ok(await cursorOn(page, computer.locator('[data-file="team.ics"]')), "on the file he wrote last");

  // each kind as itself
  await computer.locator('[data-file="sales.json"]').click();
  await computer.locator('[data-kind="dashboard"]').waitFor();
  // each bar's length is its own (as set: measured on screen, a bar still growing reads short)
  const bars = await computer.locator("[data-bar]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-bar"), e.textContent, Number.parseFloat((e.querySelector("i") as HTMLElement).style.width)]));
  assert.deepEqual(bars.map(([l, text]) => [l, text]), [["Jan", "Jan12"], ["Feb", "Feb30"], ["Mar", "Mar21"]], "the file's numbers");
  assert.deepEqual(bars.map((b) => Math.round(b[2] as number)), [40, 100, 70], "each bar as long as its number (of the longest)");
  await shot(page, "dashboard");
  await computer.getByRole("tab", { name: "Files" }).click();
  await computer.locator('[data-file="page.html"]').click();
  await computer.locator('[data-kind="ui"]').waitFor();
  assert.equal(await computer.frameLocator('iframe[title="page.html, as a page"]').locator("h1").innerText(), "Q1 sales", "the page, as a page");
  assert.equal(await computer.locator("iframe").getAttribute("sandbox"), "", "in a sandbox with nothing of the app's");
  await shot(page, "page");
  await computer.getByRole("tab", { name: "Files" }).click();
  await computer.locator('[data-file="report.md"]').click();
  await computer.locator('[data-kind="doc"]').waitFor();
  assert.equal(await computer.locator("article h3").innerText(), "Q1");
  assert.match(await computer.locator("article").innerText(), /Sales grew a lot\.[\s\S]*• Jan 12[\s\S]*• Feb 30/);
  await computer.getByRole("button", { name: "Source" }).click();
  assert.match(await computer.locator("pre").innerText(), /# Q1/, "and its source, a press away");
  assert.deepEqual(await measure(page), [], "nothing spills at desk size, his computer beside the chat");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "nor at phone size, one above the other");
  await shot(page, "phone");
});
