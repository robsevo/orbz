// The design system (PLAN 2.1): the frontend standard as tokens, and the only place in the app a
// colour may be written (the token lint holds every other file to it).
//
//   the house look   near-black ground, one glass card (7% cool grey) with a half-pixel inset
//                    hairline instead of a border line; Apple's quiet label greys; no glow
//   one accent       each orb's colour, and nothing else, used only where it means something
//   the grid         8 points, 16 margins, a 22 radius on cards
//   type             Nunito (the orb's own rounded face, SIL OFL), Apple's scale, tabular numerals
//   motion           chartlive's slow physical curve, and the snap's spring
//   both themes      dark first; light from the same roles; phone first
//
// The values come from what the owner approved: `~/ash-templates/chartlive` (the ground, the glass
// fill, the azure) and the orb's widgets (`orb/shell/panels/panel.css`: the greys, the inset hairline,
// the amber kept for alerts, Nunito). The twelve orb hues are computed, not typed: one lightness and
// chroma (azure's own, so Ash keeps his colour) turned round the wheel in OKLCH, and in light mode the
// lightness each hue needs to read on white.
import { contrast, css, hex, oklch, over, parseHex, rgbToOklch, type RGB, type RGBA } from "./color.ts";

export type Theme = "dark" | "light";

type Surfaces = {
  ground: RGB; // the page, around the app
  card: RGB; // the app's own surface (Ash's chat window: #1C1C1E, with a sheen at the top)
  side: RGB; // the sidebar: solid, not glass (owner, on Ash's chat: "the nav menu background should be solid")
  raised: RGB; // a control or the composer on the card
  fill: RGBA; // a chip, a button at rest
  fill2: RGBA; // the same, chosen or hovered
  hairline: RGBA; // the glass edge: an inset shadow, never a border line
  sep: RGBA; // the one line Ash draws, between the sidebar and the chat
  shadow: RGBA;
  scrim: RGBA;
  text1: RGB; // titles, names
  text2: RGB; // what you read (Ash's --lit)
  text3: RGB; // secondary (Ash's steel, --cy)
  quiet: RGB; // non-text only: rules, disabled controls (Ash's --cy-dim)
  alert: RGB; // something needs you (Ash's amber, "alerts only")
  ok: RGB; // awake (Ash's status dot)
  busy: RGB; // thinking
  off: RGB; // asleep
};

export const SURFACES: Record<Theme, Surfaces> = {
  dark: {
    ground: parseHex("#0E0E10"),
    card: parseHex("#1C1C1E"),
    side: parseHex("#161618"),
    raised: parseHex("#2A2A2D"),
    fill: [255, 255, 255, 0.06],
    fill2: [255, 255, 255, 0.12],
    hairline: [255, 255, 255, 0.12],
    sep: [255, 255, 255, 0.06],
    shadow: [0, 0, 0, 0.38],
    scrim: [0, 0, 0, 0.55],
    text1: parseHex("#F5F5F7"),
    text2: parseHex("#E5E5EA"),
    text3: parseHex("#98A3AF"),
    quiet: parseHex("#5F6A77"),
    alert: parseHex("#BF8B49"),
    ok: parseHex("#34C759"),
    busy: parseHex("#FFD60A"),
    off: parseHex("#FF453A"),
  },
  light: {
    ground: parseHex("#E9E9EE"),
    card: parseHex("#FFFFFF"),
    side: parseHex("#F2F2F7"),
    raised: parseHex("#EFEFF3"),
    fill: [0, 0, 0, 0.05],
    fill2: [0, 0, 0, 0.09],
    hairline: [0, 0, 0, 0.1],
    sep: [0, 0, 0, 0.06],
    shadow: [0, 0, 0, 0.1],
    scrim: [0, 0, 0, 0.3],
    text1: parseHex("#1D1D1F"),
    text2: parseHex("#3A3A3C"),
    text3: parseHex("#636369"),
    quiet: parseHex("#AEAEB2"),
    alert: parseHex("#865920"),
    ok: parseHex("#1F7A35"),
    busy: parseHex("#8A5A00"),
    off: parseHex("#C4182B"),
  },
};

