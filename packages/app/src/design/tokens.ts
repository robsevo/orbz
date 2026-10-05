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

/** A theme's base: which way it runs, and so which of each orb hue's two colours it wears. */
export type Theme = "dark" | "light";

/** Every theme you can choose (owner, 10-02: "different themes users can use besides light or dark"):
 * each a whole set of surfaces on a dark or light base, held to the same contrast checks. */
export const THEMES = {
  dark: { label: "Dark", base: "dark" },
  light: { label: "Light", base: "light" },
  midnight: { label: "Midnight", base: "dark" },
  forest: { label: "Forest", base: "dark" },
  sand: { label: "Sand", base: "light" },
  rose: { label: "Rose", base: "light" },
  contrast: { label: "High contrast", base: "dark" },
} as const satisfies Record<string, { label: string; base: Theme }>;
export type ThemeId = keyof typeof THEMES;
export const baseOf = (t: ThemeId): Theme => THEMES[t].base;

type Surfaces = {
  ground: RGB; // the page, around the app
  card: RGB; // the app's own surface (Ash's chat window: #1C1C1E, with a sheen at the top)
  side: RGB; // the sidebar: solid, not glass (owner, on Ash's chat: "the nav menu background should be solid")
  raised: RGB; // a control or the composer on the card
  fill: RGBA; // a chip, a button at rest
  fill2: RGBA; // the same, chosen or hovered
  hairline: RGBA; // the glass edge: an inset shadow, never a border line (a little stronger since 10-04: "the sections ... kind of blend in sometimes")
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

export const SURFACES: Record<ThemeId, Surfaces> = {
  dark: {
    ground: parseHex("#0E0E10"),
    card: parseHex("#1C1C1E"),
    side: parseHex("#161618"),
    raised: parseHex("#2A2A2D"),
    fill: [255, 255, 255, 0.06],
    fill2: [255, 255, 255, 0.12],
    hairline: [255, 255, 255, 0.18],
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
    hairline: [0, 0, 0, 0.15],
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
  // deep navy, the night sky over the office
  midnight: {
    ground: parseHex("#090D1A"), card: parseHex("#121A2E"), side: parseHex("#0E1526"), raised: parseHex("#1C2640"),
    fill: [190, 210, 255, 0.07], fill2: [190, 210, 255, 0.13], hairline: [190, 210, 255, 0.19], sep: [190, 210, 255, 0.07],
    shadow: [0, 0, 8, 0.45], scrim: [0, 0, 8, 0.6],
    text1: parseHex("#F1F5FF"), text2: parseHex("#DCE3F5"), text3: parseHex("#9DABC9"), quiet: parseHex("#55617F"),
    alert: parseHex("#D6A45E"), ok: parseHex("#3DDC84"), busy: parseHex("#FFD60A"), off: parseHex("#FF5A5F"),
  },
  // deep green, a plant in the corner
  forest: {
    ground: parseHex("#0A120E"), card: parseHex("#15201A"), side: parseHex("#101914"), raised: parseHex("#1F2D25"),
    fill: [200, 255, 220, 0.06], fill2: [200, 255, 220, 0.12], hairline: [200, 255, 220, 0.18], sep: [200, 255, 220, 0.06],
    shadow: [0, 6, 2, 0.42], scrim: [0, 6, 2, 0.58],
    text1: parseHex("#F0F7F2"), text2: parseHex("#DCE8E0"), text3: parseHex("#99B0A2"), quiet: parseHex("#587063"),
    alert: parseHex("#D2A25A"), ok: parseHex("#4ADE80"), busy: parseHex("#FACC15"), off: parseHex("#FF6B5E"),
  },
  // warm paper
  sand: {
    ground: parseHex("#EEE8DC"), card: parseHex("#FCF9F3"), side: parseHex("#F4EEE3"), raised: parseHex("#F1EADE"),
    fill: [60, 40, 10, 0.06], fill2: [60, 40, 10, 0.1], hairline: [60, 40, 10, 0.17], sep: [60, 40, 10, 0.07],
    shadow: [40, 25, 0, 0.12], scrim: [30, 20, 0, 0.32],
    text1: parseHex("#2A2117"), text2: parseHex("#40352A"), text3: parseHex("#685A49"), quiet: parseHex("#B7A992"),
    alert: parseHex("#87561A"), ok: parseHex("#2D7A32"), busy: parseHex("#865A00"), off: parseHex("#B3261E"),
  },
  // soft pink
  rose: {
    ground: parseHex("#EFE1E6"), card: parseHex("#FFF8FA"), side: parseHex("#F8ECF0"), raised: parseHex("#F5E6EB"),
    fill: [90, 20, 45, 0.05], fill2: [90, 20, 45, 0.09], hairline: [90, 20, 45, 0.16], sep: [90, 20, 45, 0.06],
    shadow: [60, 0, 20, 0.1], scrim: [50, 0, 20, 0.3],
    text1: parseHex("#2B1820"), text2: parseHex("#452E38"), text3: parseHex("#6E5260"), quiet: parseHex("#C1A6B1"),
    alert: parseHex("#8A4E1E"), ok: parseHex("#22783A"), busy: parseHex("#835700"), off: parseHex("#B4233C"),
  },
  // black and white, for reading most easily
  contrast: {
    ground: parseHex("#000000"), card: parseHex("#0A0A0A"), side: parseHex("#000000"), raised: parseHex("#1A1A1A"),
    fill: [255, 255, 255, 0.1], fill2: [255, 255, 255, 0.18], hairline: [255, 255, 255, 0.45], sep: [255, 255, 255, 0.3],
    shadow: [0, 0, 0, 0.6], scrim: [0, 0, 0, 0.75],
    text1: parseHex("#FFFFFF"), text2: parseHex("#FFFFFF"), text3: parseHex("#D0D0D6"), quiet: parseHex("#6E6E76"),
    alert: parseHex("#FFC266"), ok: parseHex("#4CFF7A"), busy: parseHex("#FFE14D"), off: parseHex("#FF6B6B"),
  },
};

/** What text sits on: every surface, a chip's fill laid over the card included. */
export function backgrounds(t: ThemeId): Record<"ground" | "card" | "side" | "raised" | "chip", RGB> {
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

/** The Orbz mark (brand/mark.ts; owner, 10-04: "a simpler logo ... something that fits with the crowd ... use the
 * O and the shape of an orb ... keep the app color"): the O as an orb, in Ash's azure, lit like the orbs' glass,
 * on the app's own charcoal. */
export const MARK = {
  light: "#c4e6f7", // the top of the ring, where the light falls
  mid: hex(AZURE),
  deep: "#2a76a6", // its foot
  glow: "rgba(94, 179, 222, 0.38)", // the light inside the O
  none: "rgba(94, 179, 222, 0)",
  eye: "#f4faff",
  shine: "#ffffff",
  white: "#ffffff", // the one-colour mark
  ground: "#0e0e10", // the app's ground (dark), and its raised glass
  raised: "#26272b",
} as const;

/** What an orb's things are made of, besides his own colour (a hat's band, a crown, a sprout). */
export const MATERIALS = {
  ink: parseHex("#2B2C30"),
  cream: parseHex("#EFEBE2"),
  steel: parseHex("#A9B2BC"),
  leaf: parseHex("#7DC27A"),
  gold: parseHex("#D9AE55"),
  shade: parseHex("#14161C"), // a sunglass lens: near black, a breath of blue
  rose: parseHex("#E8708A"), // heart glasses are pink whatever colour he is
  white: parseHex("#F4F4F6"), // a hat or frames in white or black (owner, 10-03), lit like the rest
  black: parseHex("#17181B"),
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

function themeVars(t: ThemeId): string {
  const s = SURFACES[t];
  const base = baseOf(t);
  const v: Record<string, string> = { "--accent": hex(HUES[0]![base]) }; // Ash's, where no orb is named
  for (const [k, c] of Object.entries(s)) v[`--${k.replace(/(\d)/, "-$1")}`] = css(c);
  return Object.entries(v).map(([k, x]) => `${k}: ${x};`).join(" ") + " " + accentVars(HUES[0]![base], base);
}

/** An orb's colour and what is made of it: the wash behind your messages, a chosen control's fill, his glow. */
function accentVars(c: RGB, t: Theme): string {
  const [r, g, b] = c;
  const wash = t === "dark" ? 0.2 : 0.14;
  const fill = t === "dark" ? 0.28 : 0.2;
  return `--accent: ${hex(c)}; --accent-wash: rgba(${r}, ${g}, ${b}, ${wash}); --accent-fill: rgba(${r}, ${g}, ${b}, ${fill}); --accent-glow: rgba(${r}, ${g}, ${b}, 0.45);`;
}

/** A QR code's two colours, the same in both themes: a reader wants dark on light, with its margin (PLAN 2.7). */
export const QR_COLOURS = { ink: parseHex("#121214"), paper: parseHex("#FFFFFF") } as const;

function staticVars(): string {
  const v: Record<string, string> = { "--margin": `${MARGIN}px`, "--font": FONT, "--mono": MONO, "--qr-ink": hex(QR_COLOURS.ink), "--qr-paper": hex(QR_COLOURS.paper) };
  // the app's icon (owner, 10-04: "make the phone app logo much more addicting to want to press and see, it should
  // make you happy to see in your phone"): a sunny sky behind the orbs, a glow, sparkles
  // the light of an orb changing (Roll everything, owner 10-04): its glow, the flash and the sparks, the same in every theme
  Object.assign(v, { "--flash": "#ffffff", "--flash-glow": "rgba(255, 255, 255, 0.9)", "--flash-mid": "rgba(255, 255, 255, 0.55)", "--flash-none": "rgba(255, 255, 255, 0)" });
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

/** The whole stylesheet: the font, every theme (the system's light or dark when none is chosen, or
 * `data-theme`), the base. */
export function stylesheet(fontUrl = "fonts/Nunito.ttf"): string {
  const chosen = (Object.keys(THEMES) as ThemeId[]).flatMap((t) => [
    `:root[data-theme="${t}"] { color-scheme: ${baseOf(t)}; ${themeVars(t)} }`,
    hueRules(baseOf(t), `:root[data-theme="${t}"] `),
  ]);
  return [
    `@font-face { font-family: "Nunito"; src: url("${fontUrl}") format("truetype"); font-weight: 200 1000; font-display: swap; }`,
    `:root { color-scheme: dark; ${staticVars()} ${themeVars("dark")} }`,
    `@media (prefers-color-scheme: light) { :root:not([data-theme]) { color-scheme: light; ${themeVars("light")} } }`,
    hueRules("dark", ""),
    `@media (prefers-color-scheme: light) { ${hueRules("light", ":root:not([data-theme]) ")} }`,
    ...chosen,
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
    // a row that scrolls sideways clips up and down too: room above and below for a press's lift and a pick's
    // bounce (owner, 10-04: "when hovering on buttons ... most of em get cut off as the animate to get bigger"),
    // taken back by the margin so the layout does not move
    `.one-line { padding-block: 6px; margin-block: -6px; }`,
    // on a phone, a container with too much in it scrolls inside itself (owner, 10-04: "if theres too much info in
    // any container, make it scrollable"), a fade where there is more (ui/Balanced.tsx Tall)
    `@media (max-width: 760px) { .orbs-tall { max-height: var(--tall, 48dvh); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-gutter: stable; padding: 6px 14px 6px 0; margin-right: -6px; } }`,
    // wherever a tall box scrolls (a phone; the card beside the creator on a wide screen), the fade says there is more
    `.orbs-tall[data-more="down"] { mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent); }`,
    `.orbs-tall[data-more="up"] { mask-image: linear-gradient(to top, #000 calc(100% - 36px), transparent); }`,
    `.orbs-tall[data-more="up down"] { mask-image: linear-gradient(to bottom, transparent, #000 36px, #000 calc(100% - 36px), transparent); }`,
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
    // a move pressed in the creator lights up and fades back (owner, 10-03); two names, so a second press starts it again
    `@keyframes orbs-flash-a { from { background-color: var(--accent-fill); box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--text-1); } }`,
    `@keyframes orbs-flash-b { from { background-color: var(--accent-fill); box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--text-1); } }`,
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
