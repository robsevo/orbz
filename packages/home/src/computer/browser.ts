// An orb's computer (PLAN 4.1): his own browser. A Chromium of his own, headless, with a profile
// of its own in the home's data folder (`orbs/<id>/browser`), so his sign-ins survive a restart and
// YOUR browser and its profile are never opened, read or written. Open Dot's shape, in our words:
//
//   wake       his browser starts, on the page he was last on
//   sleep      it closes after IDLE_MS unused (the profile stays); the next act wakes it
//   reset      a fresh browser: the profile is deleted, so every site signs him out
//   take over  the person has it: his acts are refused until it is handed back (4.6 watches it)
//
// He finds things by their visible text, as a person would (and as a local brain with no eyes
// can): a click names the words on the button, typing names the field's label. After every act a
// still of his screen is kept (`screen.jpg` and where his cursor was, `screen.json`), which the app
// draws with his face as the cursor (2.8).
//
// Every connection his browser makes goes through the home's guarded proxy (proxy.ts): never this
// machine or its network. What comes back is from outside (the tools mark it so).
import { existsSync, globSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import type { EventLog } from "../events.ts";
import { safeName, workspaceOf } from "../workspace.ts";
import { inWorkspace } from "../agent/tools.ts";
import { type GuardedProxy, startProxy } from "./proxy.ts";

export const SCREEN = { width: 1280, height: 800 };
/** How long a browser no one is using stays open. */
export const IDLE_MS = 10 * 60_000;
const NAV_MS = 30_000;
const FIND_MS = 6_000;
/** The most of a page's words an orb reads at once. */
export const TEXT_CAP = 15_000;
/** Where what he downloads lands, in his workspace. */
export const DOWNLOADS = "downloads";

export class ComputerError extends Error {}

export const profileOf = (dataDir: string, orb: string): string => join(dataDir, "orbs", orb, "browser");
/** The home folder his browser is given: never yours, so nothing it keeps lands in it. */
const homeOf = (dataDir: string, orb: string): string => join(dataDir, "orbs", orb, "browser-home");
const screenOf = (dataDir: string, orb: string): string => join(dataDir, "orbs", orb, "screen");

/** His browser keeps no password and no card it saw typed: its password manager and autofill are
 * off in his profile (a sign-in is the vault's, typed fresh each time). */
function quietProfile(dir: string): void {
  const file = join(dir, "Default", "Preferences");
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    // a new profile
  }
  const profile = (prefs.profile ?? {}) as Record<string, unknown>;
  const autofill = (prefs.autofill ?? {}) as Record<string, unknown>;
  prefs = { ...prefs, credentials_enable_service: false, profile: { ...profile, password_manager_enabled: false }, autofill: { ...autofill, profile_enabled: false, credit_card_enabled: false } };
  mkdirSync(join(dir, "Default"), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(prefs), { mode: 0o600 });
}

/** What his browser is started with from the home's environment: enough to run, no more (the
 * home's own variables can hold keys), and a home folder of its own. */
function envFor(home: string): Record<string, string> {
  if (process.platform === "win32") return { ...(process.env as Record<string, string>) };
  const keep = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "FONTCONFIG_PATH", "FONTCONFIG_FILE"];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share") };
}

/** A Chromium to run: $ORBS_CHROME, Playwright's own, one Playwright cached, or Chrome itself. */
export function chromiumPath(): string | null {
  const own = ((): string | null => {
    try {
      return chromium.executablePath();
    } catch {
      return null;
    }
  })();
  const candidates = [
    process.env.ORBS_CHROME,
    own,
    ...globSync(join(homedir(), ".cache/ms-playwright/chromium-*/chrome-linux*/chrome")).sort().reverse(),
    ...globSync(join(homedir(), "Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium")).sort().reverse(),
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p): p is string => Boolean(p && existsSync(p))) ?? null;
}

/** Where his cursor last acted, on the still, in the still's own pixels. `shot` tells one still
 * from the next (the wall clock's, whatever the home's clock says). */
export type Screen = { url: string; title: string; at: number; shot: number; cursor: { x: number; y: number } | null; width: number; height: number };

