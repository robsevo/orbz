// Any colour (PLAN 2.20; owner, 10-08: "We also want to be able to choose a bit more colors for our orbs and
// accessories. DNA should go with hex if possible. a lot more possibilities"): a slider for the hue, one for how
// bright and one for how strong, each track drawn in the colours it gives (design/tokens.ts pickerTracks), and a hex
// field to type or paste one in. Its colour is picked as you move, and a hex is taken once it has six digits.
import { useEffect, useState, type CSSProperties } from "react";
import { colourAt, hex, parseHex, rgbToOklch } from "../design/color.ts";
import { HUES, pickerTracks, type HueName } from "../design/tokens.ts";
import { hexOf } from "../orb/colour.ts";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const track: CSSProperties = { width: "100%", minWidth: 0, margin: 0, height: 24, borderRadius: 12, appearance: "none", WebkitAppearance: "none", cursor: "pointer", boxShadow: "inset 0 0 0 1px var(--hairline)" };

/** Where a colour starts: the one chosen, else the orb's own hue at the 24's lightness and strength. */
function startOf(value: string | null, from: HueName): { h: number; L: number; C: number } {
  if (value) return rgbToOklch(parseHex(value));
  const own = HUES.find((x) => x.name === from) ?? HUES[0]!;
  return rgbToOklch(own.dark);
}

export function ColourPicker({ value, from, label, onPick }: { value: string | null; from: HueName; label: string; onPick: (hex: string) => void }) {
  const [at, setAt] = useState(() => startOf(value, from));
  const [typed, setTyped] = useState(value ? value.toUpperCase() : "");
  // a colour chosen elsewhere (a swatch, the dice) moves the sliders to it
  useEffect(() => {
    if (!value) return;
    setAt(rgbToOklch(parseHex(value)));
    setTyped(value.toUpperCase());
  }, [value]);
  const pick = (next: { h: number; L: number; C: number }): void => {
    setAt(next);
    const c = colourAt(next.L, next.C, next.h).toLowerCase();
    setTyped(c.toUpperCase());
    onPick(c);
  };
  const tracks = pickerTracks(at.h, at.L, at.C);
  const shown = colourAt(at.L, at.C, at.h);
  return (
    <div data-colour-picker role="group" aria-label={label} style={{ display: "grid", gap: 10, padding: 12, borderRadius: 14, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {/* the colour as it is, and its hex to type or paste */}
        <span aria-hidden data-colour-shown={shown} style={{ flex: "0 0 auto", width: 36, height: 36, borderRadius: "50%", background: shown, boxShadow: "inset 0 0 0 1px var(--hairline)" }} />
        <input
          value={typed}
          aria-label={`${label}, as hex`}
          placeholder={hex(HUES[4]!.dark).toUpperCase()}
          spellCheck={false}
          autoCapitalize="characters"
          onChange={(e) => {
            setTyped(e.target.value);
            const c = hexOf(e.target.value);
            if (c) {
              setAt(rgbToOklch(parseHex(c)));
              onPick(c);
            }
          }}
          style={{ flex: "1 1 auto", minWidth: 0, font: "600 15px/20px var(--mono)", color: "var(--text-1)", background: "var(--card)", border: 0, borderRadius: 10, padding: "8px 10px", outline: 0, boxShadow: `inset 0 0 0 1px ${typed && !hexOf(typed) ? "var(--alert)" : "var(--hairline)"}` }}
        />
      </div>
      {(
        [
          ["Hue", "hue", at.h, 0, 359, 1, tracks.hue, (v: number) => pick({ ...at, h: v })],
          ["Brightness", "light", Math.round(at.L * 100), 20, 95, 1, tracks.light, (v: number) => pick({ ...at, L: v / 100 })],
          ["Strength", "strength", Math.round(at.C * 100), 0, 30, 1, tracks.strength, (v: number) => pick({ ...at, C: v / 100 })],
        ] as const
      ).map(([name, id, v, min, max, step, background, set]) => (
        <label key={id} style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <span style={head}>{name}</span>
          <input type="range" data-colour-slider={id} min={min} max={max} step={step} value={Math.round(v)} onChange={(e) => set(Number(e.target.value))} aria-label={`${label}: ${name.toLowerCase()}`} style={{ ...track, background }} />
        </label>
      ))}
    </div>
  );
}
