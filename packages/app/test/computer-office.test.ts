// PLAN 4.9_t and 4.10_t on his computer (rooms/Computer.tsx), in a private chat on a real home with a scripted model
// and a stand-in mail server: the office work of "a sheet for your boss, and the work inbox cleaned".
//   - The workbook he makes shows as a spreadsheet: lettered columns, numbered rows, the header, the totals as Excel
//     shows them, the formula bar on the totals' formula, a cell pressed shows its own, the sheets' tabs.
//   - The inbox he looks through shows on his screen; the tidy he proposes puts each message's fate beside it while
//     the card waits; nothing moves before your Approve; then the ones filed away leave it, the summary says what was
//     done, and the mail server holds exactly that.
//   - Nothing spills at desk or phone size.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure, profile } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";
import { fakeImap } from "../../home/test/fakes/imap.ts";

const LONG = { timeout: 150_000 };
const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-office-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

/** With ORBS_SHOTS=<dir>, a picture of each stage for the owner. */
const shot = async (page: Page, name: string): Promise<void> => {
  if (process.env.ORBS_SHOTS) await page.screenshot({ path: join(process.env.ORBS_SHOTS, `office-${name}.png`) });
};
const SHEET = {
  path: "q3-by-region.xlsx", title: "Q3 by region",
  sheets: [
    {
      name: "Q3", title: "Q3 Results by Region", subtitle: "Prepared for Dana Whitfield",
      columns: [
        { name: "Region" }, { name: "Revenue", type: "currency", total: "sum" }, { name: "Cost", type: "currency", total: "sum" },
        { name: "Profit", type: "currency", formula: "[Revenue]-[Cost]", total: "sum" }, { name: "Margin", type: "percent", formula: "[Profit]/[Revenue]", total: "formula" },
      ],
      rows: [["North", "1250000", "830000"], ["South", "980000", "610000"], ["West", "540000", "402000"]],
      notes: ["From the September close."],
    },
    { name: "Notes", columns: ["Item"], rows: [["Check FX on South"]] },
  ],
};
const mail = (from: string, subject: string, list = false) => `From: ${from}\r\nSubject: ${subject}\r\nDate: Mon, 12 Oct 2026 08:00:00 +0000\r\n${list ? "List-Unsubscribe: <mailto:u@x.example>\r\n" : ""}\r\nbody\r\n`;

