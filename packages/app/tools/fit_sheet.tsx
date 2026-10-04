// The fit sheet's page (tools/shoot_fit.ts): every shape in every hat, or every pair of glasses,
// as still thumbnails in one grid, so a hat that floats, sinks or covers an ear shows at a glance.
import { createRoot } from "react-dom/client";
import { stylesheet } from "../src/design/tokens.ts";
import { Orb } from "../src/orb/Orb.tsx";
import { ASH, GLASSES, HATS, SHAPES, type Character, type GlassesName, type HatName, type ShapeName } from "../src/orb/spec.ts";

export function mount(kind: "hat" | "glasses", size = 72): void {
  const style = document.createElement("style");
  style.textContent = stylesheet();
  document.head.append(style);
  // a part of the sheet (shoot_fit.ts --shapes a,b --wears x,y): what is being changed, quickly
  const only = (k: string): string[] | null => new URLSearchParams(location.search).get(k)?.split(",") ?? null;
  const shapes = (Object.keys(SHAPES) as ShapeName[]).filter((x) => !only("shapes") || only("shapes")!.includes(x));
  const wears = (kind === "hat" ? Object.keys(HATS).filter((h) => h !== "none") : Object.keys(GLASSES).filter((g) => g !== "none")).filter((x) => !only("wears") || only("wears")!.includes(x)) as string[];
  const base: Character = { ...ASH, name: "Fit", finish: "glass" };
  const root = document.createElement("div");
  document.body.append(root);
  createRoot(root).render(
    <div data-orb="azure" style={{ display: "grid", gridTemplateColumns: `90px repeat(${wears.length}, ${size}px)`, gap: 2, padding: 8, background: "var(--ground)", color: "var(--text-2)", font: "600 9px/11px var(--font)", width: "max-content" }}>
      <span />
      {wears.map((w) => <span key={w} style={{ writingMode: "vertical-rl", height: 70, overflow: "hidden" }}>{w}</span>)}
      {shapes.map((s) => [
        <span key={s} style={{ alignSelf: "center" }}>{s}</span>,
        ...wears.map((w) => (
          <Orb key={`${s}-${w}`} character={{ ...base, shape: s, ...(kind === "hat" ? { hat: w as HatName } : { glasses: w as GlassesName }) }} size={size} still poke={false} framing={kind === "glasses" ? "portrait" : "window"} />
        )),
      ])}
    </div>,
  );
  (window as unknown as { ready: boolean }).ready = true;
}
