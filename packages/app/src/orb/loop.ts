// The one animation loop for every orb on the page (PLAN 2.3): a frame draws only the orbs on
// screen, and nothing runs while the page is hidden. A render check fixes the clock
// (`globalThis.__orbsTime`) so the same orbs draw the same frame every time.
import { lifeFrame, type LifeInput } from "./life.ts";
import { renderer, type Framing, type OrbFrame, type OrbLook } from "./renderer.ts";

export type Entry = {
  canvas: HTMLCanvasElement;
  look: () => OrbLook;
  input: () => LifeInput;
  visible: boolean;
  /** Draw every this many frames: a small avatar in a list need not cost what the big orb does. */
  every?: number;
  framing?: Framing;
  /** Told each frame where he is (the light behind him follows his hops and sways, owner 10-11). */
  follow?: (f: OrbFrame) => void;
};

const entries = new Set<Entry>();
const t0 = performance.now();
let raf = 0;
let tick = 0;

declare global {
  // eslint-disable-next-line no-var
  var __orbsTime: number | undefined;
}

export const now = (): number => globalThis.__orbsTime ?? (performance.now() - t0) / 1000;

export function drawOne(e: Entry, t = now()): void {
  const f = lifeFrame(e.input(), t);
  renderer().draw(e.canvas, e.look(), f, t, e.framing);
  e.follow?.(f);
}

function frame(): void {
  raf = 0;
  if (!document.hidden) {
    const t = now();
    tick++;
    for (const e of entries) if (e.visible && tick % (e.every ?? 1) === 0) drawOne(e, t);
  }
  if (entries.size && globalThis.__orbsTime === undefined) raf = requestAnimationFrame(frame);
}

export function addOrb(e: Entry): () => void {
  entries.add(e);
  drawOne(e);
  if (!raf) raf = requestAnimationFrame(frame);
  return () => {
    entries.delete(e);
  };
}

/** Draws every orb once more (a fixed clock, or after a theme change). */
export function redrawAll(): void {
  for (const e of entries) drawOne(e);
}
