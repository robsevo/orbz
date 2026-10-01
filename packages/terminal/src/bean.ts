// The orb in the terminal: the glass bean, ported from Ash's `cli/engine/src/bean.mjs` (PLAN 1.9).
// The shape is the orb shader's own: the same egg terms and the same soft dent, evaluated per
// pixel, so he is the same figure in every window. The shading is a glass sphere lit from the top
// left: a steel-and-azure ramp, a Fresnel rim and one specular spot. The face is placed by hand,
// because at this size a scaled-down face would be one pixel. There is no mouth and there are no
// cheeks (owner, 2026-09-24). He shows he is happy with a hop, never a smile.
//
// One pixel is one column wide and half a row tall, so each cell stacks two pixels and the pixels
// come out square. `▀` carries the top pixel in the foreground and the bottom one in the background.

// The orb shader's shape constants (Ash's orb/shell/index.1.js), as bean.mjs keeps them.
export const EGG_TALL = 0.2;
export const EGG_TAPER = 0.11;
export const EGG_GROW = 0.05;
export const EGG_BELLY = 0.95;
export const BEAN_DENT = 0.03;

export const PW = 20; // pixels wide = columns
export const PH = 22; // pixels tall = 2 x rows
export const ROWS = PH / 2;

export type Face = "open" | "blink" | "shut" | "happy" | "none";
type RGB = readonly [number, number, number];

// His glass, as the desktop orb wears it by default (azure, held at rest).
const DEEP: RGB = [42, 48, 70];
const MIDS: RGB = [100, 111, 146];
const LITE: RGB = [158, 171, 204];
const PALE: RGB = [206, 214, 236];
const SPEC: RGB = [246, 249, 255];
const EYE: RGB = [14, 16, 20];
const SHINE: RGB = [252, 252, 252];

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const fg = ([r, g, b]: RGB): string => `${ESC}38;2;${r};${g};${b}m`;
const bg = ([r, g, b]: RGB): string => `${ESC}48;2;${r};${g};${b}m`;
const mix = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.max(0, Math.min(1, t));
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
};

/** Is this point inside him, and how far out to his rim (0..1)? x and y in -1..1, y down. */
function body(x: number, y: number): number | null {
  const ang = Math.atan2(y, x);
  const upward = -Math.sin(ang);
  const belly = 0.5 - 0.5 * upward;
  let egg = EGG_GROW + EGG_TALL * (1 - EGG_BELLY * belly) * (Math.sin(ang) ** 2 - 1) - EGG_TAPER * (0.5 + 0.5 * upward);
  egg -= BEAN_DENT * Math.exp(-(((ang - 0.35) / 0.55) ** 2));
  const rs = 0.96 * (1 + egg);
  const d = Math.hypot(x, y);
  return d < rs ? d / rs : null;
}

function shade(x: number, y: number, nd: number): RGB {
  const z = Math.sqrt(Math.max(0, 1 - nd * nd));
  const nx = x / 0.96;
  const ny = y / 0.96;
  const lit = Math.max(0, -0.45 * nx - 0.55 * ny + 0.7 * z);
  let c = mix(DEEP, MIDS, 0.35 + 0.65 * lit);
  c = mix(c, LITE, Math.max(0, lit - 0.55) * 1.6);
  c = mix(c, PALE, Math.pow(nd, 5) * 0.75); // the rim catches light: glass, not stone
  const sd = Math.hypot(x + 0.36, y + 0.52);
  if (sd < 0.16) c = mix(c, SPEC, 1 - (sd / 0.16) * 0.5);
  return c;
}

/** The face, by pixel offset from his centre: low, wide-set eyes, 2 x 3, a sparkle up-left. */
function face(px: number, py: number, cx: number, cy: number, kind: Face): RGB | null {
  if (kind === "none") return null;
  const dx = px - cx;
  const dy = py - cy;
  for (const c0 of [-4, 4]) {
    const ex = dx - c0;
    const ey = dy - 1;
    const onRow = (r: number, cols: number[]): boolean => ey === r && cols.includes(ex);
    if (kind === "open") {
      if ((ex === 0 || ex === 1) && Math.abs(ey) <= 1) return ex === 0 && ey === -1 ? SHINE : EYE;
    } else if (kind === "blink") {
      if (onRow(0, [-1, 0, 1, 2])) return EYE;
    } else if (kind === "shut") {
      if (onRow(0, [-1, 2]) || onRow(1, [0, 1])) return EYE; // ‿
    } else if (kind === "happy") {
      if (onRow(0, [-1, 2]) || onRow(-1, [0, 1])) return EYE; // ^
    }
  }
  return null; // no mouth: his eyes are the face
}

/** The pixel grid, top to bottom: PH rows of PW colours (null = clear). `lift` raises him. */
export function beanPixels({ face: kind = "open", lift = 0 }: { face?: Face; lift?: number } = {}): (RGB | null)[][] {
  const cx = PW / 2 - 0.5;
  const cy = PH / 2 - 0.5 + 1 - lift; // one pixel of floor room for a hop
  const out: (RGB | null)[][] = [];
  for (let py = 0; py < PH; py++) {
    const row: (RGB | null)[] = [];
    for (let px = 0; px < PW; px++) {
      const x = (px - cx) / (PW / 2);
      const y = (py - cy) / (PH / 2 - 1);
      const nd = body(x, y);
      row.push(nd === null ? null : (face(px, py, Math.floor(cx), Math.round(cy), kind) ?? shade(x, y, nd)));
    }
    out.push(row);
  }
  return out;
}

/** His rows as terminal text. Without colour he is drawn in block characters by coverage. */
export function beanRows({ face: kind = "open", lift = 0, color = true }: { face?: Face; lift?: number; color?: boolean } = {}): string[] {
  const px = beanPixels({ face: kind, lift });
  const rows: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    const top = px[2 * r]!;
    const bot = px[2 * r + 1]!;
    let s = "";
    for (let c = 0; c < PW; c++) {
      const t = top[c];
      const b = bot[c];
      if (!color) s += t && b ? "█" : t ? "▀" : b ? "▄" : " ";
      else if (!t && !b) s += `${RESET} `;
      else if (t && b) s += `${fg(t)}${bg(b)}▀`;
      else if (t) s += `${RESET}${fg(t)}▀`;
      else s += `${RESET}${fg(b!)}▄`;
    }
    rows.push(color ? `${s}${RESET}` : s);
  }
  return rows;
}

/** The floor under him: one dim row of `▀`, widest under his middle, so he stands on something. */
export function floorRow({ color = true, width = 12 }: { color?: boolean; width?: number } = {}): string {
  const pad = Math.floor((PW - width) / 2);
  if (!color) return " ".repeat(PW);
  let s = " ".repeat(pad);
  for (let i = 0; i < width; i++) {
    const k = 1 - Math.abs(((i + 0.5) / width) * 2 - 1);
    s += `${fg(mix([18, 20, 26], [58, 64, 86], Math.pow(k, 0.8)))}▀`;
  }
  return `${s}${RESET}${" ".repeat(PW - pad - width)}`;
}
