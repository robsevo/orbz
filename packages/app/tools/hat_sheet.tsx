// The hat sheet's page (tools/shoot_hats.ts): every hat close up on one orb, so how each one is made
// (its shape, its proportions on his head, what it seems made of) can be judged side by side
// (owner, 10-09: "dont cheap out on them. make them nice, to industry standards").
import { createRoot } from "react-dom/client";
import { stylesheet } from "../src/design/tokens.ts";
import { Orb } from "../src/orb/Orb.tsx";
import type { Gesture } from "../src/orb/life.ts";
import { ASH, EYES, GLASSES, HATS, type Character, type EyesName, type GlassesName, type HatName, type OrbHue, type ShapeName } from "../src/orb/spec.ts";

export function mount(): void {
  const q = new URLSearchParams(location.search);
  const size = Number(q.get("size") ?? 200);
  const theme = q.get("theme") === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  const style = document.createElement("style");
  style.textContent = stylesheet();
  document.head.append(style);
  // what the sheet shows: every hat (the default), every pair of glasses, or every style of eyes (close up)
  const kind = q.get("kind") === "glasses" ? "glasses" : q.get("kind") === "eyes" ? "eyes" : "hat";
  const all = kind === "glasses" ? Object.keys(GLASSES) : kind === "eyes" ? Object.keys(EYES) : Object.keys(HATS);
  const hats = all.filter((h) => (kind === "eyes" || h !== "none") && (!q.get("wears") || q.get("wears")!.split(",").includes(h)));
  const hues = (q.get("hues")?.split(",") ?? ["azure"]) as OrbHue[];
  const shape = (q.get("shape") ?? "bean") as ShapeName;
  const cols = Number(q.get("cols") ?? 7);
  const close = kind !== "hat" || q.get("framing") === "portrait";
  const pose = (q.get("pose") as Gesture | null) ?? null; // the moment of a gesture each holds (a wink, a hop's happy eyes)
  const root = document.createElement("div");
  document.body.append(root);
  createRoot(root).render(
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${size}px)`, gap: 6, padding: 12, background: "var(--ground)", color: "var(--text-2)", font: "600 13px/16px var(--font)", width: "max-content" }}>
      {hats.flatMap((h, i) => {
        const hue = hues[i % hues.length]!;
        const wear = kind === "glasses" ? { hat: "none" as HatName, glasses: h as GlassesName } : kind === "eyes" ? { hat: "none" as HatName, glasses: "none" as GlassesName, eyes: h as EyesName } : { hat: h as HatName, glasses: "none" as GlassesName };
        const c: Character = { ...ASH, name: "Sheet", finish: "glass", shape, hue, ...wear, ears: q.get("ears") === "out" ? "out" : null };
        return [
          <div key={h} style={{ display: "grid", justifyItems: "center" }}>
            <Orb character={c} size={size} still poke={false} framing={close ? "portrait" : "window"} {...(pose && { pose: { gesture: pose, into: Number(q.get("into") ?? 0.5) } })} />
            <span>{h}</span>
          </div>,
        ];
      })}
    </div>,
  );
  (window as unknown as { ready: boolean }).ready = true;
}
