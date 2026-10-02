// The app's icon (PLAN 2.7, installable): Ash's own look, still, on the ground, drawn by the real
// orb so the icon is him. `icon.html?size=512&pad=0.1` (a maskable icon keeps him inside its safe
// zone); `tools/shoot_icons.ts` takes the pictures. Not part of the app's build.
import { createRoot } from "react-dom/client";
import { stylesheet } from "./design/tokens.ts";
import { Orb } from "./orb/Orb.tsx";
import { ASH } from "./orb/spec.ts";

const q = new URLSearchParams(location.search);
const size = Number(q.get("size") ?? 512);
const pad = Number(q.get("pad") ?? 0.04);
const style = document.createElement("style");
style.textContent = `${stylesheet(`${import.meta.env.BASE_URL}fonts/Nunito.ttf`)} body { overflow: hidden; }`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <div data-orb={ASH.hue} data-icon style={{ width: size, height: size, display: "grid", placeItems: "center", background: "radial-gradient(60% 60% at 50% 42%, var(--accent-wash), transparent 72%), var(--ground)" }}>
    <Orb character={ASH} size={Math.round(size * (1 - 2 * pad))} still poke={false} fidget={false} framing="portrait" />
  </div>,
);
