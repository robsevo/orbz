// PLAN 4.1_t (his computer), on a real Chromium and a stand-in web (shop.test, login.test and
// evil.test, all this machine, named through the guard's resolver seam):
//   - A "Place order" click asks, and nothing is ordered until you say yes; a button that says more
//     than he named ("Continue" that is "Continue to payment") is not pressed at all.
//   - (Your Chrome's profile untouched: computer-profile.test.ts, which runs under a home of its own.)
//   - A password never appears in a trace: it is typed only on the site it was saved for, never
//     reaches the model, the log, a trace or a file of the home's; a page that echoes it back is
//     read with it taken out.
//   - Never this machine or its network: refused by name, and a page's own requests never leave.
//   - What he downloads lands in his workspace, under a plain name; while you have his computer
//     his acts wait for you; every act leaves a still of his screen, with his cursor on it.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { chromiumPath, profileOf } from "../src/computer/browser.ts";
import { clickFloor, consents, fieldFloor } from "../src/computer/tools.ts";
import { HIDDEN } from "../src/computer/vault.ts";
import { agentHome } from "./helpers.ts";
import { web } from "./fakes/web.ts";

const EXE = chromiumPath();
if (!EXE) throw new Error("no Chromium for his browser: set ORBS_CHROME, or `npx playwright install chromium`");
const PASSWORD = "hunter2-correct-horse"; // a dummy, saved and typed only on the stand-in web

test("the floor reads what a click and a field commit to", () => {
  const cats = (h: { category: string }[]) => h.map((x) => x.category);
  assert.deepEqual(cats(clickFloor("Place order")), ["money"]);
  assert.deepEqual(cats(clickFloor("Continue to payment")), ["money"]);
  assert.deepEqual(cats(clickFloor("Send message")), ["messaging"]);
  assert.deepEqual(cats(clickFloor("Delete account")), ["deleting"]);
  assert.deepEqual(cats(clickFloor("Cancel subscription")), ["money", "deleting"], "a subscription is money, and cancelling deletes");
  assert.deepEqual(cats(clickFloor("Book a table")), ["calendar"]);
  assert.deepEqual(cats(clickFloor("Next page")), []);
  assert.deepEqual(cats(clickFloor("About us")), []);
  assert.deepEqual(cats(clickFloor("Posts")), [], "a tab of posts is not posting");
  assert.equal(consents("I agree"), true);
  assert.equal(consents("Allow access"), true);
  assert.equal(consents("Read more"), false);
  assert.deepEqual(cats(fieldFloor("Card number")), ["money"]);
  assert.deepEqual(cats(fieldFloor("CVV")), ["money"]);
  assert.deepEqual(cats(fieldFloor("Verification code")), ["passwords"]);
  assert.deepEqual(cats(fieldFloor("Search")), []);
});

test('a "Place order" click asks, and nothing is ordered until you say yes; a button that says more is not pressed', { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home } = await agentHome(t, [
    { calls: [{ name: "open_page", args: { url: site.url("shop.test", "/shop") } }] },
    { calls: [{ name: "click", args: { text: "Place order" } }] },
    { chunks: ["Ordered."] },
    { calls: [{ name: "click", args: { text: "Continue" } }] },
    { chunks: ["It wanted more than I named."] },
  ], { kit: true, computer: { executable: EXE } });
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "order it");
  await home.inbox.idle();
  const card = home.conversations.openCard("chat:juniper")!;
  assert.ok(card, "the click waits for your OK");
  assert.match(card.title, /click "Place order" in its browser/);
  assert.deepEqual([(card.meta.floor as { category: string }[]).map((f) => f.category), card.meta.mayAlways], [["money"], false], "money: always asks, never 'always'");
  assert.equal(site.orders, 0, "nothing ordered while it waits");
  home.answerCard(card.id, "approve");
  await home.inbox.idle();
  assert.equal(site.orders, 1, "your yes pressed it, once");

  await home.computers.open("juniper", site.url("shop.test", "/shop"));
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "continue");
  await home.inbox.idle();
  assert.equal(home.conversations.openCard("chat:juniper") ?? null, null, '"Continue" alone does not ask...');
  assert.equal(site.payments, 0, "...and is not pressed: the button says more");
  const said = home.conversations.list("chat:juniper").filter((m) => m.role === "tool").at(-1)!.content;
  assert.match(said, /Not clicked: it says "Continue to payment"/, "he is told to name it, so the card shows what is real");
});