/** What text sits on: every surface, a chip's fill laid over the card included. */
export function backgrounds(t: Theme): Record<"ground" | "card" | "side" | "raised" | "chip", RGB> {
  const s = SURFACES[t];
  return { ground: s.ground, card: s.card, side: s.side, raised: s.raised, chip: over(s.fill2, s.card) };
}

// ── the orb hues ──────────────────────────────────────────────────────────────────────────────

export const AZURE = parseHex("#5EB3DE"); // chartlive's azure: Ash's colour
// 24, 15° apart round the wheel from Ash's azure (owner, 2026-10-01: "a lot of choices for colors")
const NAMES = [
  "azure", "cornflower", "iris", "lavender", "violet", "plum", "orchid", "pink", "rose", "blush", "coral", "apricot",
  "amber", "marigold", "honey", "citron", "lime", "clover", "leaf", "jade", "mint", "seafoam", "teal", "cyan",
] as const;
export const HUE_STEP = 360 / NAMES.length;
export type HueName = (typeof NAMES)[number];
export type Hue = { name: HueName; angle: number; dark: RGB; light: RGB };

/** The lightest a hue may be in light mode and still read as text (AA) on every light surface. */
const LIGHT_TARGET = 4.8;

function lightFor(angle: number, chroma: number): RGB {
  const bg = backgrounds("light");
  const worst = (c: RGB): number => Math.min(contrast(c, bg.ground), contrast(c, bg.card), contrast(c, bg.raised));
  let lo = 0.25;
  let hi = 0.75;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (worst(oklch(mid, chroma, angle)) >= LIGHT_TARGET) lo = mid;
    else hi = mid;
  }
  return oklch(lo, chroma, angle);
}

export const HUES: Hue[] = (() => {
  const a = rgbToOklch(AZURE);
  return NAMES.map((name, i) => {
    const angle = (a.h + i * HUE_STEP) % 360;
    return { name, angle, dark: i === 0 ? AZURE : oklch(a.L, a.C, angle), light: lightFor(angle, a.C * 1.15) };
  });
})();

export const hue = (name: HueName): Hue => HUES.find((h) => h.name === name)!;

/** What an orb's things are made of, besides his own colour (a hat's band, a crown, a sprout). */
export const MATERIALS = {
  ink: parseHex("#2B2C30"),
  cream: parseHex("#EFEBE2"),
  steel: parseHex("#A9B2BC"),
  leaf: parseHex("#7DC27A"),
  gold: parseHex("#D9AE55"),
  shade: parseHex("#14161C"), // a sunglass lens: near black, a breath of blue
  rose: parseHex("#E8708A"), // heart glasses are pink whatever colour he is
} as const;
export type Material = keyof typeof MATERIALS;

// ── the grid, the type, the motion ────────────────────────────────────────────────────────────

export const SPACE = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 } as const;
export const MARGIN = 16;
export const RADIUS = { card: 22, inner: 14, control: 12, pill: 999 } as const;

/** Apple's text styles (the Large size): px size, px line height, weight. The floor is 11, over the house minimum of 10. */
export const TYPE = {
  caption2: [11, 13, 400],
  caption: [12, 16, 400],
  footnote: [13, 18, 400],
  subhead: [15, 20, 400],
  callout: [16, 21, 400],
  body: [17, 22, 400],
  headline: [17, 22, 700],
  title3: [20, 25, 600],
  title2: [22, 28, 700],
  title1: [28, 34, 700],
  large: [34, 41, 800],
} as const;
export type TypeStyle = keyof typeof TYPE;
export const MIN_FONT = 10;

export const FONT = `"Nunito", "Adwaita Sans", Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
export const MONO = `"JetBrains Mono", "Adwaita Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

