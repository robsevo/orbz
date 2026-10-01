// The splash: the orb himself, with the facts beside him in a quiet column, ported from Ash's
// `startup.mjs` and `boot.mjs` (PLAN 1.9). Every fact is read from the running home: the door it
// answered on, its kit, the orb and its chat. The boot is him waking up: eyes shut, a blink, eyes
// open, and a hop once the home has answered, because he shows he is happy by moving, never by
// smiling. The frame is pure (`splashLines`); `playSplash` animates those same lines, so the moving
// version and the still one share one layout. Off a TTY he is drawn in plain block characters.
import { beanRows, floorRow, PW, ROWS, type Face } from "./bean.ts";

export const W = 62; // nothing on the splash is wider, so one number decides "too narrow"
const GAP = 3;
const LABELW = 8;
const VMAX = W - 1 - PW - GAP - LABELW;

type RGB = readonly [number, number, number];
// The codex palette's splash half (Ash's `rooted` values): near-white, greys, one hue for "ok".
const ACCENT: RGB = [224, 224, 228];
const CREAM: RGB = [194, 194, 196];
const DIM: RGB = [95, 95, 97];
const OK: RGB = [110, 190, 130];
const WARN: RGB = [196, 167, 103];

export type SplashFacts = {
  orb: string; // the orb's name, as the person gave it
  version: string;
  door: string; // where the home answered, e.g. 127.0.0.1:41234
  online: boolean;
  kit: string | null; // the kit's state, or null when the home runs without one
  dataDir: string;
  chat: string; // the conversation, and how much of it there is
};

export function tildify(dir: string, home = process.env.HOME ?? ""): string {
  return home && (dir === home || dir.startsWith(`${home}/`)) ? `~${dir.slice(home.length)}` : dir;
}

const clip = (v: string): string => (v.length > VMAX ? `…${v.slice(-(VMAX - 1))}` : v);

/** The splash at one moment: him (with `face` and `lift`) and the facts. */
export function splashLines(f: SplashFacts, o: { face?: Face; lift?: number; color?: boolean } = {}): string[] {
  const color = o.color ?? true;
  const col = (c: RGB): string => (color ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : "");
  const rst = color ? "\x1b[0m" : "";
  const bold = color ? "\x1b[1m" : "";
  const fact = (label: string, value: string, c: RGB = CREAM): string => `${col(DIM)}${label.padEnd(LABELW)}${rst}${col(c)}${clip(value)}${rst}`;
  const face = o.face ?? "open";
  const text = [
    "",
    `${bold}${col(ACCENT)}${f.orb}${rst}  ${col(DIM)}orbs v${f.version}${rst}`,
    `${col(CREAM)}${face === "shut" ? "waking up…" : f.online ? "ready when you are." : "his home is not answering."}${rst}`,
    "",
    `${col(DIM)}${"home".padEnd(LABELW)}${f.door}  ${rst}${col(f.online ? OK : WARN)}● ${f.online ? "online" : "no answer"}${rst}`,
    fact("kit", f.kit ?? "off", f.kit === "up" ? CREAM : WARN),
    fact("data", tildify(f.dataDir)),
    fact("chat", f.chat),
    "",
    `${col(DIM)}Enter sends · Esc stops · Ctrl+C quits${rst}`,
  ];
  const art = [...beanRows({ face, lift: o.lift ?? 0, color }), floorRow({ color })];
  const height = Math.max(ROWS + 1, text.length);
  const out: string[] = [];
  for (let i = 0; i < height; i++) out.push(` ${art[i] ?? " ".repeat(PW)}${" ".repeat(GAP)}${text[i] ?? ""}`.replace(/\s+$/, ""));
  return out;
}

/** The wake-up, drawn in place on a TTY (each frame rewrites the last), ending on the still frame. */
export async function playSplash(out: NodeJS.WriteStream, f: SplashFacts, o: { animate: boolean; color: boolean }): Promise<void> {
  const still = splashLines(f, { color: o.color });
  if (!o.animate) {
    out.write(`\n${still.join("\n")}\n\n`);
    return;
  }
  // shut → blink → open, then a hop if his home answered: up a pixel, and down
  const frames: { face: Face; lift: number; ms: number }[] = [
    { face: "shut", lift: 0, ms: 260 },
    { face: "blink", lift: 0, ms: 90 },
    { face: "open", lift: 0, ms: 180 },
    ...(f.online ? [{ face: "happy" as Face, lift: 1, ms: 120 }, { face: "open" as Face, lift: 0, ms: 0 }] : []),
  ];
  out.write("\n\x1b[?25l"); // hide the cursor while he wakes
  let drawn = 0;
  for (const fr of frames) {
    const lines = splashLines(f, { face: fr.face, lift: fr.lift, color: o.color });
    if (drawn) out.write(`\x1b[${drawn}F`); // back to the first line of the last frame
    out.write(`${lines.map((l) => `${l}\x1b[K`).join("\n")}\n`);
    drawn = lines.length;
    if (fr.ms) await new Promise((r) => setTimeout(r, fr.ms));
  }
  out.write(`\x1b[${drawn}F${still.map((l) => `${l}\x1b[K`).join("\n")}\n\n\x1b[?25h`);
}
