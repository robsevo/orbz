// PLAN 2.2_t, the creator's choices (owner, 10-01):
//   - "same amount of orbs and accessories per tab, with page numbers. 3 per row": every picture
//     tab is three across and nine to a page; a short last page is filled with empty slots the
//     size of a choice; the page numbers sit under it, and every page keeps the layout rule.
//   - A roll of the dice that lands on another page turns to it.
//   - "change the colors of our accessories": a hat's colour and the frames' colour, chosen like
//     his own; "Its own" puts them back; the card says it, and the office keeps it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { choose, findChrome, launch, measure, plainNewOrb, serveDir, SIZES } from "./harness.ts";
import { EYES, FINISHES, GLASSES, HAT_CHOICES, SHAPES } from "../src/orb/spec.ts";
import { readStrand } from "../src/orb/strand.ts";
import { PER_PAGE } from "../src/ui/pages.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-creator-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(size: keyof typeof SIZES): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZES[size], colorScheme: "dark" });
  await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
  await page.waitForSelector("canvas", { state: "attached", timeout: 90_000 }); // a busy gate draws slowly
  return page;
}

const TABS: [tab: string, paged: string, n: number][] = [
  ["Shape", "Shapes", Object.keys(SHAPES).length],
  ["Eyes", "Eyes", Object.keys(EYES).length],
  ["Hat", "Hats", HAT_CHOICES.length],
  ["Glasses", "Glasses", Object.keys(GLASSES).length],
];

test("control: some picture tab has more than one page", () => {
  assert.ok(TABS.some(([, , n]) => n > PER_PAGE));
});

// one page per size, dressed plainly once, each tab its own test (all of them in one ran past a
// test's minute in the gate, where every suite draws at once)
const sized = new Map<keyof typeof SIZES, Promise<Page>>();
const plainAt = (size: keyof typeof SIZES): Promise<Page> => {
  let p = sized.get(size);
  if (!p) {
    p = open(size).then(async (page) => {
      await plainNewOrb(page);
      return page;
    });
    sized.set(size, p);
  }
  return p;
};
after(async () => {
  for (const p of sized.values()) await (await p).close().catch(() => {}); // the browser may be gone first
});

for (const size of ["desk", "phone"] as const) {
  for (const [tab, label, n] of TABS) {
    test(`the ${label.toLowerCase()}, at ${size} size: three across, nine to a page, numbered, a short page filled`, { skip }, async () => {
      const page = await plainAt(size);
      await page.getByRole("tab", { name: tab }).click();
      const paged = page.locator(`[data-paged="${label}"]`);
      await paged.waitFor();
      const pages = Math.ceil(n / PER_PAGE);
      assert.equal(await paged.getByRole("button", { name: /^Page \d+$/ }).count(), pages > 1 ? pages : 0, `${label}: a number for each page`);
      if (pages > 1) await paged.getByRole("button", { name: "Page 1", exact: true }).click();
      for (let p = 1; p <= pages; p++) {
        if (p > 1) await paged.getByRole("button", { name: "Next page" }).click();
        const shown = paged.locator("[data-page]:not([hidden])");
        assert.equal(await shown.getAttribute("data-page"), String(p), `${label}: page ${p} is the one shown`);
        assert.equal(await shown.locator("button[data-pick]").count(), Math.min(PER_PAGE, n - (p - 1) * PER_PAGE), `${label} page ${p}: its choices`);
        const findings = await measure(page); // which waits for a choice's bounce to settle, too
        const boxes = await shown.evaluate((el) => [...el.children].map((c) => {
          const r = c.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), empty: c.hasAttribute("data-empty") };
        }));
        assert.equal(boxes.length, PER_PAGE, `${label} page ${p}: nine slots, the empty ones too`);
        assert.equal(new Set(boxes.map((b) => b.x)).size, 3, `${label} page ${p}: three across`);
        assert.equal(new Set(boxes.map((b) => b.y)).size, 3, `${label} page ${p}: three rows`);
        const [w, h] = [boxes[0]!.w, boxes[0]!.h];
        assert.ok(boxes.every((b) => Math.abs(b.w - w) <= 1 && Math.abs(b.h - h) <= 1), `${label} page ${p}: an empty slot is the size of a choice`);
        if (p < pages) assert.ok(!boxes.some((b) => b.empty), `${label}: only the last page has empty slots`);
        assert.deepEqual(findings, [], `${label} page ${p}: the layout rule`);
      }
    });
  }
}