export const MOTION = {
  physical: "cubic-bezier(.22,.61,.36,1)", // chartlive's draw-in: slow and settling
  spring: "cubic-bezier(.34,1.4,.5,1)", // the snap: a little past, then back
  fast: "160ms",
  base: "250ms",
  slow: "460ms",
  draw: "1100ms",
} as const;

// ── as CSS ────────────────────────────────────────────────────────────────────────────────────

function themeVars(t: Theme): string {
  const s = SURFACES[t];
  const v: Record<string, string> = { "--accent": hex(t === "dark" ? HUES[0]!.dark : HUES[0]!.light) }; // Ash's, where no orb is named
  for (const [k, c] of Object.entries(s)) v[`--${k.replace(/(\d)/, "-$1")}`] = css(c);
  return Object.entries(v).map(([k, x]) => `${k}: ${x};`).join(" ") + " " + accentVars(t === "dark" ? HUES[0]!.dark : HUES[0]!.light, t);
}

/** An orb's colour and what is made of it: the wash behind your messages, a chosen control's fill, his glow. */
function accentVars(c: RGB, t: Theme): string {
  const [r, g, b] = c;
  const wash = t === "dark" ? 0.2 : 0.14;
  const fill = t === "dark" ? 0.28 : 0.2;
  return `--accent: ${hex(c)}; --accent-wash: rgba(${r}, ${g}, ${b}, ${wash}); --accent-fill: rgba(${r}, ${g}, ${b}, ${fill}); --accent-glow: rgba(${r}, ${g}, ${b}, 0.45);`;
}

function staticVars(): string {
  const v: Record<string, string> = { "--margin": `${MARGIN}px`, "--font": FONT, "--mono": MONO };
  for (const [k, px] of Object.entries(SPACE)) v[`--s${k}`] = `${px}px`;
  for (const [k, px] of Object.entries(RADIUS)) v[`--r-${k}`] = `${px}px`;
  for (const [k, [size, line, weight]] of Object.entries(TYPE)) v[`--t-${k}`] = `${weight} ${size}px/${line}px ${FONT}`;
  for (const [k, x] of Object.entries(MOTION)) v[`--m-${k}`] = x;
  return Object.entries(v).map(([k, x]) => `${k}: ${x};`).join(" ");
}

/** An orb's colour is set by naming the orb: `data-orb="coral"` on its element gives everything in
 * it `--accent`, in the theme of the moment. (A variable set on :root from another variable is
 * resolved once, on :root, so it cannot follow an orb's own value: each hue gets its own rule.) */
export const orbAttr = (h: Hue): { "data-orb": HueName } => ({ "data-orb": h.name });

function hueRules(t: Theme, scope: string): string {
  return HUES.map((h) => `${scope}[data-orb="${h.name}"] { ${accentVars(h[t], t)} }`).join(" ");
}

