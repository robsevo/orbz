// Pressing feels like pressing (owner, 2026-10-01: "when i push something, i wanna feel like im
// pushing it"). One listener covers the whole page. A button sounds the moment it goes down, not
// when it comes up, so the press is felt at once. Few presses sound (owner, 10-07: "those click
// sounds the app makes. fkn limit them please"):
//   - a choice not yet chosen clicks ("pick");
//   - `data-sound` names the sound of an act that matters (sending, approving, roll, create, delete,
//     poke), or "none";
//   - anything else is silent: a tab, a plain button, a choice already chosen.
// A range slider ratchets, with a tick every 10 steps. On a phone, a press that sounds also taps the
// motor. The same sound twice within a quarter second is one (sound.ts, `pace`).
// The squish itself is CSS: `button:active` in the stylesheet (design/tokens.ts).
import { play, type Sound } from "./sound.ts";

export function soundFor(el: Element): Sound | null {
  const named = el instanceof HTMLElement || el instanceof SVGElement ? el.dataset.sound : undefined;
  if (named) return named === "none" ? null : (named as Sound);
  if (el.getAttribute("aria-pressed") === "false") return "pick";
  return null;
}

const pressable = (t: EventTarget | null): Element | null => (t instanceof Element ? t.closest("button:not(:disabled), [data-sound]") : null);

export function installFeel(doc: Document = document): () => void {
  const down = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const el = pressable(e.target);
    const s = el && soundFor(el);
    if (!s) return;
    play(s);
    if (e.pointerType === "touch") navigator.vibrate?.(s === "tick" ? 4 : 8);
  };
  const key = (e: KeyboardEvent): void => {
    if (e.repeat || (e.key !== "Enter" && e.key !== " ")) return;
    const el = pressable(doc.activeElement);
    const s = el && soundFor(el);
    if (s) play(s);
  };
  const notches = new WeakMap<HTMLInputElement, number>();
  const input = (e: Event): void => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== "range") return;
    const notch = Math.round(Number(el.value) / 10);
    if (notches.get(el) === notch) return;
    notches.set(el, notch);
    play("tick");
  };
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("keydown", key, true);
  doc.addEventListener("input", input, true);
  return () => {
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("input", input, true);
  };
}