// the finishes are small and all in view under the colours (owner, 10-10: "organize the sections much better and make them
// more compact and viewable"), where they were a page of nine big tiles
for (const size of ["desk", "phone"] as const) {
  // two rows at most on a desk; a phone's are three across, still small, a finger's size each
  test(`the finishes, at ${size} size: all ${Object.keys(FINISHES).length} at once in ${size === "desk" ? "two" : "three"} rows at most, no page numbers, the layout rule`, { skip }, async () => {
    const page = await plainAt(size);
    await page.getByRole("tab", { name: "Colour" }).click();
    const box = page.locator("[data-finishes]");
    await box.waitFor();
    const picks = box.locator("button[data-pick]");
    assert.equal(await picks.count(), Object.keys(FINISHES).length, "every finish");
    assert.equal(await box.getByRole("button", { name: /^Page \d+$/ }).count(), 0, "no pages");
    const findings = await measure(page); // which waits for the chosen one's bounce to settle, too
    // rows by where each starts, a row a new top more than half a choice below the last (not a pixel's rounding)
    const rows = await picks.evaluateAll((bs) => {
      const tops = bs.map((b) => b.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      return tops.filter((r, i) => i === 0 || r.top - tops[i - 1]!.top > r.height / 2).length;
    });
    assert.ok(rows <= (size === "desk" ? 2 : 3), `${rows} rows of finishes`);
    assert.ok((await box.boundingBox())!.height < 300, `the finishes stand ${(await box.boundingBox())!.height} px tall (a page of nine big tiles stood over 400)`);
    assert.deepEqual(findings, [], "the layout rule");
  });
}

// owner, 10-10: "we also dont see our orb as were changing colors ... make sure DNA strand is close and next to
// horizontally but not in same container, so we see the switch in dna as we change the colors". Scrolled to the
// gradient's colours, the orb and its DNA are in view (on a desk the orb's card and the DNA's beside the editor; on a
// phone, small, at the editor's head), and the DNA changes as a colour is chosen.
for (const size of ["desk", "phone"] as const) {
  test(`at ${size} size the orb and its DNA stay in view while its colours are chosen, and the DNA changes with them`, { skip }, async () => {
    const page = await plainAt(size);
    await page.getByRole("tab", { name: "Colour" }).click();
    await page.getByRole("button", { name: "then coral" }).evaluate((b) => b.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const vh = page.viewportSize()!.height;
    const seen = async (sel: string): Promise<boolean> => {
      const b = await page.locator(sel).first().boundingBox();
      return b !== null && b.y >= -1 && b.y + b.height <= vh + 1;
    };
    const orb = size === "desk" ? "[data-cradle] canvas" : "[data-peek] canvas";
    const dna = size === "desk" ? "[data-strand-card] [data-dna]" : "[data-peek-dna]";
    assert.ok(await seen(orb), "the orb in view");
    assert.ok(await seen(dna), "its DNA in view");
    if (size === "desk") {
      const card = (await page.locator("[data-strand-card]").boundingBox())!, editor = (await page.locator("[data-editor]").boundingBox())!;
      assert.ok(card.x + card.width <= editor.x, "the DNA's own card beside the editor, not in it");
    } else assert.ok(!(await seen("[data-cradle] canvas")), "control: on a phone the big orb has scrolled away, the small one is what is seen");
    const before = await page.locator(dna).first().innerText();
    await page.getByRole("button", { name: "then coral" }).click();
    let after = before;
    for (let i = 0; i < 40 && after === before; i++) {
      await page.waitForTimeout(50);
      after = await page.locator(dna).first().innerText();
    }
    assert.notEqual(after, before, "the DNA changes with the colour");
    await page.getByRole("button", { name: "No gradient" }).click(); // as plain as it was, for the tests after
  });
}

// owner, 10-10: "how about we give the same flavour to the new orb section as we did for the orbs profile". The orb and
// who it will be in one card (its name typed there), Roll and Create under the orb where Chat and Career are on an orb's
// page, its moods compact and immediately above its DNA, its stats in two cards; the card, the moods and the DNA within
// a desk's height (the test above holds them in view as the editor scrolls)
for (const size of ["desk", "phone"] as const) {
  test(`a new orb's page is laid out as an orb's own page, at ${size} size`, { skip }, async () => {
    const page = await plainAt(size);
    const hero = page.locator("[data-maker-hero]");
    assert.equal(await hero.getByRole("textbox", { name: "Name" }).count(), 1, "its name in the orb's own card");
    const [card, canvas, roll, create, moves, dna] = await Promise.all([
      hero.boundingBox(), hero.locator("canvas").first().boundingBox(), hero.getByRole("button", { name: "Roll everything" }).boundingBox(),
      hero.getByRole("button", { name: /^Create / }).boundingBox(), page.locator("[data-moves]").boundingBox(), page.locator("[data-strand-card]").boundingBox(),
    ]);
    assert.ok(card && canvas && roll && create && moves && dna);
    assert.ok(roll.y >= canvas.y + canvas.height - 1 && create.y >= canvas.y + canvas.height - 1, "Roll and Create under the orb");
    if (size === "phone") {
      // under its title and level, over what it does, and a little smaller (owner, 10-10: "put roll everything button and
      // create "orbname" buttons right in between the description of the orb and "starts as the senior: your first" ...
      // make the rectangles and font a bit smaller too")
      const [title, bio] = await Promise.all([hero.locator("[data-title]").boundingBox(), hero.locator("[data-bio]").boundingBox()]);
      assert.ok(title && bio && roll.y >= title.y + title.height - 1 && roll.y + roll.height <= bio.y + 1, "Roll and Create under its level, over what it does");
      assert.ok(roll.height <= 32 && create.height <= 32, `smaller (${Math.round(roll.height)} and ${Math.round(create.height)} px)`);
    }
    assert.ok(card.y + card.height <= moves.y + 1 && moves.y + moves.height <= dna.y + 1, "the orb's card, its moods, then its DNA");
    assert.deepEqual([await page.locator("[data-sheet-body]").count(), await page.locator("[data-sheet-skills]").count()], [1, 1], "its stats in two cards");
    if (size === "desk") assert.ok(dna.y + dna.height <= page.viewportSize()!.height, `the card, the moods and the DNA in a desk's height (the DNA ends at ${Math.round(dna.y + dna.height)})`);
    assert.deepEqual(await measure(page), [], "the layout rule");
  });
}

test("a covering hat keeps ears inside, with no ears choice; the deerstalker is not offered", { skip }, async () => {
  const page = await plainAt("desk");
  await page.getByRole("tab", { name: "Shape" }).click();
  await choose(page, "kitty");
  await page.getByRole("tab", { name: "Hat" }).click();
  await choose(page, "beanie");
  assert.equal(await page.locator("[data-ears-pick]").count(), 0, "no choice can put the ears through it");
  assert.equal(await page.getByRole("button", { name: "Deerstalker", exact: true }).count(), 0, "the retired hat is absent");
  assert.deepEqual(await measure(page), [], "the Hat tab still keeps the layout rule");
});

test("a roll of the dice that lands on another page turns to it", { skip }, async () => {
  // shapes: a roll changes no thumbnail (each shows its own shape), so nothing is redrawn and the
  // test stays quick in the gate (a hat's roll can change its colour, and every thumbnail with it)
  const page = await plainAt("desk");
  await page.getByRole("tab", { name: "Shape" }).click();
  const pagesSeen = new Set<string>();
  for (let i = 0; i < 12; i++) { // 12 rolls of 19 shapes on 3 pages all land on one about once in 4,000
    await page.getByRole("button", { name: "Roll shape", exact: true }).click();
    const on = page.locator('[data-paged="Shapes"] button[data-pick][aria-pressed="true"]');
    assert.ok(await on.isVisible(), `roll ${i}: the shape he got is on the page shown`);
    pagesSeen.add((await on.evaluate((b) => b.closest("[data-page]")!.getAttribute("data-page")))!);
  }
  assert.ok(pagesSeen.size > 1, `control: the rolls landed on more than one page (${[...pagesSeen]})`);
  // the last to use the two kept pages: closed now, so their thumbnails stop drawing beside the tests after (a busy
  // gate let a new page's first canvas wait past 30 s while they drew, 10-07)
  for (const p of sized.values()) await (await p).close().catch(() => {});
  sized.clear();
});

/** The mean colour of a band of a thumbnail's body, from y0 to y1 of its height: where a hat sits, or his glasses. */
function meanOf(page: Page, pick: string, y0: number, y1: number): Promise<[number, number, number]> {
  return page.evaluate(({ pick, y0, y1 }) => {
    const c = document.querySelector<HTMLButtonElement>(`button[data-pick="${pick}"]`)!.querySelector("canvas")!;
    const d = c.getContext("2d")!.getImageData(0, Math.round(c.height * y0), c.width, Math.max(1, Math.round(c.height * (y1 - y0)))).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 200) continue;
      r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++;
    }
    return [r / n / 255, g / n / 255, b / n / 255] as [number, number, number];
  }, { pick, y0, y1 });
}
/** Where a beanie is in its thumbnail: since 10-09 a hat is a model sized for his head (owner: "even the party hat is
 * huge"), so it sits lower and smaller than the flat ones did in the frame's top third. Its knit, its cuff, its pompom. */
