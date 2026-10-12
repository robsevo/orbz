// An orb's computer as a picture in picture (owner, 10-11: "resizeable pip in chat or sessions when taking control or
// just viewing orbs computer, full screen option"): where it floats and how big, always inside the window. Moved by its
// header and sized from its corner (Computer.tsx); pure, so a test holds it.

export type Box = { x: number; y: number; w: number; h: number };
/** The least it can be: its tabs and a still of the screen readable. */
export const PIP_MIN = { w: 300, h: 240 };
const EDGE = 16;

/** A box kept inside the window: never smaller than its least (unless the window is), never larger than the window, never
 * past its edges. */
export function clampBox(b: Box, vw: number, vh: number): Box {
  const w = Math.min(Math.max(b.w, Math.min(PIP_MIN.w, vw)), vw);
  const h = Math.min(Math.max(b.h, Math.min(PIP_MIN.h, vh)), vh);
  return { w, h, x: Math.min(Math.max(b.x, 0), vw - w), y: Math.min(Math.max(b.y, 0), vh - h) };
}

/** Where it first floats: the window's bottom right, as large as fits up to 720 by 560. */
export function pipStart(vw: number, vh: number): Box {
  const w = Math.min(720, vw - 2 * EDGE);
  const h = Math.min(560, vh - 2 * EDGE);
  return clampBox({ x: vw - w - EDGE, y: vh - h - EDGE, w, h }, vw, vh);
}

/** A drag from where it began: its header moves it, its corner sizes it (the corner follows the pointer, so its far
 * edges stay inside the window). */
export function dragged(kind: "move" | "size", from: Box, dx: number, dy: number, vw: number, vh: number): Box {
  return clampBox(kind === "move" ? { ...from, x: from.x + dx, y: from.y + dy } : { ...from, w: Math.min(from.w + dx, vw - from.x), h: Math.min(from.h + dy, vh - from.y) }, vw, vh);
}