/** The whole stylesheet: the font, both themes (by the system setting, or `data-theme`), the base. */
export function stylesheet(fontUrl = "fonts/Nunito.ttf"): string {
  return [
    `@font-face { font-family: "Nunito"; src: url("${fontUrl}") format("truetype"); font-weight: 200 1000; font-display: swap; }`,
    `:root { color-scheme: dark; ${staticVars()} ${themeVars("dark")} }`,
    `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { color-scheme: light; ${themeVars("light")} } }`,
    `:root[data-theme="light"] { color-scheme: light; ${themeVars("light")} }`,
    `:root[data-theme="dark"] { color-scheme: dark; ${themeVars("dark")} }`,
    hueRules("dark", ""),
    `@media (prefers-color-scheme: light) { ${hueRules("light", ':root:not([data-theme="dark"]) ')} }`,
    hueRules("light", ':root[data-theme="light"] '),
    `*, *::before, *::after { box-sizing: border-box; }`,
    `html, body { margin: 0; background: var(--ground); color: var(--text-2); font: var(--t-body); -webkit-font-smoothing: antialiased; text-size-adjust: 100%; }`,
    `body { overflow-x: hidden; text-wrap: pretty; }`,
    // titles, labels and anything in a button wrap balanced: no word left alone on a last line
    `h1, h2, h3, h4, button, label { text-wrap: balance; }`,
    `.one-line > * { flex: 0 0 auto; }`,
    `.one-line::-webkit-scrollbar { display: none; }`,
    // a row that scrolls fades out at the edge where there is more (ui/Balanced.tsx useMore)
    `.one-line[data-more="right"] { mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }`,
    `.one-line[data-more="left"] { mask-image: linear-gradient(to left, #000 calc(100% - 28px), transparent); }`,
    `.one-line[data-more="left right"] { mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent); }`,
    `.num { font-variant-numeric: tabular-nums; }`,
    // a press you can feel (owner, 10-01): down it squishes at once, up it springs back past where
    // it was; a thing just chosen bounces. The press is `translate` and `scale`, the bounce is
    // `transform`, so the two add up instead of one cancelling the other.
    `button { transition: translate var(--m-base) var(--m-spring), scale var(--m-base) var(--m-spring), background-color var(--m-fast) ease, box-shadow var(--m-fast) ease, color var(--m-fast) ease; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }`,
    `@media (hover: hover) { button:hover:not(:disabled) { translate: 0 -1px; } }`,
    `button:active:not(:disabled) { translate: 0 1px; scale: .94; transition-duration: 70ms; transition-timing-function: ease-out; }`,
    `button[aria-pressed="true"] { animation: orbs-picked 420ms var(--m-spring); }`,
    `@keyframes orbs-picked { 0% { transform: scale(.9); } 60% { transform: scale(1.05); } 100% { transform: none; } }`,
    `@keyframes orbs-roll { 0% { rotate: 0deg; scale: 1; } 45% { scale: 1.3; } 100% { rotate: 360deg; scale: 1; } }`,
    `@keyframes orbs-arrive { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: none; } }`,
    `@keyframes orbs-leave { to { transform: scale(.5); opacity: 0; } }`,
    `@keyframes orbs-fact { from { opacity: 0; translate: 0 4px; } to { opacity: 1; translate: none; } }`,
    `@keyframes orbs-stamp { 0% { transform: scale(1.8) rotate(-8deg); opacity: 0; } 55% { transform: scale(.94) rotate(1deg); opacity: 1; } 100% { transform: none; } }`,
    `@keyframes orbs-nudge { 0%, 100% { translate: 0 0; } 50% { translate: 0 3px; } }`,
    // a page of choices slides in from the side you went (ui/Paged.tsx)
    `@keyframes orbs-page-on { from { translate: 28px 0; opacity: 0; } to { translate: none; opacity: 1; } }`,
    `@keyframes orbs-page-back { from { translate: -28px 0; opacity: 0; } to { translate: none; opacity: 1; } }`,
    // the CEO badge: a glint across its gold, and a slow sway on its ribbon (onboarding/Onboarding.tsx)
    `@keyframes orbs-glint { 0%, 55% { background-position: 160% 0; } 85%, 100% { background-position: -60% 0; } }`,
    `@keyframes orbs-sway { 0%, 100% { rotate: -2deg; } 50% { rotate: 2deg; } }`,
    // his computer (rooms/Computer.tsx): a ring where his step lands; a bar growing to its number
    `@keyframes orbs-click { from { scale: .5; opacity: 1; } to { scale: 1.5; opacity: 0; } }`,
    `@keyframes orbs-grow { from { transform: scaleX(0); } to { transform: none; } }`,
    `@keyframes orbs-twinkle { 0%, 100% { scale: .4; opacity: .2; } 50% { scale: 1; opacity: 1; } }`,
    `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }`,
  ].join("\n");
}
