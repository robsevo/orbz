// The office floor on a real home, with a scripted brain (owner, 10-05: "the office should be a whole office
// visual of them working in an office ... they sit at their desks"; "when we press on the orb it goes to
// their profile w stats and all"):
//   - the office opens on the floor, every orb on it, nothing spilling at desk and phone sizes;
//   - an orb whose run is going walks to its own desk, in its department, and sits there; what it says
//     shows over it as it says it, and the dashboard says it is working;
//   - an orb in a Brainstorm walks to the meeting table, and the meeting room's screen names the session;
//   - pressing an orb opens its profile;
//   - the bottom rooms (owner, 10-08: "Gym, Classroom, Library and Interview room, plus the hallway fix"): the night's
//     gym in the gym, today's applicants waiting in the interview room (its sign counts them, a press opens the
//     Recruiter), an orb at school in the classroom; the hallways rugs, not roads; desk and phone.
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
import { serve } from "../../home/src/api.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";
import { VIEWS, viewRect } from "../src/floor/plan.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-floor-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

/** Waits until the orb on the floor is headed somewhere matching `at`, and is there (`there: false`, only headed: a
 * long walk under the gate's load, its software-drawn frames slow, can take longer than the test cares to wait). */
async function arrives(page: Page, name: string, at: RegExp, o: { there?: boolean; timeout?: number } = {}): Promise<string> {
  const handle = await page.waitForFunction(
    ({ name, at, there }) => {
      const b = document.querySelector(`[data-floor-orb="${name}"]`);
      const where = b?.getAttribute("data-at") ?? "";
      return new RegExp(at).test(where) && (!there || b?.getAttribute("data-arrived") === "true") ? where : null;
    },
    { name, at: at.source, there: o.there ?? true },
    { timeout: o.timeout ?? 60_000 },
  );
  return String(await handle.jsonValue());
}

