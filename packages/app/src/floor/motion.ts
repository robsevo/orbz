// The office orbs' little walk (owner, 10-11: less opaque, and a giggle/wobble as they move).
// Kept pure so its character is held by the floor test instead of depending on animation timing.
export const OFFICE_ORB_OPACITY = 0.86;

export function walkWobble(phase: number, scale: number): string {
  const x = Math.sin(phase * 2.1) * 2 * scale;
  const y = -Math.abs(Math.sin(phase)) * 6 * scale;
  const turn = Math.sin(phase) * 7;
  const squash = 1 + Math.abs(Math.cos(phase)) * 0.025;
  return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${turn.toFixed(1)}deg) scaleY(${squash.toFixed(3)})`;
}
