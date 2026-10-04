// The app's icon (PLAN 2.7, installable; owner, 10-03: "make the desktop icon please, make it nice. not
// like the widget one, different"): the office, not one orb. Ash in front, a pink kitty and a
// honey teddy behind him (Neon, so their colours hold at a dock's size), real orbs drawn still by the real renderer, on the app's own glass
// card. `icon.html?size=512&pad=0.06` is the rounded card with clear corners (an "any" icon, and
// the desktop's); `&bleed=1` fills the square to its edges with the orbs in its safe middle (a
// maskable icon, which the phone cuts to its own shape, and an iPhone's, which rounds it itself).
// `tools/shoot_icons.ts` takes the pictures.
// Not part of the app's build.
import { createRoot } from "react-dom/client";
import { stylesheet } from "./design/tokens.ts";
import { Orb } from "./orb/Orb.tsx";
import { ASH, type Character } from "./orb/spec.ts";

const q = new URLSearchParams(location.search);
const size = Number(q.get("size") ?? 512);
const pad = Number(q.get("pad") ?? 0.06);
const bleed = q.get("bleed") === "1";
const style = document.createElement("style");
style.textContent = `${stylesheet(`${import.meta.env.BASE_URL}fonts/Nunito.ttf`)} html, body { margin: 0; overflow: hidden; background: transparent; }`;
document.head.append(style);

/** Who is on the icon, where (the middle of each, in fractions of the card) and how big. */
const TEAM: { c: Character; x: number; y: number; s: number }[] = [
  { c: { ...ASH, name: "Pip", hue: "pink", shape: "kitty", eyes: "big", finish: "neon" }, x: 0.29, y: 0.36, s: 0.5 },
  { c: { ...ASH, name: "Bo", hue: "honey", shape: "teddy", eyes: "big", finish: "neon" }, x: 0.71, y: 0.36, s: 0.5 },
  { c: ASH, x: 0.5, y: 0.59, s: 0.66 },
];

const card = bleed ? size : Math.round(size * (1 - 2 * pad)); // the card's side
// where the orbs go: a maskable icon keeps them in its middle 80%; an iPhone's (`&room=0.88`), which only
// rounds the corners, a little more
const room = bleed ? size * Number(q.get("room") ?? 0.8) : card;
createRoot(document.getElementById("root")!).render(
  <div data-icon style={{ width: size, height: size, display: "grid", placeItems: "center" }}>
    <div data-orb={ASH.hue} style={{
      position: "relative", width: card, height: card, borderRadius: bleed ? 0 : card * 0.225, overflow: "hidden",
      background: "radial-gradient(75% 60% at 50% 22%, var(--accent-wash), transparent 70%), linear-gradient(180deg, var(--raised), var(--ground) 78%)",
      boxShadow: bleed ? "none" : "inset 0 0 0 1px var(--hairline)",
    }}>
      {TEAM.map(({ c, x, y, s }) => (
        <div key={c.name} data-orb={c.hue} style={{ position: "absolute", left: (card - room) / 2 + x * room, top: (card - room) / 2 + y * room, transform: "translate(-50%, -50%)" }}>
          <Orb character={c} size={Math.round(s * room)} still poke={false} fidget={false} framing="portrait" tint={1} />
        </div>
      ))}
    </div>
  </div>,
);
