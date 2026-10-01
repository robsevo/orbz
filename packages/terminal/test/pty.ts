// The `orbs` terminal in a real pseudo-terminal (pty_drive.py), for the tests: keys go in, the
// screen comes out, and a wait reads the screen as a person would, with the escape codes removed.
import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { kitPython } from "../../home/src/kit.ts";
import { Screen } from "./screen.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "..", "src", "main.ts");

/** The text of a stretch of output: colours, cursor moves and erases removed. */
export const plain = (s: string): string =>
  s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b[@-_]/g, "");

let python: Promise<string> | null = null;

export class Pty {
  readonly child: ChildProcess;
  readonly screen: Screen;
  raw = "";
  exited: Promise<number>;

  private constructor(child: ChildProcess, screen: Screen) {
    this.child = child;
    this.screen = screen;
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (s: string) => {
      this.raw += s;
      screen.feed(s);
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (s: string) => (this.raw += s));
    this.exited = new Promise((ok) => child.once("exit", (code) => ok(code ?? -1)));
  }

  /** The terminal (or `args` for it), COLS x ROWS, on a TTY. Killed when the test ends. */
  static async open(t: TestContext, args: string[], o: { cols?: number; rows?: number; env?: Record<string, string> } = {}): Promise<Pty> {
    python ??= kitPython();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ORBS_") && k !== "NO_COLOR") env[k] = v;
    Object.assign(env, { TERM: "xterm-256color", COLORTERM: "truecolor", FORCE_COLOR: "3" }, o.env);
    const cols = o.cols ?? 100;
    const rows = o.rows ?? 40;
    const child = spawn(await python, [join(HERE, "pty_drive.py"), String(cols), String(rows), "--", process.execPath, MAIN, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const p = new Pty(child, new Screen(cols, rows));
    t.after(async () => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await p.exited;
      }
    });
    return p;
  }

  /** Types into the terminal. */
  type(s: string): void {
    this.child.stdin!.write(s);
  }

  get mark(): number {
    return this.raw.length;
  }

  /** The screen's text since `from` (a mark). */
  text(from = 0): string {
    return plain(this.raw.slice(from));
  }

  /** Resolves when the text since `from` matches; fails, with what the screen showed, after `ms`. */
  async waitFor(re: RegExp, from = 0, ms = 10_000): Promise<number> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (re.test(this.text(from))) return Date.now();
      if (this.child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`the screen never showed ${re} (exit ${this.child.exitCode}); it showed:\n${this.text(from).slice(-3000)}`);
  }

  /** Resolves when the screen as it is NOW matches; fails, with the screen, after `ms`. */
  async onScreen(re: RegExp, ms = 5_000): Promise<number> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (re.test(this.screen.text())) return Date.now();
      if (this.child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`the screen does not show ${re} (exit ${this.child.exitCode}); it shows:\n${this.screen.text()}`);
  }
}