test("the office is the floor: an orb at work at its desk, a board vote at the Board room's table (not a session), an orb pressed opens its profile", { skip, timeout: 240_000 }, async (t) => {
  let releaseGus!: () => void;
  let releaseAda!: () => void;
  const gusHeld = new Promise<void>((r) => (releaseGus = r));
  const adaHeld = new Promise<void>((r) => (releaseAda = r));
  const model = await fakeModel(t, [
    { chunks: ["On it: ", "checking the build now."], hold: gusHeld }, // Gus, in his chat, held open while we look
    { chunks: ["A launch party, ", "with demos."], hold: adaHeld }, // Ada, in the Brainstorm
  ]);
  const data = mkdtempSync(join(tmpdir(), "orbs-floor-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    agent: { passWaitMs: 20 },
  });
  t.after(() => {
    releaseGus();
    releaseAda();
    h.close();
  });
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "mint" });
  h.inbox.addOrb("gus", "Gus", "devops", { shape: "bean", eyes: "classic", hue: "cornflower" });
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "amber" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate(() => (location.hash = "#/office"));
    await page.locator("[data-floor] [data-floor-orb]").first().waitFor({ timeout: 30_000 });
    return page;
  };
  const page = await open({ width: 1280, height: 900 });
  assert.deepEqual((await page.locator("[data-floor-orb]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-floor-orb")))).sort(), ["Ada", "Gus", "Pip"], "every orb on the floor");
  await page.waitForTimeout(600);
  assert.deepEqual(await measure(page), [], "the floor, at desk size");

  // Gus's run goes on: he walks to his own desk, in Build, and sits there
  h.inbox.send("gus", "chat:gus", "is the build green?");
  const gusAt = await arrives(page, "Gus", /^desk:build\d$/);
  assert.match(gusAt, /^desk:build/, "his own desk, in his department");
  await page.locator('[data-floor] [data-speech]').filter({ hasText: "checking the build" }).waitFor({ timeout: 20_000 });
  assert.match(await page.locator('[data-stat="Working"]').innerText(), /^1\s*Working/, "the dashboard counts him working");
  assert.match(await page.locator('[data-who="Gus"]').innerText(), /Gus\s+(Thinking|Working)/);

  // a board vote (owner, 10-07: "Add a Board room ... replace the meeting room"): its members walk to the Board room's
  // table, and the screen says what it is
  assert.match(await page.locator("[data-floor]").innerText(), /Board room/i); // its sign is set in capitals
  assert.doesNotMatch(await page.locator("[data-floor]").innerText(), /Meeting room/);
  h.events.append("board.proposed", { text: "Open Finance this month", by: "founder", members: ["ada", "pip"] });
  await arrives(page, "Ada", /^meeting:\d$/);
  await page.locator("[data-meeting-screen]").filter({ hasText: "Now: A board vote" }).waitFor({ timeout: 20_000 });
  assert.match(await page.locator('[data-stat="In a meeting"]').innerText(), /^2/, "its two members");
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "the floor at work, at desk size");
  // decided: back to work; and a session's Brainstorm meets in Sessions, not at the table (control)
  h.events.append("board.decided", { proposal: 0, carried: true, yes: 2, no: 0, abstained: 0 });
  const s = h.team.create("Plan the launch", { brainstorm: ["ada"] });
  h.team.say(s.id, "brainstorm", "ideas for the launch?");
  await arrives(page, "Ada", /^desk:/);

  // and on a phone: the same floor, nothing spilling
  const phone = await open({ width: 390, height: 844 });
  await phone.waitForTimeout(600);
  assert.deepEqual(await measure(phone), [], "the floor, at phone size");

  // pressing an orb opens its profile. Pressed where it stands the moment it arrives: under the gate's
  // load it could set off again before Playwright saw two still frames, and a click that waits for a still
  // target then never came (10-06, twice); a press that misses a walking orb is tried again
  const floorAt = await page.evaluate(() => location.hash);
  for (let i = 0; ; i++) {
    await arrives(page, "Pip", /./);
    await page.locator('[data-floor-orb="Pip"]').click({ force: true, timeout: 5_000 }).catch(() => {});
    const opened = await page.waitForFunction(() => location.hash === "#/office/Pip", undefined, { timeout: 2_000 }).then(() => true, () => false);
    if (opened) break;
    assert.ok(i < 10, "Pip opened on a press");
    // a press that missed may have opened something else on the floor: back to the floor
    if ((await page.evaluate(() => location.hash)) !== floorAt) {
      await page.evaluate((h) => (location.hash = h || "#/office"), floorAt);
      await page.locator("[data-floor]").waitFor({ timeout: 10_000 });
    }
  }
  await page.locator(".orbs-sheet").filter({ hasText: "Pip" }).waitFor({ timeout: 10_000 });
  // who it is in its own card, its stats in another (owner, 10-10: "put that part with the dna strand to the left")
  assert.match(await page.locator(".orbs-sheet").innerText(), /Pip[\s\S]*Personal Assistant/i, "its profile");
  assert.match(await page.locator("[data-sheet-body]").innerText(), /Traits/i, "its stats and all");
  // and The office goes back to the floor
  await page.getByRole("button", { name: "The office", exact: true }).click();
  await page.locator("[data-floor]").waitFor({ timeout: 10_000 });

  releaseGus();
  releaseAda();
});

