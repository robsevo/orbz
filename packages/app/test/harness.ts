// The render harness (PLAN 2.1_t now, 2.6 grows it): a page built by Vite, served from a scratch
// directory, opened in a real Chromium at a phone's size and a desk's, and measured as it rendered.
// What it reports is what a person would see go wrong:
//
//   hscroll   the page scrolls sideways (phone first: never)
//   spill     an element's box reaches outside the window, or outside the box that clips it
//   overflow  text runs past its own box without being cut on purpose (an ellipsis)
//   minfont   text smaller than the floor of 10
//
// Ash's tools/panel_render.mjs is the model; this is our own code.
import { existsSync, globSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

export type Finding = { kind: "hscroll" | "spill" | "overflow" | "minfont"; what: string };
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

/** Everything wrong with the page as it is now. Runs in the page. */
export function measure(page: Page): Promise<Finding[]> {
  return page.evaluate((MIN) => {
    const out: { kind: "hscroll" | "spill" | "overflow" | "minfont"; what: string }[] = [];
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
    for (const el of document.body.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < -1 || r.right > vw + 1) out.push({ kind: "spill", what: `${name(el)} reaches ${Math.round(r.left)}..${Math.round(r.right)} in a ${vw}px window` });
      const clip = clipOf(el);
      if (clip && clip !== document.documentElement && clip !== document.body) {
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
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || !n.parentElement) continue;
      const px = Number.parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (px < MIN) out.push({ kind: "minfont", what: `${name(n.parentElement)} is ${px}px` });
    }
    return out;
  }, 10);
}
