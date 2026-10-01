// Colour, by numbers (PLAN 2.1): OKLCH, the perceptual space the orb hues are made in (Björn
// Ottosson's OKLab, in polar form), sRGB, and WCAG 2.2's contrast ratio. Pure functions, so the
// design tests run on them directly and every orb hue is computed, never typed (CLAUDE.md rule 3).

export type RGB = readonly [number, number, number]; // 0..255
export type RGBA = readonly [number, number, number, number]; // alpha 0..1

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
};

/** OKLCH (L 0..1, C, h in degrees) to sRGB, unclamped: a value outside 0..255 is out of gamut. */
export function oklchToRgbRaw(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function rgbToOklch([r, g, b]: RGB): { L: number; C: number; h: number } {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

const inGamut = (c: readonly number[]): boolean => c.every((v) => v >= -0.5 && v <= 255.5);

/** The colour at this lightness and hue with as much of the asked chroma as sRGB can show. */
export function oklch(L: number, C: number, h: number): RGB {
  let lo = 0;
  let hi = C;
  if (!inGamut(oklchToRgbRaw(L, C, h))) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgbRaw(L, mid, h))) lo = mid;
      else hi = mid;
    }
  } else lo = C;
  const [r, g, b] = oklchToRgbRaw(L, lo, h);
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return [clamp(r), clamp(g), clamp(b)];
}

export function hex(c: RGB): string {
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function parseHex(s: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(s);
  if (!m) throw new Error(`not a #RRGGBB colour: ${s}`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A colour with alpha laid over an opaque one: what the eye sees of a glass layer. */
export function over([r, g, b, a]: RGBA, [R, G, B]: RGB): RGB {
  return [Math.round(r * a + R * (1 - a)), Math.round(g * a + G * (1 - a)), Math.round(b * a + B * (1 - a))];
}

/** WCAG 2.2 relative luminance. */
export function luminance([r, g, b]: RGB): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.2 contrast ratio, 1..21. */
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

export function css(c: RGB | RGBA): string {
  return c.length === 4 ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})` : hex(c);
}
