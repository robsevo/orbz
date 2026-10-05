// The Orbz mark (owner, 10-04: "we need a simpler logo for our app logo and mobile logos, something that fits
// with 'the crowd'. a simple logo set we can use. use the O and the shape of an orb somehow and keep the app
// color"): the O of Orbz drawn as an orb. A thick ring in Ash's azure, lit like the orbs' glass (light at
// its top, deeper at its foot, one white highlight up and left), a soft light inside it, and the orbs' two
// eyes; on the app's own charcoal. Flat and bold, so it reads at a home screen's size and at a tab's.
// One drawing, as SVG text: the app's icons (icon.tsx), and the files to use anywhere (tools/shoot_icons.ts
// writes public/brand/). Its colours are the tokens' (design/tokens.ts MARK).
import { MARK } from "../design/tokens.ts";

export type MarkOptions = {
  /** The orbs' two eyes in the O (left off where they would be a pixel: a tab's icon). */
  eyes?: boolean;
  /** A background: the app's charcoal card (rounded, its corners clear), edge to edge, or none. */
  ground?: "card" | "bleed" | "none";
  /** All of it in one colour (white), for a dark photo or a print in one ink. */
  mono?: boolean;
  /** How much of the square the O takes (its outer edge), from its middle: 0.62 by default. */
  scale?: number;
};

/** The mark as an SVG document (viewBox 0 0 100 100). */
export function markSvg(o: MarkOptions = {}): string {
  const { eyes = true, ground = "none", mono = false, scale = 0.62 } = o;
  const R = 50 * scale; // the O's outer edge
  // the O is an egg, as the orbs are (owner, 10-04: "make the logo on orbs look more like a pear or egg, and
  // thinner"): a little wider below its middle than above, the hole the same shape, three quarters across
  const a = R * 0.86; // its half-width
  const b = R * 1.05; // its half-height
  const k = 0.16; // how much wider it is low than high
  const hole = 0.74;
  const cx = 50;
  const cy = 50;
  const at = (t: number, f = 1): [number, number] => [cx + f * a * Math.cos(t) * (1 + k * Math.sin(t)), cy + f * b * Math.sin(t)];
  const egg = (f: number): string => {
    const pts = Array.from({ length: 96 }, (_, i) => at((i / 96) * 2 * Math.PI, f));
    return `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
  };
  const ink = (c: string): string => (mono ? MARK.white : c);
  const bg =
    ground === "none"
      ? ""
      : `<rect width="100" height="100" ${ground === "card" ? 'rx="22.5"' : ""} fill="url(#g)"/><rect width="100" height="100" ${ground === "card" ? 'rx="22.5"' : ""} fill="url(#w)"/>`;
  const eyesSvg = eyes
    ? [-1, 1].map((s) => `<rect x="${(cx + s * R * 0.2 - R * 0.064).toFixed(2)}" y="${(cy + R * 0.06 - R * 0.13).toFixed(2)}" width="${(R * 0.128).toFixed(2)}" height="${(R * 0.26).toFixed(2)}" rx="${(R * 0.064).toFixed(2)}" fill="${ink(MARK.eye)}"/>`).join("") // sized by the O, a little low in it
    : "";
  const [hx, hy] = at(-2.25, (1 + hole) / 2); // the highlight, on the ring, up and to the left
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
    `<defs>`,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${MARK.raised}"/><stop offset="0.85" stop-color="${MARK.ground}"/></linearGradient>`,
    `<radialGradient id="w" cx="0.5" cy="0.32" r="0.6"><stop offset="0" stop-color="${MARK.glow}"/><stop offset="1" stop-color="${MARK.none}"/></radialGradient>`,
    `<linearGradient id="o" x1="0.25" y1="0.05" x2="0.75" y2="0.95"><stop offset="0" stop-color="${ink(MARK.light)}"/><stop offset="0.5" stop-color="${ink(MARK.mid)}"/><stop offset="1" stop-color="${ink(MARK.deep)}"/></linearGradient>`,
    `<radialGradient id="i" cx="0.5" cy="0.55" r="0.5"><stop offset="0" stop-color="${mono ? MARK.none : MARK.glow}"/><stop offset="1" stop-color="${MARK.none}"/></radialGradient>`,
    `</defs>`,
    bg,
    // the light inside the O, then the ring (an O: the outer circle less the hole)
    `<path d="${egg(hole)}" fill="url(#i)"/>`,
    `<path fill="url(#o)" fill-rule="evenodd" d="${egg(1)}${egg(hole)}"/>`,
    // the one hard highlight of the orbs' glass, up and to the left on the ring
    mono ? "" : `<ellipse cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" rx="${(R * 0.17).toFixed(2)}" ry="${(R * 0.075).toFixed(2)}" transform="rotate(-42 ${hx.toFixed(2)} ${hy.toFixed(2)})" fill="${MARK.shine}" fill-opacity="0.85"/>`,
    eyesSvg,
    `</svg>`,
  ].join("");
}
