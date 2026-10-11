// The floor's small things (floor/props.ts, floor/Props.tsx; owner, 10-10): each answers only in its turn, the turns read
// from the table (never written in this file), and out of its turn nothing shakes, moves or falls; what falls is picked
// up, kept by the home (a reload, another device, still have it) and carried in the side menu; the game takes what is
// carried to it, dragged there or taken in hand and pressed on it; only the last turn's words, read off what was found,
// do what they do, and before that nothing of it shows. The words are nowhere in the app's code or its build (a planted
// copy is found).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";
import { CARRIED, keptBy, NAMES, opens, piecesOf, TURNS, turnNow, type Thing } from "../src/floor/props.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(APP, "..", "..");
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  dist = mkdtempSync(join(tmpdir(), "orbs-things-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  if (!skip) browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const words = (): string[] => piecesOf(TURNS.map(keptBy)) as string[];

test("the turns: one at a time, in the table's order; each keeps something of its own; the words open only whole and in order", async () => {
  assert.equal(turnNow([]), TURNS[0]);
  const kept: string[] = [];
  for (const [i, t] of TURNS.entries()) {
    assert.equal(turnNow(kept), t, `turn ${i} comes after the ${i} before it, and not before`);
    // what a later turn keeps, kept early, does not move the turn on
    for (const later of TURNS.slice(i + 1)) assert.equal(turnNow([...kept, keptBy(later)]), t);
    kept.push(keptBy(t));
  }
  assert.equal(turnNow(kept), null);
  assert.equal(new Set(TURNS.map(keptBy)).size, TURNS.length, "every turn keeps a thing of its own");
  assert.equal(CARRIED.stick, keptBy(TURNS[0]!));
  assert.equal(CARRIED.open, keptBy(TURNS[TURNS.length - 1]!));
  assert.equal(CARRIED.pieces.length, 3);
  // the paper shows only what was found, in its place
  assert.deepEqual(piecesOf([]), [null, null, null]);
  assert.deepEqual(piecesOf([CARRIED.pieces[1]!]).map((w) => w !== null), [false, true, false]);
  const w = words();
  assert.ok(w.every((x) => typeof x === "string" && x.length > 0), "three pieces, each with its words");
  assert.equal(await opens(w.join("")), true);
  assert.equal(await opens(`  ${w.join("")} `), true, "spaces round it are forgiven");
  assert.equal(await opens(w.slice().reverse().join("")), false, "out of order, it stays shut");
  assert.equal(await opens(w.slice(0, 2).join("")), false, "a part of it stays shut");
  assert.equal(await opens(""), false);
  const one = w.join("");
  assert.equal(await opens(`${one.slice(0, 3)}${one[3] === "x" ? "y" : "x"}${one.slice(4)}`), false, "one letter wrong stays shut");
  // only as the paper has them (owner, 10-11): the signs that close them and the spaces between the pieces forgiven,
  // the case not, and the words they stand for, in any form, shut
  const bare = one.replace(/=+$/, "");
  assert.notEqual(bare, one, "the paper's words close with their signs");
  assert.equal(await opens(bare), true, "without the signs that close them");
  assert.equal(await opens(`${bare}=`), true, "with one of them");
  assert.equal(await opens(w.join(" ")), true, "the pieces typed with spaces between");
  assert.equal(await opens(one.toLowerCase()), false, "the case counts");
  const name = atob(one);
  for (const said of [name, name.toLowerCase(), name.replace(/\s+/g, ""), name.replace(/\s+/g, "").toLowerCase()]) {
    assert.equal(await opens(said), false, "what the words stand for stays shut");
  }
});

/** Every file under `dir` whose text holds one of `needles`. */
function holding(dir: string, needles: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|css|html|json)$/.test(f) && needles.some((n) => readFileSync(p, "utf8").includes(n))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

test("the words are nowhere in the app's code or its build, whole, in pieces or read out of their code (a planted copy is found)", () => {
  const w = words();
  const name = atob(w.join(""));
  const needles = [w.join(""), ...w, name, name.toLowerCase(), name.replace(/\s+/g, "")];
  assert.deepEqual(holding(join(APP, "src"), needles), []);
  assert.deepEqual(holding(dist, needles), []);
  // the control: the same search finds them once they are written down
  const planted = mkdtempSync(join(tmpdir(), "orbs-things-planted-"));
  try {
    writeFileSync(join(planted, "a.ts"), `export const x = ${JSON.stringify(w[1])};\n`);
    writeFileSync(join(planted, "b.js"), `// ${name}\n`);
    assert.equal(holding(planted, needles).length, 2);
  } finally {
    rmSync(planted, { recursive: true, force: true });
  }
});

/** The files under `root` whose path or text says one of the floor's own names (props.ts NAMES) in plain sight: its words
 * in any case, or its department and its one at the start of a word (a name made of them too). The repo's
 * own files when `root` is the repo (git's
 * list, so nothing untracked counts), every file under it otherwise; never a link or a dot folder. */
function saying(root: string): string[] {
  const exact = [NAMES.room, NAMES.home, NAMES.empty, NAMES.noBook, NAMES.hireOne, NAMES.hiring, NAMES.ask, NAMES.field, NAMES.yes, NAMES.no, NAMES.stick, NAMES.paper,
    ...Object.values(NAMES.jobs).flatMap((j) => [j.title, j.focus, j.limits])];
  const word = new RegExp(`\\b(${NAMES.dept}|${NAMES.one})`, "i");
  let files: string[] = [];
  try {
    files = root === REPO ? execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean).map((f) => join(root, f)) : [];
  } catch {
    files = [];
  }
  if (!files.length) {
    const walk = (d: string): void => {
      for (const f of readdirSync(d)) {
        if (f === "node_modules" || f.startsWith(".")) continue;
        const p = join(d, f);
        const st = lstatSync(p);
        if (st.isDirectory()) walk(p);
        else if (st.isFile()) files.push(p);
      }
    };
    walk(root);
  }
  return files.filter((p) => {
    if (word.test(p.slice(root.length))) return true;
    if (!/\.(ts|tsx|js|mjs|css|html|json|md|py|sh|txt)$/.test(p)) return false;
    let text = "";
    try {
      if (!lstatSync(p).isFile()) return false;
      text = readFileSync(p, "utf8");
    } catch {
      return false;
    }
    const lower = text.toLowerCase();
    return word.test(text) || exact.some((n) => lower.includes(n.toLowerCase()));
  });
}

// what the floor's small things open says its names only on the screen, read from the table, never in the repo's text,
// its docs, its paths or its build
test("the floor's names are nowhere in plain sight: not in the repo's code, tests, tools, docs or paths, nor in the build (a planted copy is found)", () => {
  assert.deepEqual(saying(REPO).map((p) => p.slice(REPO.length + 1)), []);
  assert.deepEqual(saying(dist), [], "the build");
  // the control: the same look finds a name as written, a word in another case, a name made of one and a path that says
  // it; and a word inside another word (a contract's function, say) is not one
  const planted = mkdtempSync(join(tmpdir(), "orbs-things-names-"));
  try {
    writeFileSync(join(planted, "a.ts"), `export const x = ${JSON.stringify(NAMES.jobs.quant.title.toLowerCase())};\n`);
    writeFileSync(join(planted, "b.md"), `# The ${NAMES.dept.toUpperCase()} rows\n`);
    mkdirSync(join(planted, `${NAMES.one}s`));
    writeFileSync(join(planted, `${NAMES.one}s`, "c.png"), "");
    writeFileSync(join(planted, "d.ts"), `const sel = "enable${NAMES.dept}()";\n`);
    writeFileSync(join(planted, "e.tsx"), `export function ${NAMES.dept}Room() {}\n`);
    assert.deepEqual(saying(planted).map((p) => p.slice(planted.length + 1)).sort(), ["a.ts", "b.md", "e.tsx", join(`${NAMES.one}s`, "c.png")]);
  } finally {
    rmSync(planted, { recursive: true, force: true });
  }
});

test("the floor's small things on a home: out of turn nothing moves; in turn each gives, kept and carried; the game opens a room of its own", { skip, timeout: 300_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-things-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("max", "Max", "ceo", { shape: "bean", eyes: "classic", hue: "honey" });
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "mint" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }, hash = "#/office"): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink().replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate((x) => (location.hash = x), hash);
    return page;
  };
  // tall enough that the whole floor and the side menu are on screen together
  const page = await open({ width: 1280, height: 1700 });
  await page.locator('[data-prop-hit="shelf"]').waitFor({ timeout: 30_000 });
  // each item's own words: not its mark, its count or how much of the paper is found
  const roomsInMenu = (p: Page = page): Promise<string[]> =>
    p.locator('nav[aria-label="Rooms"]').evaluate((nav) =>
      [...nav.querySelectorAll("button")].map((b) =>
        [...b.childNodes].filter((n) => !(n instanceof Element && (n.hasAttribute("aria-hidden") || n.hasAttribute("data-badge") || n.classList.contains("num") || n.querySelector("svg")))).map((n) => n.textContent).join("").trim()));

  // before: the department it brings is in neither the creator nor the Recruiter, and nothing is carried
  const deskShown = async (p: Page, shown: boolean): Promise<void> => {
    await p.evaluate(() => (location.hash = "#/new"));
    await p.locator("[data-editor]").waitFor();
    await p.getByRole("tab", { name: "Specialty" }).click();
    await p.locator("[data-specialty-group]").first().waitFor();
    assert.equal(await p.locator('[data-specialty-group="desk"]').count(), shown ? 1 : 0, `the creator ${shown ? "shows" : "hides"} it`);
    await p.evaluate(() => (location.hash = "#/recruiter"));
    await p.locator("[data-position-group]").first().waitFor({ timeout: 20_000 });
    assert.equal(await p.locator('[data-position-group="desk"]').count(), shown ? 1 : 0, `the Recruiter ${shown ? "shows" : "hides"} it`);
    const depts = await p.locator("[data-position-filter] option").allTextContents();
    assert.equal(depts.includes(NAMES.dept), shown);
    await p.evaluate(() => (location.hash = "#/office"));
    await p.locator('[data-prop-hit="shelf"]').waitFor();
  };
  await deskShown(page, false);
  assert.equal(await page.locator("[data-carried], [data-paper]").count(), 0);
  assert.ok(!(await roomsInMenu()).includes(NAMES.room));

  const centre = async (sel: string): Promise<{ x: number; y: number }> => {
    const b = await page.locator(sel).first().boundingBox();
    assert.ok(b, `${sel} is on screen`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 14 });
    await page.mouse.up();
  };
  const settle = (ms: number): Promise<void> => page.waitForTimeout(ms);
  const shaken = (): Promise<string[]> =>
    page.evaluate(() => [...document.querySelectorAll("[data-prop]")].filter((e) => e.classList.contains("orbs-prop-shake") || e.classList.contains("orbs-prop-nudge")).map((e) => e.getAttribute("data-prop")!));
  const calm = (): Promise<void> => page.evaluate(() => document.querySelectorAll("[data-prop]").forEach((e) => e.classList.remove("orbs-prop-shake", "orbs-prop-nudge")));
  // a press on a thing's place on the floor (its own, whoever walks in front of it)
  const press = (thing: Thing): Promise<void> => page.locator(`[data-prop-hit="${thing}"]`).dispatchEvent("click");
  const pushBin = async (): Promise<void> => {
    const b = (await page.locator('[data-prop-hit="bin"]').boundingBox())!;
    const unit = b.width / 30; // its place is 30 units of the plan wide
    await drag({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: b.x + b.width / 2 + 60 * unit, y: b.y + b.height / 2 + 10 * unit });
  };
  const kept = async (id: string): Promise<void> => {
    for (let i = 0; i < 100 && !h.about.keepsakes().includes(id); i++) await settle(100);
    assert.ok(h.about.keepsakes().includes(id), "the home keeps what was picked up");
  };
  const things: Thing[] = ["shelf", "arcade", "paper", "screen", "bin"];
  const binAt = async (): Promise<string> => {
    const b = (await page.locator('[data-prop-hit="bin"]').boundingBox())!;
    return `${Math.round(b.x)},${Math.round(b.y)}`;
  };

  for (const [n, turn] of TURNS.entries()) {
    // out of its turn, nothing answers: every other thing pressed, the bin pushed, the game pressed with nothing in hand
    await calm();
    const bin = await binAt();
    for (const other of things.filter((x) => x !== turn.on)) {
      if (other === "bin") await pushBin();
      else for (let k = 0; k < 6; k++) await press(other);
    }
    await settle(500);
    assert.deepEqual(await shaken(), [], `turn ${n}: nothing else shakes`);
    assert.equal(await page.locator("[data-dropped]").count(), 0, `turn ${n}: nothing else falls`);
    assert.equal(await binAt(), bin, `turn ${n}: the bin stays put`);
    assert.equal(await page.locator("[data-game-screen]").count(), 0);

    if (turn.k === "press") {
      for (let k = 1; k <= turn.n; k++) {
        await calm();
        await press(turn.on);
        assert.deepEqual(await shaken(), [turn.on], `turn ${n}: it shakes on press ${k}`);
        if (k < turn.n) {
          await settle(500);
          assert.equal(await page.locator("[data-dropped]").count(), 0, `turn ${n}: nothing falls before its last press`);
        }
      }
    } else if (turn.k === "move") {
      await pushBin();
      assert.equal(await page.locator('[data-prop-hit="bin"]').getAttribute("data-moved"), "true");
    }
    if (turn.k === "press" || turn.k === "move") {
      const dropped = page.locator(`[data-dropped="${turn.on}"]`);
      await dropped.waitFor({ timeout: 5_000 });
      await settle(1_000); // its fall
      await dropped.click();
      await kept(turn.drop);
      await page.locator("[data-dropped]").waitFor({ state: "detached" });
      // carried in the side menu, under Settings
      if (turn.drop === CARRIED.stick) await page.locator("[data-carried]").waitFor();
      else {
        const have = CARRIED.pieces.filter((p) => h.about.keepsakes().includes(p)).length;
        await page.locator("[data-paper]", { hasText: `${have}/3` }).waitFor();
        const items = await roomsInMenu();
        assert.ok(items.indexOf(NAMES.paper) > items.indexOf("Settings"), "under Settings");
      }
      continue;
    }

    // the game: the stick dragged from the menu onto it the first time, taken in hand and pressed on it the last
    if (turn.k === "carry") {
      await drag(await centre("[data-carried]"), await centre('[data-prop-hit="arcade"]'));
    } else {
      await page.locator("[data-carried]").click();
      await page.locator("[data-holding]").waitFor();
      await press("arcade");
    }
    const screen = page.locator("[data-game-screen]");
    await screen.waitFor({ timeout: 5_000 });
    await page.getByLabel(NAMES.field).fill("not the words");
    await page.keyboard.press("Enter");
    await page.locator('[data-said="denied"]').waitFor();
    if (turn.k === "carry") {
      await kept(turn.gives);
      await page.keyboard.press("Escape");
      await screen.waitFor({ state: "detached" });
      // put in again before the words are found, it asks again and still refuses even the right ones
      await page.locator("[data-carried]").click();
      await press("arcade");
      await screen.waitFor();
      await page.getByLabel(NAMES.field).fill(words().join(""));
      await page.keyboard.press("Enter");
      await page.locator('[data-said="denied"]').waitFor();
      await page.keyboard.press("Escape");
      continue;
    }
    // the words, read off the paper as found (nothing in this file knows them)
    await page.keyboard.press("Escape");
    await screen.waitFor({ state: "detached" });
    await page.locator("[data-paper]").click();
    await page.locator("[data-paper-view]").waitFor();
    const found = await page.locator("[data-piece][data-found='true']").allTextContents();
    assert.equal(found.length, 3);
    await page.getByRole("button", { name: "Put it away" }).click();
    // a reload: what was found is the home's, and is carried still
    await page.reload();
    await page.locator("[data-carried]").waitFor({ timeout: 30_000 });
    await page.locator("[data-paper]", { hasText: "3/3" }).waitFor();
    // a phone has them in its menu too, and the paper fits it
    const phone = await open({ width: 390, height: 844 });
    await phone.getByRole("button", { name: "Menu" }).click();
    await phone.locator("[data-carried]").waitFor();
    await phone.locator("[data-paper]").click();
    await phone.locator("[data-paper-view]").waitFor();
    await phone.waitForTimeout(400);
    assert.deepEqual((await measure(phone)).filter((f) => f.kind !== "contrast"), [], "the paper fits a phone");
    await phone.keyboard.press("Escape");
    // the game, with the words
    await page.locator('[data-prop-hit="shelf"]').waitFor();
    await drag(await centre("[data-carried]"), await centre('[data-prop-hit="arcade"]'));
    await screen.waitFor();
    await page.getByLabel(NAMES.field).fill(found.join(""));
    await page.keyboard.press("Enter");
    await page.locator('[data-said="granted"]').waitFor();
    await kept(turn.gives);
    await page.waitForFunction(() => location.hash === "#/desk", null, { timeout: 10_000 });
    await page.locator("[data-desk-room]").waitFor();
  }

  // open: its own room, under the office; the stick and the paper put away; the department in the creator and Recruiter
  const items = await roomsInMenu();
  assert.equal(items[items.indexOf("The office") + 1], NAMES.room);
  assert.equal(await page.locator("[data-carried], [data-paper]").count(), 0);
  await deskShown(page, true);
  // and on another device, from the home
  const other = await open({ width: 1280, height: 900 }, "#/desk");
  await other.locator("[data-desk-room]").waitFor({ timeout: 30_000 });
  assert.ok((await roomsInMenu(other)).includes(NAMES.room));
});