test("office work on his computer: a workbook as a spreadsheet; an inbox tidied only on your Approve, the filed ones leaving it", { skip, ...LONG }, async (t) => {
  const imap = await fakeImap(t, { user: "robin@work.example", password: "pw-not-real-1357", archive: { name: "Archive", use: "\\Archive" } });
  imap.deliver(mail("Dana Whitfield <dana@acme.example>", "Q3 numbers for Thursday?"));
  imap.deliver(mail("LinkedIn <news@linkedin.example>", "12 new jobs for you", true));
  imap.deliver(mail("Uber Receipts <receipts@uber.example>", "Your Thursday trip"));
  imap.deliver(mail("GitHub <noreply@github.example>", "CI passed on main", true));
  const model = await fakeModel(t, [
    { calls: [{ name: "write_sheet", args: SHEET }] },
    { calls: [{ name: "list_mail", args: { account: "work", count: 10 } }] },
    { calls: [{ name: "tidy_mail", args: { account: "work", archive: [2], folders: [{ folder: "Receipts", uids: [3] }], read: [4] } }] },
    { chunks: ["The Q3 sheet is ready for Dana, and your inbox is down to Dana's question."] },
  ]);
  const data = mkdtempSync(join(tmpdir(), "orbs-office-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { decide: () => "allow", passWaitMs: 20 }, // every rule allows: the tidy still waits for you (it read your mail)
    connectors: { store: new MemoryStore() },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "data", { shape: "bean", eyes: "classic", hue: "amber" });
  await h.mail.add("work", { host: "127.0.0.1", port: imap.port, tls: false, user: "robin@work.example" }, "pw-not-real-1357");
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.getByText("Founder Robin").waitFor({ timeout: 30_000 });
  await profile(page, "Hazel");
  await page.getByRole("button", { name: "Chat with Hazel" }).click();
  const computer = page.locator('[data-computer="hazel"]');
  await computer.waitFor();
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });
  const box = page.getByRole("textbox", { name: "Message Hazel" });
  await box.fill("Make Dana a professional Q3 sheet by region, and clean up my work email");
  await box.press("Enter");

  // the inbox, his fates beside each message, while the card waits for you
  await page.locator("[data-card]").waitFor({ timeout: 30_000 });
  await computer.locator('[data-kind="inbox"][data-state="asking"]').waitFor({ timeout: 20_000 });
  assert.deepEqual(await computer.locator("[data-uid]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-uid"), e.getAttribute("data-fate")])),
    [["4", "read"], ["3", "folder"], ["2", "archive"], ["1", "stays"]], "the newest first, each with its fate");
  assert.deepEqual(await computer.locator("[data-fate-chip]").allInnerTexts(), ["Mark read", "→ Receipts", "Archive"]);
  assert.match(await computer.locator("[data-asking]").innerText(), /Waiting for your OK: archive 1, file 1 in Receipts, mark 1 read/);
  assert.match(await page.locator("[data-card]").innerText(), /Archive 1: LinkedIn[\s\S]*Into Receipts 1: Uber Receipts[\s\S]*Left in your inbox: 2, from Dana Whitfield, GitHub/);
  assert.equal(imap.boxes.get("INBOX")!.length, 4, "nothing moved before your Approve");
  await shot(page, "inbox-asking");
  await page.locator("[data-card]").getByRole("button", { name: "Approve" }).click();

  // done: the filed ones leave, what was done said over it, the server holds exactly that
  await computer.locator('[data-kind="inbox"][data-state="done"]').waitFor({ timeout: 30_000 });
  await computer.locator("[data-tidied]").waitFor();
  assert.match(await computer.locator("[data-tidied]").innerText(), /Archived 1 \(in Archive\), filed 1 in Receipts, marked 1 read\. Nothing was deleted\./);
  assert.deepEqual(await computer.locator("[data-gone]").evaluateAll((els) => els.map((e) => e.getAttribute("data-uid"))), ["3", "2"]);
  await page.waitForFunction(() => [...document.querySelectorAll("[data-gone]")].every((e) => e.getAnimations().every((a) => a.playState === "finished")), null, { timeout: 10_000 });
  assert.deepEqual(await computer.locator("[data-gone]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height))), [0, 0], "and their rows closed up");
  assert.equal(await computer.locator("[data-counts]").innerText(), "2 of 2 · 1 unread");
  assert.deepEqual([imap.boxes.get("INBOX")!.length, imap.boxes.get("Archive")!.length, imap.boxes.get("Receipts")!.length], [2, 1, 1]);
  await page.locator('[data-role="assistant"]', { hasText: "down to Dana's question" }).waitFor({ timeout: 30_000 });
  await shot(page, "inbox-done");

  // the workbook: a spreadsheet, as Excel shows it
  await computer.getByRole("tab", { name: "Files" }).click();
  await computer.locator('[data-file="q3-by-region.xlsx"]').click();
  await computer.locator("[data-sheet]").waitFor({ timeout: 20_000 });
  assert.deepEqual(await computer.locator('tr[data-row="4"] td').allInnerTexts(), ["Region", "Revenue", "Cost", "Profit", "Margin"], "the header, in row 4 under the title");
  assert.deepEqual(await computer.locator('tr[data-row="5"] td').allInnerTexts(), ["North", "$1,250,000.00", "$830,000.00", "$420,000.00", "33.6%"]);
  assert.deepEqual(await computer.locator('tr[data-row="8"] td').allInnerTexts(), ["Total", "$2,770,000.00", "$1,842,000.00", "$928,000.00", "33.5%"], "the totals row");
  assert.deepEqual([await computer.locator("[data-cell-ref]").innerText(), await computer.locator("[data-cell-shows]").innerText()], ["E8", "=D8/B8"], "the formula bar on the totals' last formula");
  await computer.locator('[data-cell="D5"]').click();
  assert.deepEqual([await computer.locator("[data-cell-ref]").innerText(), await computer.locator("[data-cell-shows]").innerText()], ["D5", "=B5-C5"]);
  await shot(page, "sheet");
  await computer.getByRole("tab", { name: "Notes" }).click();
  assert.deepEqual(await computer.locator('tr[data-row="2"] td').allInnerTexts(), ["Check FX on South"], "its other sheet");
  assert.deepEqual(await measure(page), [], "nothing spills at desk size");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "nor at phone size");
  await shot(page, "phone");
});