export type ComputersOptions = {
  dataDir: string;
  events: EventLog;
  now: () => number;
  /** The Chromium to run (default: chromiumPath()). */
  executable?: string | null;
  idleMs?: number;
};

type Session = { context: BrowserContext; page: Page; idle: NodeJS.Timeout | null; proxy: GuardedProxy };

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class Computers {
  readonly #o: ComputersOptions;
  readonly #sessions = new Map<string, Promise<Session>>();
  readonly #taken = new Set<string>();
  #shot = 0;
  #closed = false;

  constructor(o: ComputersOptions) {
    this.#o = o;
  }

  /** Whether his browser is open now. */
  awake(orb: string): boolean {
    return this.#sessions.has(orb);
  }

  takenOver(orb: string): boolean {
    return this.#taken.has(orb);
  }

  /** The person has his computer: his own acts are refused until it is handed back. */
  takeOver(orb: string): void {
    this.#taken.add(orb);
    this.#o.events.append("computer.taken_over", { orb }, { orb });
  }

  handBack(orb: string): void {
    if (!this.#taken.delete(orb)) return;
    this.#o.events.append("computer.handed_back", { orb }, { orb });
  }

  async #launch(orb: string): Promise<Session> {
    const exe = this.#o.executable === undefined ? chromiumPath() : this.#o.executable;
    if (!exe) throw new ComputerError("there is no Chromium on this machine for his browser: set ORBS_CHROME to one, or run `npx playwright install chromium`");
    const dir = profileOf(this.#o.dataDir, orb);
    const home = homeOf(this.#o.dataDir, orb);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    mkdirSync(home, { recursive: true, mode: 0o700 });
    quietProfile(dir);
    // his own way out, so what it stops is his
    const proxy = await startProxy((b) => this.#o.events.append("computer.blocked", { orb, host: b.host }, { orb }));
    const open = (sandbox: boolean): Promise<BrowserContext> =>
      chromium.launchPersistentContext(dir, {
        executablePath: exe,
        env: envFor(home),
        headless: true,
        viewport: SCREEN,
        deviceScaleFactor: 1,
        acceptDownloads: true,
        chromiumSandbox: sandbox, // Chromium's own sandbox, kept wherever it can start
        // everything through the guarded proxy, this machine's own addresses included
        proxy: { server: proxy.server, bypass: "<-loopback>" },
        args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--no-first-run", "--no-default-browser-check"],
        timeout: NAV_MS,
      });
    let context: BrowserContext;
    try {
      try {
        context = await open(true);
      } catch (e) {
        // no user namespaces here (a container): Chromium's sandbox cannot start; say so, once
        context = await open(false);
        this.#o.events.append("computer.unsandboxed", { orb, why: (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200) }, { orb });
      }
    } catch (e) {
      await proxy.close();
      throw new ComputerError(`his browser did not start: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200)}`);
    }
    const s: Session = { context, page: context.pages()[0] ?? (await context.newPage()), idle: null, proxy };
    const watch = (p: Page): void => {
      // a page's alert, confirm or prompt is answered "no" rather than left to hang his act
      p.on("dialog", (d) => void (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => {}));
      p.on("download", (d) => {
        void (async () => {
          const ws = workspaceOf(this.#o.dataDir, orb);
          const name = safeName(d.suggestedFilename());
          const dot = name.lastIndexOf(".");
          const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
          for (let n = 1; n < 1000; n++) {
            const rel = `${DOWNLOADS}/${n === 1 ? name : `${stem} (${n})${ext}`}`;
            const at = inWorkspace(ws, rel);
            if (!at) return;
            if (existsSync(at)) continue;
            mkdirSync(join(at, ".."), { recursive: true });
            await d.saveAs(at);
            this.#o.events.append("computer.downloaded", { orb, path: rel }, { orb });
            return;
          }
        })().catch(() => {});
      });
    };
    watch(s.page);
    // a link that opens a new tab: he follows it, as a person would
    context.on("page", (p) => {
      watch(p);
      s.page = p;
      p.once("close", () => {
        if (s.page === p) s.page = context.pages().at(-1) ?? s.page;
      });
    });
    context.on("close", () => {
      void s.proxy.close();
      void this.#sessions.get(orb)?.then((cur) => {
        if (cur === s) this.#sessions.delete(orb);
      }, () => {});
    });
    this.#o.events.append("computer.woke", { orb }, { orb });
    return s;
  }

  /** His browser, started if it was asleep. */
  async #session(orb: string): Promise<Session> {
    if (this.#closed) throw new ComputerError("the home is closing");
    let s = this.#sessions.get(orb);
    if (!s) {
      s = this.#launch(orb);
      this.#sessions.set(orb, s);
      s.catch(() => this.#sessions.delete(orb));
    }
    const got = await s;
    if (got.idle) clearTimeout(got.idle);
    got.idle = setTimeout(() => void this.sleep(orb), this.#o.idleMs ?? IDLE_MS);
    got.idle.unref();
    return got;
  }

  /** The page he acts on: refused while the person has his computer. */
  async #page(orb: string): Promise<Page> {
    if (this.#taken.has(orb)) throw new ComputerError("the person has your computer right now: wait until they hand it back");
    return (await this.#session(orb)).page;
  }

  /** Starts his browser, so the person can watch it (the app's Computer tab). */
  async wake(orb: string): Promise<void> {
    await this.#session(orb);
  }

  /** Closes his browser; its profile (his sign-ins) stays. */
  async sleep(orb: string): Promise<void> {
    const s = this.#sessions.get(orb);
    if (!s) return;
    this.#sessions.delete(orb);
    const got = await s.catch(() => null);
    if (!got) return;
    if (got.idle) clearTimeout(got.idle);
    await got.context.close().catch(() => {});
    await got.proxy.close();
    this.#o.events.append("computer.slept", { orb }, { orb });
  }

  /** A fresh browser: his profile is deleted, so he is signed out everywhere. The person's choice. */
  async reset(orb: string): Promise<void> {
    await this.sleep(orb);
    rmSync(profileOf(this.#o.dataDir, orb), { recursive: true, force: true });
    rmSync(homeOf(this.#o.dataDir, orb), { recursive: true, force: true });
    rmSync(screenOf(this.#o.dataDir, orb), { recursive: true, force: true });
    this.#o.events.append("computer.reset", { orb }, { orb });
  }

  /** Where he is now, without waking him. */
  async here(orb: string): Promise<{ url: string; title: string } | null> {
    const s = this.#sessions.get(orb);
    if (!s) return null;
    const got = await s.catch(() => null);
    return got ? { url: got.page.url(), title: await got.page.title().catch(() => "") } : null;
  }

  async open(orb: string, url: string): Promise<{ url: string; title: string }> {
    const p = await this.#page(orb);
    try {
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_MS });
    } catch (e) {
      throw new ComputerError(`the page did not open: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]!.replace(/^page\.goto: /, "")}`);
    }
    await p.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
    await this.#still(orb, p, null);
    return { url: p.url(), title: await p.title() };
  }

  /** The words on the page, as a person sees them. */
  async read(orb: string): Promise<{ url: string; title: string; text: string; cut: boolean }> {
    const p = await this.#page(orb);
    // runs in the page: its own types, since the home is typed for Node, not a DOM
    const raw = (await p.evaluate(() => (globalThis as unknown as { document: { body: { innerText: string } | null } }).document.body?.innerText ?? "").catch(() => "")).replace(/\n{3,}/g, "\n\n").trim();
    return { url: p.url(), title: await p.title(), text: raw.slice(0, TEXT_CAP), cut: raw.length > TEXT_CAP };
  }

  /** What a click on `text` would press: a button that says it, else a link, a menu item, a tab, a
   * box or an option, else words on the page (a heading saying "Place order" is not the button). */
  async #target(p: Page, text: string): Promise<Locator> {
    const t = text.trim();
    const name = new RegExp(escapeRe(t), "i");
    const ways = [
      ...(["button", "link", "menuitem", "tab", "checkbox", "radio", "option"] as const).map((role) => p.getByRole(role, { name })),
      p.getByText(t, { exact: false }),
    ];
    const deadline = Date.now() + FIND_MS; // a page still drawing: look again
    for (;;) {
      for (const way of ways) {
        const el = way.filter({ visible: true }).first();
        if (await el.count().catch(() => 0)) return el;
      }
      if (Date.now() > deadline) throw new ComputerError(`nothing on the page says "${t}": read the page and use its own words`);
      await p.waitForTimeout(200);
    }
  }

  /** Does `act`, then waits for the page it leads to, if it leads to one (a link, a submitted form,
   * a new tab): his still and his answer are of where he ended up, not of the page he left. Every
   * listener is set BEFORE the act, so a fast page cannot slip past; a click that leads nowhere (or
   * to a download) costs a moment, not a page's timeout. */
  async #andWait(p: Page, act: () => Promise<void>): Promise<Page> {
    const loaded = p.waitForEvent("load", { timeout: NAV_MS }).then(() => true, () => false);
    const started = p.waitForRequest((r) => r.isNavigationRequest() && r.frame() === p.mainFrame(), { timeout: 600 }).then(() => true, () => false);
    const tab = p.context().waitForEvent("page", { timeout: 600 }).then((x) => x, () => null);
    const download = p.waitForEvent("download", { timeout: 600 }).then(() => true, () => false);
    await act();
    const [went, opened, saved] = await Promise.all([started, tab, download]);
    if (opened) {
      await opened.waitForLoadState("load", { timeout: NAV_MS }).catch(() => {});
      return opened;
    }
    if (went && !saved) await loaded;
    return p;
  }

  /** The whole visible label of what a click would press. */
  async #label(el: Locator, text: string): Promise<string> {
    return ((await el.innerText().catch(() => "")) || (await el.getAttribute("aria-label").catch(() => "")) || (await el.getAttribute("value").catch(() => "")) || text).replace(/\s+/g, " ").trim().slice(0, 120);
  }

  /** Clicks what says `text`. `check` reads the WHOLE label of what would be pressed first, and a
   * reason it gives stops the click: the floor was asked about "Continue", and the button can say
   * "Continue to payment". */
  async click(orb: string, text: string, check: (label: string) => string | null = () => null): Promise<{ label: string; url: string; title: string }> {
    const p = await this.#page(orb);
    const el = await this.#target(p, text);
    const label = await this.#label(el, text);
    const no = check(label);
    if (no) throw new ComputerError(no);
    const box = await el.boundingBox().catch(() => null);
    const now = await this.#andWait(p, () => el.click({ timeout: FIND_MS }));
    await this.#still(orb, now, now === p && box ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } : null);
    return { label, url: now.url(), title: await now.title() };
  }

  /** The field a label, a placeholder or a name finds, and what kind it is. */
  async #field(p: Page, field: string): Promise<{ el: Locator; kind: string; label: string }> {
    const f = field.trim();
    const el = p
      .getByLabel(f, { exact: false })
      .or(p.getByPlaceholder(f, { exact: false }))
      .or(p.locator(`[name="${f.replace(/["\\]/g, "\\$&")}"]`))
      .filter({ visible: true })
      .first();
    try {
      await el.waitFor({ state: "visible", timeout: FIND_MS });
    } catch {
      throw new ComputerError(`no field on the page is called "${f}": read the page and use its label`);
    }
    const kind = ((await el.getAttribute("type").catch(() => null)) ?? "text").toLowerCase();
    // everything that names the field: its <label>s' words as well as its own attributes ("Number"
    // can find the box labelled "Card number")
    const label = await el
      .evaluate((e) => {
        // runs in the page: its own types, since the home is typed for Node, not a DOM
        type Field = { labels?: ArrayLike<{ innerText: string }> | null; getAttribute(name: string): string | null; id: string };
        const i = e as unknown as Field;
        const doc = (globalThis as unknown as { document: { getElementById(id: string): { innerText: string } | null } }).document;
        const labels = i.labels ? Array.from(i.labels, (l) => l.innerText) : [];
        const by = (i.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id: string) => (id ? doc.getElementById(id)?.innerText ?? "" : ""));
        return [...labels, ...by, i.getAttribute("aria-label"), i.getAttribute("placeholder"), i.getAttribute("name"), i.getAttribute("autocomplete"), i.id].filter(Boolean).join(" ");
      })
      .catch(() => "");
    return { el, kind, label: `${f} ${label}`.replace(/\s+/g, " ").trim().slice(0, 200) };
  }

  /** Types into the field `field` finds. `check` reads the field's own words first (a card
   * number's box can be asked for as "Number"), and a reason it gives stops the typing. */
  async type(orb: string, field: string, text: string, submit: boolean, check: (label: string) => string | null = () => null): Promise<{ url: string; title: string }> {
    const p = await this.#page(orb);
    const { el, kind, label } = await this.#field(p, field);
    if (kind === "password") throw new ComputerError("that is a password field: a password is typed only by sign_in, from the ones the person saved");
    if (kind === "file") throw new ComputerError("that field takes a file, not words");
    const no = check(label);
    if (no) throw new ComputerError(no);
    const box = await el.boundingBox().catch(() => null);
    await el.fill(text, { timeout: FIND_MS });
    const now = submit ? await this.#andWait(p, () => el.press("Enter")) : p;
    await this.#still(orb, now, now === p && box ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } : null);
    return { url: now.url(), title: await now.title() };
  }

  /** The URL he is on, for the vault's check: a password goes only to its own site. */
  async url(orb: string): Promise<string> {
    return (await this.#page(orb)).url();
  }

  /** Types a saved login into the sign-in form of the page he is on, if that page is still on
   * `site` (checked again here, at the moment of typing). The password is never returned.
   *
   * A sign-in form is the form that holds a password box (the page's own, never a frame's). His
   * name goes into the box the page marks for it (autocomplete "username" or "email"), else into
   * that form's first box for words; the password into its password box. */
  async fill(orb: string, site: string, username: string, password: string, hostOf: (url: string) => string | null): Promise<{ filled: number }> {
    const p = await this.#page(orb);
    if (hostOf(p.url()) !== site) throw new ComputerError(`the page is no longer on ${site}, so the password was not typed`);
    const secretBox = 'input[type="password"]:visible';
    const signIn = p.locator("form").filter({ has: p.locator(secretBox) });
    const scope = (await signIn.count()) > 0 ? signIn.first() : p.locator("body");
    const marked = scope.locator('input[autocomplete~="username"]:visible, input[autocomplete~="email"]:visible');
    const wordsBox = scope.locator('input:not([type]):visible, input[type="text"]:visible, input[type="email"]:visible, input[type="tel"]:visible');
    const into: [Locator, string][] = [[(await marked.count()) > 0 ? marked.first() : wordsBox.first(), username], [scope.locator(secretBox).first(), password]];
    let filled = 0; // one box after the other: two fills at once would fight over the page's focus
    for (const [box, value] of into) if ((await box.count()) > 0) filled += (await box.fill(value), 1);
    await this.#still(orb, p, null);
    return { filled };
  }

  /** The last still of his screen, and where his cursor was. */
  screen(orb: string): { file: string; meta: string } {
    const dir = screenOf(this.#o.dataDir, orb);
    return { file: join(dir, "screen.jpg"), meta: join(dir, "screen.json") };
  }

  async #still(orb: string, p: Page, cursor: { x: number; y: number } | null): Promise<void> {
    try {
      const dir = screenOf(this.#o.dataDir, orb);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const jpg = await p.screenshot({ type: "jpeg", quality: 70, timeout: 5000 });
      const at = this.#o.now();
      this.#shot = Math.max(this.#shot + 1, Date.now());
      const meta: Screen = { url: p.url(), title: await p.title().catch(() => ""), at, shot: this.#shot, cursor, width: SCREEN.width, height: SCREEN.height };
      const { file, meta: metaFile } = this.screen(orb);
      writeFileSync(`${file}.tmp`, jpg, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      writeFileSync(`${metaFile}.tmp`, JSON.stringify(meta), { mode: 0o600 });
      renameSync(`${metaFile}.tmp`, metaFile);
      this.#o.events.append("computer.screen", { orb, at, cursor: Boolean(cursor) }, { orb });
    } catch {
      // a still is for watching; a page that will not draw one does not fail his act
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([...this.#sessions.keys()].map((orb) => this.sleep(orb)));
  }
}