const HAT_BAND = [0.3, 0.45] as const;
const apart = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + Math.abs(x - b[i]!), 0);

// in two steps on one page (each colour pressed redraws every thumbnail on the tab, slow in software
// WebGL: as one test it ran past a test's minute in the gate)
let dressing: Promise<Page> | null = null;
after(async () => {
  if (dressing) await (await dressing).close().catch(() => {});
});

test("a hat in any colour, like his own: it paints the hat, and Its own puts its colour back", { skip }, async () => {
  const page = await (dressing ??= open("desk").then(async (p) => {
    await plainNewOrb(p);
    return p;
  }));
  await page.getByRole("tab", { name: "Hat" }).click();
  await choose(page, "beanie");
  const hatBefore = await meanOf(page, "beanie", ...HAT_BAND);
  await page.getByRole("button", { name: "hat in coral" }).click();
  await page.waitForTimeout(250);
  const hatCoral = await meanOf(page, "beanie", ...HAT_BAND);
  assert.ok(apart(hatBefore, hatCoral) > 0.08, `the beanie turns coral (${apart(hatBefore, hatCoral).toFixed(3)})`);
  await page.getByRole("button", { name: "Its own" }).click();
  await page.waitForTimeout(250);
  assert.ok(apart(hatBefore, await meanOf(page, "beanie", ...HAT_BAND)) < 0.01, "Its own puts its colour back");
  // white and black too (owner, 10-03: "option to put accesories white or black also")
  const light = (c: number[]): number => (c[0]! + c[1]! + c[2]!) / 3;
  await page.getByRole("button", { name: "hat in white" }).click();
  await page.waitForTimeout(250);
  const white = await meanOf(page, "beanie", ...HAT_BAND);
  await page.getByRole("button", { name: "hat in black" }).click();
  await page.waitForTimeout(250);
  const black = await meanOf(page, "beanie", ...HAT_BAND);
  assert.ok(light(white) - light(black) > 0.15, `a white beanie is light and a black one dark (${light(white).toFixed(2)} against ${light(black).toFixed(2)})`);
  await page.getByRole("button", { name: "Its own" }).click();
  await page.waitForTimeout(250);
});

