// PLAN 2.4_t (the composer: attach), in a real browser on a real home: in a private chat you give
// him a file; it is kept in his workspace's from-you/, it shows as a chip you can take off before
// sending, and your message says where it is, so he can read it. Nothing spills on a phone.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { MemoryStore } from "../../home/src/chatgpt/store.ts";
import { workspaceOf } from "../../home/src/workspace.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-attach-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("a file given in a private chat: kept in from-you, a chip until sent, its path in your message", { skip, timeout: 150_000 }, async (t) => {
  const model = await fakeModel(t, [{ chunks: ["Got it: two months in there."] }]);
  const data = mkdtempSync(join(tmpdir(), "orbs-attach-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null, brains: { store: new MemoryStore() }, chatgpt: { store: new MemoryStore() },
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { passWaitMs: 20 },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.goto(page.url().replace(/#.*$/, "#/chat/Ada"));
  await page.getByRole("button", { name: "Give Ada a file" }).waitFor({ timeout: 20_000 });
  // the composer (owner, 10-10, on a phone: "hands free and file containers should be icons. and placed differently, even
  // the text box when we type it grows weirdly, make it bigger"): what you write across the composer, the file, hands-free
  // and the microphone as icons under it, and a long message in a few full lines (beside the three as words the box was
  // 170 px wide and this message filled its 160 px cap; across, 108 px: the line halfway)
  const [composer, field, file, hands, mic] = await Promise.all([
    page.locator("[data-composer]").boundingBox(), page.locator("[data-composer] textarea").boundingBox(),
    page.getByRole("button", { name: "Give Ada a file" }).boundingBox(), page.getByRole("button", { name: "Hands-free" }).boundingBox(),
    page.getByRole("button", { name: "Talk to Ada" }).boundingBox(),
  ]);
  assert.ok(composer && field && file && hands && mic);
  assert.ok(field.width >= composer.width * 0.85, `the text box across the composer (${Math.round(field.width)} of ${Math.round(composer.width)} px)`);
  for (const [what, b] of [["the file", file], ["hands-free", hands], ["the microphone", mic]] as const) {
    assert.ok(b.width <= 44 && b.height <= 44, `${what} an icon (${Math.round(b.width)} by ${Math.round(b.height)})`);
    assert.ok(b.y >= field.y + field.height - 1, `${what} under the text box`);
  }
  const field2 = page.locator("[data-composer] textarea");
  await field2.fill("Can you look over the invoices for this month and tell me which ones are late, and draft a polite reminder for each client that has not paid yet?");
  const tall = await field2.evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(tall <= 134, `a long message in a few full lines (${Math.round(tall)} px)`);
  await field2.fill("");
  await page.getByLabel("Files to give Ada").setInputFiles([
    { name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from("month,total\nJan,12\nFeb,30\n") },
    { name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("not this one") },
  ]);
  const given = page.locator("[data-given]");
  await given.getByText("sales.csv").waitFor({ timeout: 20_000 });
  await given.getByText("draft.txt").waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(page), [], "nothing spills at phone size, the chips in");
  await page.getByRole("button", { name: "Don't send from-you/draft.txt" }).click();
  await page.getByLabel("Message Ada").fill("the first two months");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  for (let i = 0; i < 100 && !h.conversations.list("chat:ada").some((m) => m.role === "assistant"); i++) await new Promise((r) => setTimeout(r, 50));
  const mine = h.conversations.list("chat:ada").find((m) => m.role === "user")!;
  assert.equal(mine.content, "the first two months\n[Attached: from-you/sales.csv]", "his message says where it is; the one taken off is not in it");
  assert.equal(readFileSync(join(workspaceOf(data, "ada"), "from-you", "sales.csv"), "utf8"), "month,total\nJan,12\nFeb,30\n");
  assert.ok(String(JSON.stringify(model.agent[0])).includes("[Attached: from-you/sales.csv]"), "he is told");
});
