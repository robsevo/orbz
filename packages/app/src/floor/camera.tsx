// The office as a camera room (owner, 10-07: "keep the style of the office the same but vibe it like a camera room"):
// the floor's own drawings untouched, seen as a camera sees them: REC, which camera and the time to the second on a
// strip above it, a viewfinder's corners, faint scanlines and the lens's darker edges over it. The glass lies over the
// view rather than the plan, so it stays put while a phone pans, and it takes no presses: every orb and tag under it
// is pressed through it.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const two = (n: number): string => String(n).padStart(2, "0");

/** A camera's stamp: "07 OCT 2026 14:30:12", in the clock of the computer it is shown on. */
export function stamp(d: Date): string {
  return `${two(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** A camera's name on its plate: "CAM 01 · BUILD". */
export function cameraName(n: number, room: string): string {
  return `CAM ${two(n)} · ${room.toUpperCase()}`;
}

export const CAMERA_CSS = `
@keyframes orbs-cam-rec { 0%, 55% { opacity: 1 } 56%, 100% { opacity: .2 } }
.orbs-cam-rec { animation: orbs-cam-rec 1.4s steps(1) infinite; }
@media (prefers-reduced-motion: reduce) { .orbs-cam-rec { animation: none; } }
`;

const corner = (at: "tl" | "tr" | "bl" | "br"): CSSProperties => ({
  position: "absolute", width: 18, height: 18, opacity: 0.7,
  [at[0] === "t" ? "top" : "bottom"]: 8, [at[1] === "l" ? "left" : "right"]: 8,
  [at[0] === "t" ? "borderTop" : "borderBottom"]: "2px solid var(--cam-ink)",
  [at[1] === "l" ? "borderLeft" : "borderRight"]: "2px solid var(--cam-ink)",
});
const bar: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 6px 6px", font: "700 11px/16px var(--mono)", letterSpacing: ".06em", color: "var(--text-3)", whiteSpace: "nowrap", minWidth: 0 };

/** The floor seen through a camera: `n` and `room` name the camera shown. Its REC, name and stamp sit on a strip
 * above the picture, as a monitor's bezel would carry them, so nothing of the office is covered; the corners,
 * scanlines and darker edges lie over it. */
export function CameraFeed({ n, room, children }: { n: number; room: string; children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div data-camera={cameraName(n, room)} style={{ minWidth: 0 }}>
      <style>{CAMERA_CSS}</style>
      <div aria-hidden style={bar}>
        <span data-camera-rec style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          <span className="orbs-cam-rec" style={{ flex: "0 0 auto", width: 8, height: 8, borderRadius: 4, background: "var(--cam-rec)" }} />
          <span style={{ color: "var(--text-2)" }}>REC</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{cameraName(n, room)}</span>
        </span>
        <span data-camera-stamp className="num" style={{ flex: "0 0 auto" }}>{stamp(now)}</span>
      </div>
      <div style={{ position: "relative", minWidth: 0 }}>
        {children}
        <div aria-hidden data-camera-glass style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 20, overflow: "hidden", zIndex: 2 }}>
          <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(to bottom, var(--cam-scan) 0 1px, transparent 1px 3px)" }} />
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 100% at 50% 50%, transparent 60%, var(--cam-vignette))" }} />
          {(["tl", "tr", "bl", "br"] as const).map((c) => <span key={c} style={corner(c)} />)}
        </div>
      </div>
    </div>
  );
}
