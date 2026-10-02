// The render harness (PLAN 2.1_t now, 2.6 grows it): a page built by Vite, served from a scratch
// directory, opened in a real Chromium at a phone's size and a desk's, and measured as it rendered.
// What it reports is what a person would see go wrong:
//
//   hscroll   the page scrolls sideways (phone first: never)
//   spill     an element's box reaches outside the window, or outside the box that clips it (what
//             a sideways scroller holds beyond its edge is scrolled, not spilled)
//   overflow  text runs past its own box without being cut on purpose (an ellipsis)
//   minfont   text smaller than the floor of 10
//   orphan    a row of items (a grid, a wrapped list) whose last row holds one item alone (owner,
//             10-01: "i hate when like just 1 item is lingering in a table or header")
//   widow     a title or a line of text whose last line is one word on its own
//
// Ash's tools/panel_render.mjs is the model; this is our own code.
import { existsSync, globSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

export type Finding = { kind: "hscroll" | "spill" | "overflow" | "minfont" | "orphan" | "widow"; what: string };
export const SIZES = { phone: { width: 390, height: 844 }, desk: { width: 1280, height: 900 } } as const;

/** A Chromium to drive: $ORBS_CHROME, Playwright's own, a cached one, or Chrome itself. */
export function findChrome(): string | null {
  const cands = [
    process.env.ORBS_CHROME,
    (() => {
      try {
        return chromium.executablePath();
      } catch {
        return undefined;
      }
    })(),
    ...globSync(join(homedir(), ".cache/ms-playwright/chromium-*/chrome-linux*/chrome")).sort().reverse(),
    "/opt/google/chrome/chrome", // the binary itself: google-chrome-stable is a wrapper that can hang headless
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return cands.find((p): p is string => Boolean(p) && existsSync(p!)) ?? null;
}

export async function launch(): Promise<Browser> {
  const exe = findChrome();
  if (!exe) throw new Error("no Chromium to render with: set ORBS_CHROME, or `npx playwright install chromium`");
  // WebGL with no GPU (a test machine, CI): Chromium's software renderer draws the orbs
  return chromium.launch({ executablePath: exe, headless: true, args: ["--font-render-hinting=none", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

/** Serves a built directory on 127.0.0.1, for the length of a test. */
export async function serveDir(dir: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(dir, path.endsWith("/") ? `${path}index.html` : path);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  const port = typeof a === "object" && a ? a.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

/** Everything wrong with the page once it is at rest: every press, bounce and arrival finished. */
export async function measure(page: Page): Promise<Finding[]> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return page.evaluate((MIN) => {
    const out: { kind: "hscroll" | "spill" | "overflow" | "minfont" | "orphan" | "widow"; what: string }[] = [];
    const name = (el: Element): string => {
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}>${t ? ` "${t}"` : ""}`;
    };
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push({ kind: "hscroll", what: `the page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window` });
    const clipOf = (el: Element): Element | null => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") return p;
      }
      return null;
    };
    // a row that scrolls sideways on purpose (ui/Balanced.tsx OneLine, the tab bar) holds what does
    // not fit inside its own box: that is scrolled, not spilled; the scroller itself is still checked
    const scrolled = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    for (const el of document.body.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const inScroller = scrolled(el);
      if (!inScroller && (r.left < -1 || r.right > vw + 1)) out.push({ kind: "spill", what: `${name(el)} reaches ${Math.round(r.left)}..${Math.round(r.right)} in a ${vw}px window` });
      const clip = clipOf(el);
      if (!inScroller && clip && clip !== document.documentElement && clip !== document.body) {
        const c = clip.getBoundingClientRect();
        if (r.left < c.left - 1 || r.right > c.right + 1) out.push({ kind: "spill", what: `${name(el)} is cut by ${name(clip)}` });
      }
      const cut = s.textOverflow === "ellipsis" || s.overflowX === "auto" || s.overflowX === "scroll";
      // an SVG element has no scroll box (its scrollWidth means nothing); the spill check above covers it
      const svg = el instanceof SVGElement;
      if (!svg && !cut && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && s.display !== "inline") {
        out.push({ kind: "overflow", what: `${name(el)}: ${el.scrollWidth}px of content in ${el.clientWidth}px` });
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const words = new Map<Element, { tops: Map<number, number>; n: number }>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || !n.parentElement) continue;
      const px = Number.parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (px < MIN) out.push({ kind: "minfont", what: `${name(n.parentElement)} is ${px}px` });
      // where each word sits, line by line, for the widow check (by the block the text flows in)
      let block: Element = n.parentElement;
      while (getComputedStyle(block).display === "inline" && block.parentElement) block = block.parentElement;
      const s = getComputedStyle(block);
      if (s.whiteSpace === "nowrap" || s.textOverflow === "ellipsis" || block.closest("svg")) continue;
      const text = n.textContent;
      const entry = words.get(block) ?? { tops: new Map<number, number>(), n: 0 };
      for (const m of text.matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        const rect = r.getClientRects()[0];
        if (!rect) continue;
        const top = Math.round(rect.top / 4) * 4; // a line, give or take a sub-pixel
        entry.tops.set(top, (entry.tops.get(top) ?? 0) + 1);
        entry.n++;
      }
      words.set(block, entry);
    }
    for (const [block, w] of words) {
      if (w.tops.size < 2 || w.n < 3) continue;
      const last = Math.max(...w.tops.keys());
      if (w.tops.get(last) === 1) out.push({ kind: "widow", what: `${name(block)} ends on one word alone` });
    }
    // orphans: a container whose children wrap into rows, the last row a single child
    for (const el of document.body.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      const wraps = s.display === "grid" || s.display === "inline-grid" || ((s.display === "flex" || s.display === "inline-flex") && s.flexWrap === "wrap");
      if (!wraps) continue;
      const kids = [...el.children].filter((k) => getComputedStyle(k).display !== "none" && (k as HTMLElement).offsetParent !== null);
      if (kids.length < 3) continue;
      const rows = new Map<number, Element[]>();
      for (const k of kids) {
        const top = Math.round(k.getBoundingClientRect().top / 4) * 4;
        rows.set(top, [...(rows.get(top) ?? []), k]);
      }
      if (rows.size < 2) continue;
      const ordered = [...rows.keys()].sort((a, b) => a - b).map((t) => rows.get(t)!);
      const counts = ordered.map((r) => r.length);
      // a one-column list is rows of one by design, and an item that takes the whole row fills it;
      // a lone item narrower than the rows above it is an orphan
      const lone = ordered.at(-1)!;
      const widest = Math.max(...ordered.slice(0, -1).map((r) => r.at(-1)!.getBoundingClientRect().right - r[0]!.getBoundingClientRect().left));
      if (lone.length === 1 && Math.max(...counts) > 1 && lone[0]!.getBoundingClientRect().width < widest * 0.9) {
        out.push({ kind: "orphan", what: `${name(el)}: its last row is one item alone (${counts.join("+")})` });
      }
    }
    return out;
  }, 10);
}

/** Starts a new orb on the app's page and dresses him plainly, the way the picker limits were
 * measured: Ash's bean, his classic eyes and colour, glass, no hat, no glasses, Ash's goo. The rest (his name,
 * his personality) stays as the dice left it. */
export async function plainNewOrb(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New orb" }).first().click();
  await page.getByRole("tab", { name: "Colour" }).click();
  await page.getByRole("button", { name: "azure", exact: true }).click();
  await page.locator('button[data-pick="glass"]').click();
  await page.getByRole("button", { name: "No gradient" }).click();
  await page.getByLabel("How gooey").fill("55");
  await page.getByRole("tab", { name: "Hat" }).click();
  await page.locator('button[data-pick="none"]').click();
  await page.getByRole("tab", { name: "Glasses" }).click();
  await page.locator('button[data-pick="none"]').click();
  await page.getByRole("tab", { name: "Eyes" }).click();
  await page.locator('button[data-pick="classic"]').click();
  await page.getByRole("tab", { name: "Shape" }).click();
  await page.locator('button[data-pick="bean"]').click();
}