test("on a phone the office goes room by room: it opens on the busiest department, a chip takes it to any room, the choice is kept; a desk shows it whole", { skip, timeout: 200_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-floor-rooms-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  // two in Build, one in Life: Build is the busiest
  h.inbox.addOrb("gus", "Gus", "devops", { shape: "bean", eyes: "classic", hue: "cornflower" });
  h.inbox.addOrb("tad", "Tad", "frontend", { shape: "bean", eyes: "classic", hue: "violet" });
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "mint" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, isMobile: true });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/office")); // the app opens on the home page (10-07)
  await page.locator("[data-floor-plan]").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const at = () => page.evaluate(() => {
    const v = document.querySelector<HTMLElement>("[data-floor-view]")!;
    const plan = document.querySelector<HTMLElement>("[data-floor-plan]")!;
    return { room: v.getAttribute("data-viewport"), left: v.scrollLeft, top: v.scrollTop, k: plan.clientWidth / 1200, w: v.clientWidth, h: v.clientHeight };
  });
  await page.locator('[data-view-choice="build"][aria-pressed="true"]').waitFor();
  let a = await at();
  // Build is { x: 12, y: 352, w: 360, h: 196 }, shown with floor round it (owner, 10-07: "a little too zoomed in on
  // the rooms"): 50 to each side, the window moved in at the floor's left edge, 30 above and below, 18 more for the names
  const onBuild = viewRect("build")!;
  assert.deepEqual(onBuild, { x: 0, y: 304, w: 460, h: 274 });
  assert.equal(a.room, "room");
  assert.ok(Math.abs(a.left - onBuild.x * a.k) <= 1 && Math.abs(a.top - onBuild.y * a.k) <= 1, `the window on Build (${JSON.stringify(a)})`);
  assert.ok(Math.abs(onBuild.w * a.k - a.w) <= 1, "the window the width of the screen");
  assert.ok(360 * a.k <= 0.8 * a.w, `Build at most four fifths of it, floor round it (${Math.round(360 * a.k)} of ${a.w})`);
  assert.deepEqual(await measure(page), [], "nothing spills, a room at a time");
  // seen through a camera (owner, 10-07: "keep the style of the office the same but vibe it like a camera room"): each
  // room a camera of its own, REC and the time to the second on a strip above the picture, and nothing of the
  // camera's over the picture (owner, 10-08: "Camera view is too camera ey, we want to see them")
  const cam = (n: string, room: string): string => `CAM ${String(VIEWS.findIndex((v) => v.id === n) + 1).padStart(2, "0")} · ${room}`;
  assert.equal(await page.locator("[data-camera]").getAttribute("data-camera"), cam("build", "BUILD"));
  const stampAt = await page.locator("[data-camera-stamp]").innerText();
  assert.match(stampAt, /^\d\d [A-Z]{3} \d{4} \d\d:\d\d:\d\d$/);
  await page.waitForFunction((was) => document.querySelector("[data-camera-stamp]")?.textContent !== was, stampAt, { timeout: 3_000 });
  const [strip, view] = [(await page.locator("[data-camera-rec]").boundingBox())!, (await page.locator("[data-floor-view]").boundingBox())!];
  assert.ok(strip.y + strip.height <= view.y + 1, "REC above the picture, covering none of it");
  // every box the camera draws, outside the floor itself, keeps off the picture: no scanlines, darker edges or corners
  const over = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>("[data-floor-view]")!;
    const v = view.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>("[data-camera] *")]
      .filter((el) => !view.contains(el) && !el.contains(view) && el.tagName !== "STYLE")
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left < v.right - 1 && r.right > v.left + 1 && r.top < v.bottom - 1 && r.bottom > v.top + 1;
      })
      .map((el) => el.outerHTML.slice(0, 80));
  });
  assert.deepEqual(over, [], "nothing of the camera's over the office");
  // the kitchen
  await page.locator('[data-view-choice="kitchen"]').click();
  await page.waitForTimeout(300);
  a = await at();
  // at the floor's right edge: moved in, not shrunk, so the kitchen has the same floor round it
  const onKitchen = viewRect("kitchen")!;
  assert.deepEqual(onKitchen, { x: 708, y: 36, w: 492, h: 294 });
  assert.ok(Math.abs(a.left - onKitchen.x * a.k) <= 1 && Math.abs(a.top - onKitchen.y * a.k) <= 1, `the window on the kitchen (${JSON.stringify(a)})`);
  assert.equal(await page.locator("[data-camera]").getAttribute("data-camera"), cam("kitchen", "KITCHEN"), "another room, another camera");
  // kept on this device
  await page.reload();
  await page.locator('[data-view-choice="kitchen"][aria-pressed="true"]').waitFor({ timeout: 30_000 });
  // the whole office: the floor as before, wider than the screen and swiped
  await page.locator('[data-view-choice="all"]').click();
  await page.waitForTimeout(300);
  a = await at();
  assert.equal(a.room, null);
  assert.equal(await page.locator("[data-floor-view]").evaluate((el) => getComputedStyle(el).overflowX), "auto", "swiped, as before");
  // a desk shows it whole: no chips
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" })).newPage();
  await desk.goto(d.pairLink());
  await desk.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await desk.evaluate(() => (location.hash = "#/office"));
  await desk.locator("[data-floor-plan]").waitFor({ timeout: 30_000 });
  assert.equal(await desk.locator("[data-view-choice]").count(), 0);
  assert.equal(await desk.locator("[data-camera]").getAttribute("data-camera"), "CAM 01 · WHOLE OFFICE", "a desk: the one camera on all of it");
  await desk.context().close();
});

