// The app's icon (PLAN 2.7, installable; owner, 10-03: "make the desktop icon please, make it nice. not
// like the widget one, different"; 10-04: "make the phone app logo much more addicting to want to press
// and see, it should make you happy to see in your phone"): the office, happy to see you. Ash in front
// with happy eyes, a mint kitty winking and a violet teddy mid-hop behind him, real orbs drawn still by
// the real renderer, each holding its happiest moment (`pose`), on a sunny sky with a glow behind them
// and a few sparkles, and ORBZ across it in Nunito Black, extruded (owner, 10-04: "add our own font on the
// logo saying ORBZ accross it ... 3d ish, hip"); `&text=0` leaves the word off (the title bar's sizes). `icon.html?size=512&pad=0.06` is the rounded card with clear corners (an "any"
// icon, and the desktop's); `&bleed=1` fills the square to its edges with the orbs in its safe middle
// (a maskable icon, which the phone cuts to its own shape, and an iPhone's, which rounds it itself).
// `tools/shoot_icons.ts` takes the pictures.
// Not part of the app's build.
import { createRoot } from "react-dom/client";
import { stylesheet } from "./design/tokens.ts";
import { Orb } from "./orb/Orb.tsx";
import type { Gesture } from "./orb/life.ts";
import { ASH, type Character } from "./orb/spec.ts";

const q = new URLSearchParams(location.search);
const size = Number(q.get("size") ?? 512);
const pad = Number(q.get("pad") ?? 0.06);
const bleed = q.get("bleed") === "1";
const style = document.createElement("style");
style.textContent = `${stylesheet(`${import.meta.env.BASE_URL}fonts/Nunito.ttf`)} html, body { margin: 0; overflow: hidden; background: transparent; }`;
document.head.append(style);

/** Who is on the icon, where (the middle of each, in fractions of the card), how big, and the moment each holds. */
const words = q.get("text") !== "0"; // the wordmark (the title bar's tiny sizes are drawn without it)
const TEAM: { c: Character; x: number; y: number; s: number; pose: { gesture: Gesture; into: number }; turn?: number }[] = words
  ? [
      { c: { ...ASH, name: "Pip", hue: "mint", shape: "kitty", eyes: "big", finish: "neon" }, x: 0.25, y: 0.27, s: 0.42, pose: { gesture: "wink", into: 0.36 }, turn: -8 },
      { c: { ...ASH, name: "Bo", hue: "iris", shape: "teddy", eyes: "big", finish: "neon" }, x: 0.75, y: 0.25, s: 0.42, pose: { gesture: "squish", into: 0.4 }, turn: 8 },
      { c: { ...ASH, eyes: "big", finish: "neon" }, x: 0.5, y: 0.45, s: 0.58, pose: { gesture: "squish", into: 0.4 } },
    ]
  : [
      { c: { ...ASH, name: "Pip", hue: "mint", shape: "kitty", eyes: "big", finish: "neon" }, x: 0.27, y: 0.37, s: 0.48, pose: { gesture: "wink", into: 0.36 }, turn: -8 },
      { c: { ...ASH, name: "Bo", hue: "iris", shape: "teddy", eyes: "big", finish: "neon" }, x: 0.73, y: 0.35, s: 0.48, pose: { gesture: "squish", into: 0.4 }, turn: 8 },
      { c: { ...ASH, eyes: "big", finish: "neon" }, x: 0.5, y: 0.6, s: 0.68, pose: { gesture: "squish", into: 0.4 } },
    ];
/** ORBZ as bubble letters (owner, 10-04: "make the writing on the orbs logo more bubbly"): Nunito Black
 * puffed out by a thick stroke of its own colour with round joins (an SVG text's stroke can be round; a
 * CSS text outline cannot), a dark rim round it, a plum extrusion stepping down and right, a white-to-gold
 * face and a gloss along the top. */
