// The app's icon (PLAN 2.7, installable; owner, 10-04: "we need a simpler logo for our app logo and mobile
// logos, something that fits with 'the crowd' ... use the O and the shape of an orb somehow and keep the app
// color"): the Orbz mark (brand/mark.ts), the O as an orb on the app's charcoal. `icon.html?size=512&pad=0.06`
// is the rounded card with clear corners (an "any" icon, and the desktop's); `&bleed=1` fills the square to its
// edges with the O in its safe middle (a maskable icon, which the phone cuts to its own shape, and an iPhone's,
// which rounds it itself; `&room=0.88` for the iPhone's); `&text=0` leaves the eyes off (the title bar's tiny
// sizes); `&lockup=1` is the mark with the word beside it. `tools/shoot_icons.ts` takes the pictures.
// Not part of the app's build.
import { createRoot } from "react-dom/client";
import { stylesheet } from "./design/tokens.ts";
import { markSvg } from "./brand/mark.ts";

const q = new URLSearchParams(location.search);
const size = Number(q.get("size") ?? 512);
const pad = Number(q.get("pad") ?? 0.06);
const bleed = q.get("bleed") === "1";
const room = Number(q.get("room") ?? 0.8); // a maskable icon keeps the O in its middle 80%; an iPhone's a little more
const eyes = q.get("text") !== "0";
const lockup = q.get("lockup") === "1";
const style = document.createElement("style");
style.textContent = `${stylesheet(`${import.meta.env.BASE_URL}fonts/Nunito.ttf`)} html, body { margin: 0; overflow: hidden; background: transparent; } svg { display: block; }`;
document.head.append(style);

const card = bleed ? size : Math.round(size * (1 - 2 * pad)); // the card's side
// the O takes 62% of the card; edge to edge, 70% of the room it is given (an iPhone 62%, a maskable 56%, inside its safe 80%)
const svg = lockup ? markSvg({ ground: "card", scale: 0.62 }) : markSvg({ ground: bleed ? "bleed" : "card", eyes, scale: bleed ? room * 0.7 : 0.62 });
createRoot(document.getElementById("root")!).render(
  lockup ? (
    // the lockup: the icon, and Orbz in the app's own type beside it
    <div data-icon style={{ display: "inline-flex", alignItems: "center", gap: size * 0.12, padding: size * 0.08 }}>
      <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
      <span style={{ font: `800 ${Math.round(size * 0.62)}px/1 var(--font)`, letterSpacing: "-0.01em", color: "var(--text-1)" }}>Orbz</span>
    </div>
  ) : (
    <div data-icon style={{ width: size, height: size, display: "grid", placeItems: "center" }}>
      <div style={{ width: card, height: card }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  ),
);