test("the bottom rooms (owner, 10-08: \"Gym, Classroom, Library and Interview room, plus the hallway fix\"): the night's gym in the gym, today's applicants in the interview room, an orb at school in the classroom, the hallways rugs; desk and phone", { skip, timeout: 240_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-floor-low-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  for (const [id, name, sp, hue] of [["pip", "Pip", "assistant", "mint"], ["gus", "Gus", "devops", "cornflower"], ["ada", "Ada", "accountant", "amber"], ["bo", "Bo", "research", "coral"]] as const) h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue });
  h.recruiter.setPosition("frontend", true);
  h.recruiter.setPosition("backend", true);
  h.letGo("bo");
  h.sendToSchool("bo", [{ kind: "maths" }], 0.7);
  const applied = h.recruiting().applicants.length;
  assert.ok(applied > 3, `control: more applied today than there are chairs (${applied})`);
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/office"));
  await page.locator("[data-floor-plan]").waitFor({ timeout: 30_000 });
  // the hallways are rugs (10-08: "why is the space betwene top and bottom rooms is a street?"): no lane line down them
  assert.equal(await page.locator("[data-hallway]").count(), 2, "two hallways");
  assert.equal(await page.locator("[data-hallway] *").evaluateAll((els) => els.filter((el) => getComputedStyle(el).strokeDasharray !== "none").length), 0, "no dashed line");
  // today's applicants wait in the interview room, its sign counting them
  await page.locator('[data-visitor="applicant"]').first().waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-visitor="applicant"]').count(), 3, "the first three on the chairs");
  assert.equal(await page.locator("[data-applied-more]").innerText(), `+${applied - 3} more`, "the rest counted on the table");
  // an orb you sent to school, at a desk in the classroom; let go, it is not one of the office's
  await page.locator('[data-visitor="school"][data-floor-visitor="Bo"]').waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-floor-orb="Bo"]').count(), 0, "control: Bo is away");
  await page.waitForTimeout(600);
  assert.deepEqual(await measure(page), [], "the floor and its new rooms, at desk size");
  // the night's gym: the office in the gym, learning (it sat them at their desks before there was one)
  h.events.append("gym.night", {});
  // where it sends each one (the walk itself, across the whole floor, is the floor's own, tested above)
  for (const name of ["Pip", "Gus", "Ada"]) await arrives(page, name, /^poi:(tread1|tread2|weights|bench)$/, { there: false, timeout: 90_000 });
  assert.match(await page.locator('[data-who="Ada"]').innerText(), /At the gym, learning habits/);
  h.events.append("gym.night_done", {});
  // an applicant pressed: the Recruiter, on its department; the count, the Recruiter
  await page.locator('[data-visitor="applicant"]').first().click();
  await page.waitForFunction(() => location.hash === "#/recruiter/build", undefined, { timeout: 10_000 });
  await page.evaluate(() => (location.hash = "#/office"));
  await page.locator("[data-applied-more]").click();
  await page.waitForFunction(() => location.hash === "#/recruiter", undefined, { timeout: 10_000 });
  // on a phone each new room has its chip, and none spills
  const phone = await ctx.browser()!.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, isMobile: true });
  t.after(() => phone.close());
  const p = await phone.newPage();
  await p.goto(d.pairLink());
  await p.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await p.evaluate(() => (location.hash = "#/office"));
  await p.locator("[data-floor-plan]").waitFor({ timeout: 30_000 });
  for (const room of ["gym", "classroom", "library", "interview"]) {
    await p.locator(`[data-view-choice="${room}"]`).click();
    await p.waitForTimeout(500);
    assert.deepEqual(await measure(p), [], `${room}, on a phone`);
  }
});