test("frames in any colour too; the card says both, and the office keeps them", { skip }, async () => {
  assert.ok(dressing, "after the hat");
  const page = await dressing;
  await page.getByRole("button", { name: "hat in coral" }).click();
  await page.getByRole("tab", { name: "Glasses" }).click();
  await choose(page, "none");
  assert.equal(await page.getByText("Frame colour").count(), 0, "no glasses, no frames to colour");
  await choose(page, "round");
  const eyesBefore = await meanOf(page, "round", 0.3, 0.55);
  await page.getByRole("button", { name: "frame in honey" }).click();
  await page.waitForTimeout(250);
  assert.ok(apart(eyesBefore, await meanOf(page, "round", 0.3, 0.55)) > 0.02, "the frames turn honey");

  await page.getByRole("textbox", { name: "Name" }).fill("Pip");
  await page.getByRole("button", { name: "Create Pip" }).click();
  await page.getByRole("heading", { name: "Pip" }).waitFor();
  const card = await page.locator("main").innerText();
  assert.match(card, /Beanie, coral/);
  assert.match(card, /Round, honey frames/);
  await page.reload();
  await page.getByRole("heading", { name: "Pip" }).waitFor();
  assert.match(await page.locator("main").innerText(), /Beanie, coral[\s\S]*Round, honey frames/, "the office keeps it");
});

