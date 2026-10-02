// PLAN 2.7_t in a real browser, on a real home, with Chromium's virtual authenticator:
//   - Settings makes a passkey on this device; another browser, never paired, signs in with it from
//     the opening screen and the office opens.
//   - "Add a phone" shows a QR code of a pairing link; the phone that opens it is in; signed out from
//     the desk, it is locked out at its next request.
//   - Nothing spills at phone or desk size.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-devices-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

/** A virtual authenticator on the page (a platform one: a fingerprint, always verified). */
async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

test("a passkey made in Settings signs another browser in; a phone paired by its QR code is signed out from the desk", { skip, timeout: 150_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-devices-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const at = `http://localhost:${d.port}`; // a passkey needs a name: localhost, not 127.0.0.1
  const contexts: BrowserContext[] = [];
  t.after(async () => {
    for (const c of contexts) await c.close();
  });
  const open = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    contexts.push(ctx);
    return ctx.newPage();
  };

  // the desk: paired by its link, then a passkey made in Settings
  const desk = await open({ width: 1280, height: 900 });
  const key = await authenticator(desk);
  await desk.goto(d.pairLink().replace("http://127.0.0.1", "http://localhost"));
  await desk.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await desk.goto(`${at}/app/orbs.html#/settings`);
  const passkeys = desk.locator('[aria-label="Passkeys"]');
  await passkeys.getByRole("button", { name: "Add a passkey on this device" }).click();
  await passkeys.locator("[data-passkey]").waitFor({ timeout: 20_000 });
  assert.equal(h.passkeys.list().length, 1, "kept on the home");
  assert.deepEqual(await measure(desk), [], "Settings spills nothing at desk size");

  // another browser, never paired: the same passkey (synced, as a phone's would be) signs it in
  const laptop = await open({ width: 1280, height: 900 });
  const there = await authenticator(laptop);
  const { credentials } = await key.cdp.send("WebAuthn.getCredentials", { authenticatorId: key.authenticatorId });
  assert.equal(credentials.length, 1);
  await there.cdp.send("WebAuthn.addCredential", { authenticatorId: there.authenticatorId, credential: credentials[0]! });
  await laptop.goto(`${at}/app/orbs.html`);
  await laptop.getByText(/this browser is not signed in to your home yet/).waitFor({ timeout: 30_000 });
  await laptop.getByRole("button", { name: "Sign in with your passkey" }).click();
  await laptop.locator(".orbs-window").waitFor({ timeout: 30_000 });
  assert.deepEqual(h.sessions.list().map((x) => x.via).sort(), ["pair", "passkey"]);

  // a phone, by the QR code the desk shows
  const devices = desk.locator('[aria-label="Your devices"]');
  await devices.getByRole("button", { name: "Add a phone" }).click();
  const code = desk.locator("[data-qr]");
  await code.waitFor({ timeout: 20_000 });
  const link = (await code.getAttribute("data-qr"))!;
  assert.match(link, /#pair=/);
  const phone = await open({ width: 390, height: 844 });
  await phone.goto(link);
  await phone.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await phone.goto(phone.url().replace(/#.*$/, "#/settings"));
  await phone.locator('[aria-label="Your devices"] [data-device]').first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(phone), [], "nor at phone size");
  assert.equal(h.sessions.list().length, 3);

  // signed out from the desk: the phone's next request is refused
  await desk.getByRole("button", { name: "Done" }).click();
  await devices.locator("[data-device]").nth(2).waitFor({ timeout: 20_000 }); // the list again, all three (they share a name)
  const phoneDevice = h.sessions.list()[0]!; // the phone, the newest
  await devices.locator(`[data-device="${phoneDevice.id}"]`).getByRole("button", { name: /^Sign out/ }).click();
  for (let i = 0; i < 40 && h.sessions.list().length !== 2; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(h.sessions.list().map((x) => x.id).includes(phoneDevice.id), false, "the phone, and only the phone, signed out");
  assert.equal(h.sessions.list().length, 2);
  const status = await phone.evaluate(async () => (await fetch("../status", { credentials: "same-origin" })).status);
  assert.equal(status, 401, "locked out at its next request");
});
