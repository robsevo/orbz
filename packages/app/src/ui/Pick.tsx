// A dropdown with its name over it (owner, 10-10: "Fix the recruiting page filtering by adding maybe dropdowns
// instead?"): a filter that would have been a row of buttons is one choice in a menu of its own, the browser's own
// list on a phone (a wheel on an iPhone), its chevron drawn here in the field's colour.
import type { CSSProperties } from "react";

const label: CSSProperties = { display: "grid", gap: 4, minWidth: 0, flex: "1 1 180px", maxWidth: 320 };
const name: CSSProperties = { font: "700 11px/14px var(--font)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-3)" };
const field: CSSProperties = {
  width: "100%", minWidth: 0, minHeight: 36, font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10,
  padding: "7px 34px 7px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)", appearance: "none", WebkitAppearance: "none", cursor: "pointer",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

/** One choice from a list: `options` as [value, words]; the empty value is "all". `label` names it for a screen reader
 * where its title alone is said twice on a page; `data` is set on the select itself. */
export function Pick({ title, label: named, value, options, onChange, data }: { title: string; label?: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void; data?: Record<`data-${string}`, string> }) {
  return (
    <label style={label}>
      <span style={name}>{title}</span>
      <span style={{ position: "relative", display: "grid", minWidth: 0 }}>
        <select aria-label={named ?? title} value={value} onChange={(e) => onChange(e.target.value)} style={field} {...data}>
          {options.map(([v, words]) => (
            <option key={v} value={v}>{words}</option>
          ))}
        </select>
        <span aria-hidden style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", font: "800 12px/12px var(--font)", color: "var(--text-2)" }}>▾</span>
      </span>
    </label>
  );
}