test("a password is typed only on its own site, and never reaches the model, the log, a trace or a file", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const store = new MemoryStore();
  const { home, model, dataDir } = await agentHome(t, [
    { calls: [{ name: "open_page", args: { url: site.url("login.test", "/login") } }] },
    { calls: [{ name: "sign_in", args: {} }] },
    { calls: [{ name: "click", args: { text: "Sign in" } }] },
    { calls: [{ name: "read_page", args: {} }] },
    { chunks: ["Signed in."] },
    { calls: [{ name: "open_page", args: { url: site.url("evil.test", "/login") } }] },
    { calls: [{ name: "sign_in", args: {} }] },
    { chunks: ["No password for that one."] },
  ], { kit: true, computer: { executable: EXE, store } });
  await home.vault.add("login.test", "robin", PASSWORD);

  home.inbox.enqueue("juniper", "chat:juniper", "chat", "sign in to login.test");
  await home.inbox.idle();
  const card = home.conversations.openCard("chat:juniper")!;
  assert.deepEqual((card.meta.floor as { category: string }[]).map((f) => f.category), ["passwords"], "a saved password: always asks");
  home.answerCard(card.id, "approve");
  await home.inbox.idle();
  assert.deepEqual(site.sessions, [{ user: "robin", pass: PASSWORD }], "typed into its own site's form, and it worked");
  const read = home.conversations.list("chat:juniper").filter((m) => m.role === "tool").at(-1)!.content;
  assert.ok(read.includes(`Your password is ${HIDDEN}`), `the page echoed it back, and he read it hidden: ${read.slice(-200)}`);

  home.inbox.enqueue("juniper", "chat:juniper", "chat", "now sign in on evil.test");
  await home.inbox.idle();
  const evil = home.conversations.openCard("chat:juniper")!;
  home.answerCard(evil.id, "approve"); // even with your yes...
  await home.inbox.idle();
  assert.equal(site.sessions.length, 1, "...another site gets nothing");
  const refused = home.conversations.list("chat:juniper").filter((m) => m.role === "tool").at(-1)!.content;
  assert.match(refused, /no password is saved for evil\.test/);

  // nowhere: what the model was sent, the log (traces are in it), every file of the home's
  assert.ok(!JSON.stringify(model.agent).includes(PASSWORD), "never in what the model was sent");
  assert.ok(!JSON.stringify(home.events.since(0, 100_000)).includes(PASSWORD), "never in the log or a trace");
  const leaks: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (p !== profileOf(dataDir, "juniper")) walk(p); // his browser's own storage is the browser's (checked below)
      } else if (readFileSync(p).includes(PASSWORD)) leaks.push(relative(dataDir, p));
    }
  };
  walk(dataDir);
  assert.deepEqual(leaks, [], "never in a file of the home's");
  await home.computers.sleep("juniper");
  const profileLeaks: string[] = [];
  const walkProfile = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walkProfile(p);
      else if (statSync(p).size < 20_000_000 && readFileSync(p).includes(PASSWORD)) profileLeaks.push(relative(dataDir, p));
    }
  };
  walkProfile(profileOf(dataDir, "juniper"));
  assert.deepEqual(profileLeaks, [], "nor kept by his browser (its password manager is off)");
});

test("a click that consents asks unless your rules allow it; typing after reading a page waits for your yes; a card's field always asks", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home } = await agentHome(t, [
    { calls: [{ name: "open_page", args: { url: site.url("shop.test", "/shop") } }] },
    { calls: [{ name: "click", args: { text: "I agree" } }] },
    { chunks: ["Agreed."] },
    { calls: [{ name: "open_page", args: { url: site.url("shop.test", "/checkout") } }] },
    { calls: [{ name: "type_into", args: { field: "Note", text: "leave it at the door" } }] },
    { calls: [{ name: "type_into", args: { field: "Number", text: "4242 4242 4242 4242" } }] },
    { calls: [{ name: "type_into", args: { field: "Card number", text: "4242 4242 4242 4242" } }] },
    { chunks: ["Waiting for you."] },
  ], { kit: true, computer: { executable: EXE } });
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "agree to the terms");
  await home.inbox.idle();
  const agree = home.conversations.openCard("chat:juniper")!;
  assert.ok(agree, "consenting asks");
  assert.deepEqual([(agree.meta.floor as unknown[]).length, agree.meta.mayAlways], [0, true], "by default only: not the floor, so your rules may allow it");
  home.answerCard(agree.id, "approve");
  await home.inbox.idle();

  home.inbox.enqueue("juniper", "chat:juniper", "chat", "fill in the checkout");
  await home.inbox.idle();
  const note = home.conversations.openCard("chat:juniper")!;
  assert.match(note.title, /type "leave it at the door" into "Note"/);
  assert.ok((note.meta.why as string[]).some((w) => /read something from outside/.test(w)), "the turn read a page: typing into one needs your fresh yes");
  home.answerCard(note.id, "approve");
  await home.inbox.idle();
  const said = home.conversations.list("chat:juniper").filter((m) => m.role === "tool").map((m) => m.content);
  assert.ok(said.some((x) => /Not typed: that field is "Number Card number/.test(x)), "named short of its label, the card's field is not typed into");
  const card = home.conversations.openCard("chat:juniper")!;
  assert.deepEqual((card.meta.floor as { category: string }[]).map((f) => f.category), ["money"], "named for what it is, a card number always asks");
  home.answerCard(card.id, "deny");
  await home.inbox.idle();
});

