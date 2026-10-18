// The office orbs' little walk (owner, 10-11: a giggle/wobble as they move), and how they stand on every floor.
// Kept pure so its character is held by the floor test instead of depending on animation timing.

/** An orb on a floor (the office's, the desk's, the studio's): solid and bigger (owner, 10-18: "they look a bit like
 * ghosts. can we have them not look like that? ... bigger maybe?"). They were drawn at 84 (the desk's 80) and see-through
 * twice over: the floor's 0.86 (owner, 10-11: "less opaque") on top of the glass's own 0.8, so the room showed through
 * them. Now their glass is solid (Orb `solid`) and they are a fifth bigger. */
export const FLOOR_ORB = { size: 100, solid: true } as const;

export function walkWobble(phase: number, scale: number): string {
  const x = Math.sin(phase * 2.1) * 2 * scale;
  const y = -Math.abs(Math.sin(phase)) * 6 * scale;
  const turn = Math.sin(phase) * 7;
  const squash = 1 + Math.abs(Math.cos(phase)) * 0.025;
  return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${turn.toFixed(1)}deg) scaleY(${squash.toFixed(3)})`;
}
