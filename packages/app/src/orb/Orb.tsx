// An orb on the page (PLAN 2.2-2.3): the live glass character, drawn by the shared renderer at
// his window's proportions (112 x 146). He looks at your pointer and leans toward it, a click is a
// poke (a hop, or a squish), he pops in when he appears, and at rest he fidgets on his own.
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { addOrb, drawOne, now } from "./loop.ts";
import { DESIGN, PORTRAIT, type Framing } from "./renderer.ts";
import { fidgets, type Gesture, type OrbState, type Play } from "./life.ts";
import { closeUp, describe, finishOf, lookOf, motionOf, type Character } from "./spec.ts";

export type OrbProps = {
  character: Character;
  /** CSS width in px; the height follows his window's proportions. */
  size?: number;
  state?: OrbState;
  /** Gestures to play now, as they arrive (each new entry plays once). */
  gesture?: { name: Gesture; n: number } | null;
  fidget?: boolean;
  /** A click pokes him. */
  poke?: boolean;
  /** How much of his colour he holds at rest: Ash's own setting is 0.62 (grey is 0); an orb among
   * others holds more, so you can tell who is who at a glance. */
  tint?: number;
  /** Draw every this many frames (a list's avatars). */
  every?: number;
  /** Drawn once and held: a picker's thumbnail, a still avatar. */
  still?: boolean;
  /** "portrait": a close-up of his face (choosing eyes or glasses), instead of his whole window. */
  framing?: "window" | "portrait";
  /** Whether he pops in as he appears (not when he is changing into someone else: Roll everything). */
  pop?: boolean;
  /** With `still`: the moment of a gesture he holds (the app's icon). */
  pose?: { gesture: Gesture; into: number };
  /** The light behind him, in his colour (owner, 10-11: "like a background light"); off where a page lights him itself. */
  light?: boolean;
  style?: CSSProperties;
};

const seedOf = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) / 97;

export function Orb({ character, size = 120, state = "idle", gesture = null, fidget = true, poke = true, tint = 0.8, every = 1, still = false, framing = "window", pose, pop = true, light = true, style }: OrbProps) {
  // the close-up: cut to his width, his hat kept in (spec.ts closeUp)
  const frame: Framing = useMemo(() => (framing === "portrait" ? closeUp(PORTRAIT, character) : DESIGN), [framing, character.shape, character.hat]);
  const ref = useRef<HTMLCanvasElement>(null);
  const plays = useRef<Play[]>([]);
  const pointer = useRef<[number, number] | null>(null);
  const seed = useMemo(() => seedOf(`${character.name}:${character.shape}:${character.hue}`), [character.name, character.shape, character.hue]);
  const live = useRef({ character, state, fidget, tint });
  live.current = { character, state, fidget, tint };
  const play = (g: Gesture): void => {
    const t = now();
    plays.current = [...plays.current.filter((p) => t - p.at < 5), { gesture: g, at: t }];
  };

  useEffect(() => {
    if (gesture) play(gesture.name);
  }, [gesture?.n]);

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(((size * frame.h) / frame.w) * dpr);
    const own = fidgets(seed, 3600, motionOf(live.current.character));
    if (globalThis.__orbsTime === undefined && !still && pop) play("pop"); // on a held clock (a render check) the pop would hold at its peak
    const entry = {
      canvas,
      visible: true,
      every,
      framing: frame,
      look: () => lookOf(live.current.character),
      input: () => ({
        ...(() => {
          const f = finishOf(live.current.character);
          return { turn: f.turn, sat: f.sat, val: f.val, turn2: f.turn2, grad: f.grad, glow: f.glow, ...(f.tint !== null && { tintOf: f.tint }) };
        })(),
        motion: motionOf(live.current.character),
        still,
        ...(pose && { pose }),
        seed, tint: live.current.tint, goo: live.current.character.goo, state: live.current.state,
        plays: live.current.fidget && live.current.state === "idle" ? [...own, ...plays.current] : plays.current,
        pointer: pointer.current,
      }),
    };
    const io = new IntersectionObserver(([e]) => (entry.visible = Boolean(e?.isIntersecting)));
    io.observe(canvas);
    const move = (ev: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const R = (r.width * frame.radius) / frame.w;
      pointer.current = [(ev.clientX - (r.left + r.width / 2)) / R, (ev.clientY - (r.top + r.height * frame.cy)) / R];
    };
    const away = (): void => {
      pointer.current = null;
    };
    window.addEventListener("pointermove", move);
    document.addEventListener("pointerleave", away);
    if (still) {
      // a thumbnail: one frame, at a moment he looks like himself (eyes open, no gesture), redrawn when he changes
      drawOne(entry, 2.6);
      return () => io.disconnect();
    }
    const stop = addOrb(entry);
    return () => {
      stop();
      io.disconnect();
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", away);
    };
  }, [size, seed, every, still, frame, ...(still ? [JSON.stringify(character)] : [])]);

  // the CEO and the CFO glow (owner, 10-07: "a special glow or smt to let you know theyre the CEO or CFO"), by their post
  const rank = character.specialty === "ceo" ? "ceo" : character.specialty === "cfo" ? "cfo" : null;
  return (
    <canvas
      ref={ref}
      className={[light && "orb-light", rank && `orb-rank orb-rank-${rank}`].filter(Boolean).join(" ") || undefined}
      data-rank={rank ?? undefined}
      data-light={light ? character.hue : undefined}
      role="img"
      aria-label={`${describe(character)}, ${state}`}
      onClick={poke ? () => play(Math.random() < 0.65 ? "hop" : "squish") : undefined}
      data-sound={poke ? "poke" : undefined}
      style={{ width: size, height: (size * frame.h) / frame.w, display: "block", cursor: poke ? "pointer" : undefined, ...(light && ({ "--orb-cy": `${frame.cy * 100}%` } as CSSProperties)), ...style }}
    />
  );
}