test("never this machine or its network: refused by name, and a page's own requests never leave", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home } = await agentHome(t, [
    { calls: [{ name: "open_page", args: { url: "http://10.1.2.3/admin" } }] },
    { calls: [{ name: "open_page", args: { url: site.url("intranet.test", "/x") } }] },
    { chunks: ["Neither opened."] },
  ], { kit: true, computer: { executable: EXE } });
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "open the router");
  await home.inbox.idle();
  const tools = home.conversations.list("chat:juniper").filter((m) => m.role === "tool").map((m) => m.content);
  assert.match(tools[0]!, /Not opened: refusing to fetch a private or reserved address \(10\.1\.2\.3\)/);
  assert.match(tools[1]!, /Not opened: intranet\.test resolves to a private or reserved address/);
  await home.computers.open("juniper", site.url("shop.test", "/leak"));
  await new Promise((r) => setTimeout(r, 1500)); // the page's image and fetch have had their chance
  assert.equal(site.leaks, 0, "the canary heard nothing: by name or by address, the page's images and fetch were stopped at the proxy");
  assert.ok(site.loopLeaks === null || site.loopLeaks === 0, "nor this machine's other loopback addresses: loopback goes through the proxy too");
  assert.ok(home.events.ofType("computer.blocked").some((e) => (e.data as { host: string }).host === "intranet.test"), "and the home recorded what it stopped");
});

test("downloads land in his workspace under a plain name; while you have his computer his acts wait; every act leaves a still", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home, dataDir } = await agentHome(t, [], { computer: { executable: EXE } });
  await home.computers.open("juniper", site.url("shop.test", "/download"));
  await home.computers.click("juniper", "Get the file");
  for (let i = 0; i < 50 && !home.events.ofType("computer.downloaded").length; i++) await new Promise((r) => setTimeout(r, 100));
  const got = home.events.ofType("computer.downloaded").map((e) => (e.data as { path: string }).path);
  assert.equal(got.length, 1);
  assert.match(got[0]!, /^downloads\/[^/\\]*evil\.txt$/, "a plain name in his downloads folder");
  assert.equal(readFileSync(join(dataDir, "orbs", "juniper", "workspace", got[0]!), "utf8"), "file body");
  assert.equal(existsSync(join(dataDir, "orbs", "evil.txt")) || existsSync(join(dataDir, "evil.txt")), false, '"../../" went nowhere');

  const still = home.computers.screen("juniper");
  const meta = JSON.parse(readFileSync(still.meta, "utf8")) as { url: string; cursor: { x: number; y: number } | null };
  assert.ok(readFileSync(still.file).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), "a JPEG of his screen");
  assert.ok(meta.cursor && meta.cursor.x > 0 && meta.cursor.y > 0, "with his cursor where he clicked");

  home.computers.takeOver("juniper");
  await assert.rejects(home.computers.click("juniper", "Get the file"), /the person has your computer right now/);
  home.computers.handBack("juniper");
  await home.computers.open("juniper", site.url("shop.test", "/about"));
  assert.match((await home.computers.read("juniper")).text, /We sell things/, "handed back: he goes on");
  assert.deepEqual(home.events.ofType("computer.taken_over").length + home.events.ofType("computer.handed_back").length, 2);
});

test("through the door: passwords saved and listed, never shown back; his screen, take over, hand back, reset", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  const { home } = await agentHome(t, [], { computer: { executable: EXE, store: new MemoryStore() } });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, b?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(b !== undefined && { body: JSON.stringify(b) }) });
    return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() };
  };
  assert.equal((await call("POST", "/vault", { site: "https://login.test/login", username: "robin", password: PASSWORD })).status, 200);
  const listed = await call("GET", "/vault");
  assert.ok(listed.text.includes("login.test") && listed.text.includes("robin") && !listed.text.includes(PASSWORD), "listed by site and username, never the password");
  assert.equal((await call("POST", "/vault", { site: "not a site", username: "x", password: "y" })).status, 400);
  assert.equal((await call("GET", "/orbs/juniper/screen.jpg")).status, 404, "no still before he has looked at anything");
  await home.computers.open("juniper", site.url("shop.test", "/about"));
  const shot = await call("GET", "/orbs/juniper/screen.jpg");
  assert.deepEqual([shot.status, shot.type], [200, "image/jpeg"]);
  const state = JSON.parse((await call("GET", "/orbs/juniper/computer")).text) as { awake: boolean; takenOver: boolean; screen: { url: string } };
  assert.deepEqual([state.awake, state.takenOver, state.screen.url], [true, false, site.url("shop.test", "/about")]);
  assert.equal(JSON.parse((await call("POST", "/orbs/juniper/computer/take-over")).text).takenOver, true);
  assert.equal(home.computers.takenOver("juniper"), true);
  assert.equal(JSON.parse((await call("POST", "/orbs/juniper/computer/hand-back")).text).takenOver, false);
  assert.equal(JSON.parse((await call("POST", "/orbs/juniper/computer/reset")).text).awake, false);
  assert.equal((await call("POST", "/orbs/nobody/computer/reset")).status, 404);
  assert.equal(JSON.parse((await call("POST", "/vault/remove", { site: "login.test", username: "robin" })).text).entries.length, 0);
});