function Wordmark({ size }: { size: number }) {
  const W = 1000;
  const H = 340;
  const fs = 250; // the letters, in the drawing's units
  const puff = 20; // how far each letter is blown up (past about 24 the O, R and B close up)
  const rim = 12; // the dark line round it all
  const at = { x: W / 2, y: 238, textAnchor: "middle", style: { font: `900 ${fs}px var(--font)`, letterSpacing: "10px" } } as const;
  const round = { strokeLinejoin: "round", strokeLinecap: "round" } as const;
  const depth = Array.from({ length: 10 }, (_, k) => k + 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={size * 1.36} style={{ display: "block", overflow: "visible", transform: "rotate(-5deg)", filter: `drop-shadow(0 ${size * 0.07}px ${size * 0.06}px var(--icon-drop))` }}>
      <defs>
        <linearGradient id="orbz-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.12" stopColor="var(--icon-face-top)" />
          <stop offset="0.55" stopColor="var(--icon-face-mid)" />
          <stop offset="0.92" stopColor="var(--icon-face-low)" />
        </linearGradient>
      </defs>
      {/* the deepest step's rim, then the extrusion stepping down and right */}
      <text {...at} x={W / 2 + 10 * 3.2} y={238 + 10 * 4.4} fill="var(--icon-outline)" stroke="var(--icon-outline)" strokeWidth={puff + rim * 2} {...round}>ORBZ</text>
      {depth.reverse().map((k) => (
        <text key={k} {...at} x={W / 2 + k * 3.2} y={238 + k * 4.4} fill="var(--icon-extrude)" stroke="var(--icon-extrude)" strokeWidth={puff} {...round}>ORBZ</text>
      ))}
      {/* the face's rim, the puffed face, and its gloss */}
      <text {...at} fill="var(--icon-outline)" stroke="var(--icon-outline)" strokeWidth={puff + rim * 2} {...round}>ORBZ</text>
      <text {...at} fill="url(#orbz-face)" stroke="url(#orbz-face)" strokeWidth={puff} {...round}>ORBZ</text>
      <text {...at} y={238 - 34} fill="none" stroke="var(--icon-face-top)" strokeOpacity={0.7} strokeWidth={10} {...round} style={{ ...at.style, clipPath: "inset(0 0 62% 0)" }}>ORBZ</text>
    </svg>
  );
}
/** The sparkles: where (fractions of the card) and how big (of the card). */
const SPARKS: [number, number, number][] = [[0.13, 0.14, 0.085], [0.86, 0.12, 0.06], [0.9, 0.62, 0.075], [0.09, 0.66, 0.05], [0.66, 0.08, 0.04]];
const SPARK = "M0 -1 C.13 -.27 .27 -.13 1 0 C.27 .13 .13 .27 0 1 C-.13 .27 -.27 .13 -1 0 C-.27 -.13 -.13 -.27 0 -1 Z";

const card = bleed ? size : Math.round(size * (1 - 2 * pad)); // the card's side
// where the orbs go: a maskable icon keeps them in its middle 80%; an iPhone's (`&room=0.88`), which only
// rounds the corners, a little more
const room = bleed ? size * Number(q.get("room") ?? 0.8) : card;
createRoot(document.getElementById("root")!).render(
  <div data-icon style={{ width: size, height: size, display: "grid", placeItems: "center" }}>
    <div style={{
      position: "relative", width: card, height: card, borderRadius: bleed ? 0 : card * 0.225, overflow: "hidden",
      // a sunny sky: bright up top, warm, then a pink evening at the bottom corner; a glow behind the orbs
      background: "radial-gradient(48% 44% at 50% 52%, var(--icon-glow) 0%, var(--icon-glow-none) 100%), radial-gradient(140% 120% at 22% 0%, var(--icon-sun) 0%, var(--icon-warm) 48%, var(--icon-hot) 82%, var(--icon-deep) 120%)",
    }}>
      {SPARKS.map(([x, y, s], i) => (
        <svg key={i} viewBox="-1 -1 2 2" style={{ position: "absolute", left: (x - s / 2) * card, top: (y - s / 2) * card, width: s * card, height: s * card, overflow: "visible", filter: `drop-shadow(0 0 ${s * card * 0.25}px var(--icon-spark))` }}>
          <path d={SPARK} fill="var(--icon-spark)" />
        </svg>
      ))}
      {TEAM.map(({ c, x, y, s, pose, turn }) => (
        <div key={c.name} data-orb={c.hue} style={{ position: "absolute", left: (card - room) / 2 + x * room, top: (card - room) / 2 + y * room, transform: `translate(-50%, -50%) rotate(${turn ?? 0}deg)` }}>
          <Orb character={c} size={Math.round(s * room)} still poke={false} fidget={false} framing="portrait" tint={1} pose={pose} />
        </div>
      ))}
      {words && (
        <div style={{ position: "absolute", left: (card - room) / 2, width: room, top: (card - room) / 2 + room * 0.67 }}>
          <Wordmark size={Math.round(room * 0.22)} />
        </div>
      )}
    </div>
  </div>,
);