// four minutes: it makes two orbs and measures every element at two sizes, three times; in the gate, beside
// three other suites drawing in software, that ran past two (10-04)
test("the first of his kind starts as the Senior, the next of that kind a Junior (owner, 10-02); it fits at both sizes", { skip, timeout: 240_000 }, async () => {
  const page = await open("desk");
  const pick = async (title: string): Promise<void> => {
    await page.getByRole("tab", { name: "Specialty" }).click();
    await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  };
  // the first orb is your CEO, the next your assistant (owner, 10-07): each the first, so the Senior of its kind
  await page.getByText("Starts as the Senior: your first Chief Executive Officer", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Name" }).fill("Maya");
  await page.getByRole("button", { name: "Create Maya" }).click();
  await page.getByRole("heading", { name: "Maya" }).waitFor();
  await page.getByRole("button", { name: "New orb" }).first().click({ timeout: 90_000 }); // a busy gate draws slowly
  await page.getByText("Starts as the Senior: your first Personal Assistant", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Name" }).fill("Pip");
  await page.getByRole("button", { name: "Create Pip" }).click();
  await page.getByRole("heading", { name: "Pip" }).waitFor();
  assert.match(await page.locator("main").innerText(), /Senior · 0 XP/, "and his card says so");
  // a second assistant: a Junior (Life is open, its head your assistant)
  await page.getByRole("button", { name: "New orb" }).first().click({ timeout: 90_000 }); // a busy gate draws slowly
  await pick("Personal Assistant");
  await page.getByText("Starts as a Junior", { exact: true }).waitFor();
  assert.deepEqual(await measure(page), [], "nothing spills at desk size");
  await page.setViewportSize(SIZES.phone);
  assert.deepEqual(await measure(page), [], "nor at phone size");
  await pick("Travel Planner");
  await page.getByText("Starts as the Senior: your first Travel Planner", { exact: true }).waitFor();
  assert.deepEqual(await measure(page), [], "the Senior's line fits a phone too");
  await page.close();
});

// twenty-odd rolls, each redrawing every thumbnail in software WebGL: 181 s with the hats as models, about 7% more with
// the glasses too (10-09, measured over six rolls); its own budget, so a slow gate does not cut it off
test("your first orb is your CEO, the next your assistant: every roll is that one, and only it is offered; then what is open (owner, 10-07)", { skip, timeout: 360_000 }, async () => {
  const page = await open("desk"); // nothing in the office yet: the creator is on the first orb
  try {
    // its title, on its card under the orb (10-10: the orb's caption no longer repeats it)
    const said = () => page.locator("[data-sheet-head] [data-title]").innerText();
    const rolls = async (want: RegExp, what: string): Promise<void> => {
      for (let i = 0; i < 5; i++) {
        await page.getByRole("button", { name: /Roll everything/ }).click();
        await page.waitForTimeout(120);
        assert.match(await said(), want, `${what}, roll ${i}: ${await said()}`);
      }
    };
    await rolls(/Chief Executive Officer/, "your CEO first");
    await page.getByRole("tab", { name: "Specialty" }).click();
    assert.equal(await page.locator('[data-founding="ceo"] button').count(), 1, "only the CEO is offered");
    await page.getByRole("button", { name: "Roll specialty" }).click();
    assert.match(await said(), /Chief Executive Officer/, "its own die too");
    await page.getByRole("textbox", { name: "Name" }).fill("Maya");
    await page.getByRole("button", { name: "Create Maya" }).click();
    await page.getByRole("heading", { name: "Maya" }).waitFor();
    // then your personal assistant
    await page.getByRole("button", { name: "New orb" }).first().click();
    await rolls(/Personal Assistant/, "then your assistant");
    await page.getByRole("tab", { name: "Specialty" }).click();
    assert.equal(await page.locator('[data-founding="assistant"] button').count(), 1, "only the assistant is offered");
    await page.getByRole("textbox", { name: "Name" }).fill("Bea");
    await page.getByRole("button", { name: "Create Bea" }).click();
    await page.getByRole("heading", { name: "Bea" }).waitFor();
    // then the Executive and every department with its head: Build is shut without a CTO, Life open with the assistant
    await page.getByRole("button", { name: "New orb" }).first().click();
    await page.getByRole("tab", { name: "Specialty" }).click();
    assert.equal(await page.locator("[data-founding]").count(), 0, "control: no longer only one");
    assert.match(await page.locator('[data-locked="build"]').innerText(), /Hire a CTO to open Build/);
    assert.equal(await page.locator('[data-specialty-group="exec"] button').count(), 6, "the Executive, every head");
    assert.ok(await page.locator('[data-specialty-group="life"] button').count() > 1, "and Life");
    const titles = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await page.getByRole("button", { name: /Roll everything/ }).click();
      await page.waitForTimeout(120);
      titles.add(await said());
    }
    for (const t of titles) assert.doesNotMatch(t, /Frontend Builder|Backend Engineer|Designer|Accountant|Sales Lead/, `the dice keep to what is open: ${t}`);
  } finally {
    await page.close();
  }
});

test("before your CEO and your assistant, the Recruiter is greyed out and its address will not open it; after, it opens (owner, 10-07)", { skip, timeout: 240_000 }, async () => {
  const page = await open("desk"); // nothing in the office yet
  try {
    const rec = page.locator("aside").getByRole("button", { name: "Recruiter" });
    assert.equal(await rec.isDisabled(), true, "greyed out, not pressable");
    assert.equal(await rec.getAttribute("title"), "Appoint your CEO first");
    await page.evaluate(() => (location.hash = "#/recruiter"));
    await page.waitForTimeout(400);
    assert.equal(await page.locator("[data-recruiter]").count(), 0, "its address does not open it");
    assert.ok(await page.getByRole("button", { name: /Roll everything/ }).isVisible(), "it opens the making of your CEO");
    await page.getByRole("textbox", { name: "Name" }).fill("Maya");
    await page.getByRole("button", { name: "Create Maya" }).click();
    await page.getByRole("heading", { name: "Maya" }).waitFor();
    assert.equal(await rec.getAttribute("title"), "Appoint your personal assistant first", "still shut: the assistant next");
    await page.getByRole("button", { name: "New orb" }).first().click();
    await page.getByRole("textbox", { name: "Name" }).fill("Bea");
    await page.getByRole("button", { name: "Create Bea" }).click();
    await page.getByRole("heading", { name: "Bea" }).waitFor();
    assert.equal(await rec.isDisabled(), false, "control: with the two, it opens");
    await rec.click();
    await page.getByText("The recruiter is the home's", { exact: false }).or(page.locator("[data-recruiter]")).first().waitFor({ timeout: 20_000 });
  } finally {
    await page.close();
  }
});

// any colour (PLAN 2.20; owner, 10-08: "a bit more colors for our orbs and accessories. DNA should go with hex if possible.
// a lot more possibilities. and also a black version, but call it dark lol")
test("any colour: Dark and a typed colour reach the orb and its DNA strand, a slider turns it, a hat takes one too; the picker fits at both sizes", { skip, timeout: 150_000 }, async () => {
  const page = await open("desk");
  await plainNewOrb(page);
  await page.getByRole("tab", { name: "Colour" }).click();
  const light = (c: number[]): number => (c[0]! + c[1]! + c[2]!) / 3;
  const dna = async (): Promise<string> => (await page.locator("[data-dna]").first().innerText()).trim();
  const body = (): Promise<[number, number, number]> => meanOf(page, "glass", 0.4, 0.85);
  const azure = await body();
  assert.match(await dna(), /^1/, "control: an orb of the 24 keeps the first-version strand");
  // Dark: black glass, and the strand's second version
  await page.locator("[data-colour-dark]").click();
  await page.waitForTimeout(300);
  const dark = await body();
  assert.ok(light(dark) < light(azure) - 0.15, `Dark is dark glass (${light(dark).toFixed(2)} against ${light(azure).toFixed(2)})`);
  assert.match(await dna(), /^2/);
  // any colour, typed
  await page.locator('[data-colour-any="orb"]').click();
  const field = page.getByRole("textbox", { name: "The orb's colour, as hex" });
  await field.fill("#e8304a");
  await page.waitForTimeout(300);
  const red = await body();
  assert.ok(red[0] > red[2] + 0.08, `a red orb is red (${red.map((v) => v.toFixed(2)).join(", ")})`);
  assert.equal(await page.locator('[data-colour-any="orb"]').getAttribute("aria-pressed"), "true");
  assert.match(await page.locator('[data-colour-any="orb"]').innerText(), /E8304A/);
  const typed = readStrand(await dna());
  assert.ok(typed.ok && typed.orb.tint === "#e8304a", "its strand carries the colour");
  // a slider turns it
  await page.locator('[data-colour-slider="hue"]').fill("150");
  await page.waitForTimeout(300);
  const green = await body();
  assert.ok(green[1] > green[0], `the hue slider turns it green (${green.map((v) => v.toFixed(2)).join(", ")})`);
  const slid = await dna();
  // control: what is not a colour is not taken
  await field.fill("#zz1234");
  await page.waitForTimeout(200);
  assert.equal(await dna(), slid, "a broken hex changes nothing");
  // one of the 24 again: the first version again
  await page.getByRole("button", { name: "coral", exact: true }).click();
  await page.waitForTimeout(200);
  assert.match(await dna(), /^1/);
  assert.equal(await page.locator('[data-colour-any="orb"]').getAttribute("aria-pressed"), "false");
  // a hat in any colour
  await page.getByRole("tab", { name: "Hat" }).click();
  await choose(page, "beanie");
  const own = await meanOf(page, "beanie", ...HAT_BAND);
  await page.locator('[data-colour-any="hat"]').click();
  await page.getByRole("textbox", { name: "The hat's colour, as hex" }).fill("#20e070");
  await page.waitForTimeout(300);
  const hat = await meanOf(page, "beanie", ...HAT_BAND);
  assert.ok(apart(own, hat) > 0.08 && hat[1] > hat[0], `the beanie turns that green (${hat.map((v) => v.toFixed(2)).join(", ")})`);
  assert.match(await dna(), /^2/);
  await page.waitForTimeout(300);
  assert.deepEqual(await measure(page), [], "the hat's picker open, at desk size");
  // a strand pasted makes that orb, without the colours chosen before it: Basil's (the 10-08 strand, no colour of its own)
  // over this green beanie is Basil's strand again, not a second-version one with the green still on
  const basil = "12BW-JRVY-RAG9-BQT1-RNC9-Z";
  await page.getByRole("textbox", { name: "DNA strand" }).fill(basil);
  await page.getByRole("button", { name: "Make it" }).click();
  await page.waitForFunction((want) => document.querySelector("[data-dna]")?.textContent?.trim() === want, basil, { timeout: 10_000 }).catch(() => {});
  assert.equal(await dna(), basil, "the pasted strand, made again whole");
  await page.close();
  // a phone: the picker open fits, its hex field big enough that an iPhone does not zoom into it
  const phone = await open("phone");
  await plainNewOrb(phone);
  await phone.getByRole("tab", { name: "Colour" }).click();
  await phone.locator('[data-colour-any="orb"]').click();
  const hexField = phone.getByRole("textbox", { name: "The orb's colour, as hex" });
  await hexField.fill("#3060ff");
  await phone.waitForTimeout(300);
  assert.ok(Number.parseFloat(await hexField.evaluate((el) => getComputedStyle(el).fontSize)) >= 16, "16 px or more");
  assert.deepEqual(await measure(phone), [], "the picker open, at phone size");
  await phone.close();
});
