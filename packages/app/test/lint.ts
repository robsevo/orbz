// The token lint (PLAN 2.1_t): a colour may be written only in `src/design/`. Anywhere else, a hex
// value, a colour function (rgb, hsl, oklch…) or a named CSS colour is a finding, and so is the
// quiet grey used as a text colour (it is for rules and disabled controls; it fails AA as text).
// A line that is not a colour despite looking like one says so: `lint: not a colour`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Finding = { file: string; line: number; what: string };

const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNC = /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/gi;
const NAMED =
  /\b(?:color|background(?:-color)?|fill|stroke|border(?:-[a-z]+)?|outline(?:-color)?|box-shadow|text-shadow|caret-color|accent-color|backgroundColor|borderColor|outlineColor)\s*[:=]\s*["'`]?[^;"'`\n]*?\b(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|navy|teal|aqua|cyan|magenta|lime|maroon|olive|brown|beige|ivory|coral|salmon|crimson|indigo|violet)\b/gi;
// the `color` property itself: a scrollbar's thumb (`scrollbar-color`, 10-07) is not text
const QUIET_TEXT = /(?<![\w-])color\s*:\s*["'`]?var\(--quiet\)/gi;

export function lintSource(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  text.split("\n").forEach((line, i) => {
    if (/lint: not a colour/.test(line)) return; // the one way out, written where it is used ("issue #123")
    for (const [re, what] of [[HEX, "a hex colour"], [FUNC, "a colour function"], [NAMED, "a named colour"], [QUIET_TEXT, "the quiet grey as a text colour"]] as const) {
      for (const m of line.matchAll(re)) out.push({ file, line: i + 1, what: `${what}: ${m[0]}` });
    }
  });
  return out;
}

/** Where colour lives on purpose: the design tokens, and the orb's own material (his glass, the
 * palettes his shader is lit with, ported from Ash), which is the orb, not the app's chrome. */
const EXEMPT = new Set(["design", "orb/glsl.ts"]);

/** Every source file under `root` except the design tokens themselves. */
export function lintTree(root: string): Finding[] {
  const out: Finding[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!EXEMPT.has(relative(root, p))) walk(p);
      } else if (/\.(tsx?|css|html)$/.test(e.name) && !EXEMPT.has(relative(root, p))) out.push(...lintSource(relative(root, p), readFileSync(p, "utf8")));
    }
  };
  walk(root);
  return out;
}
