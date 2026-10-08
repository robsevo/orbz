// The office as a camera room (owner, 10-07: "keep the style of the office the same but vibe it like a camera room"):
// the floor's own drawings untouched, under a camera's REC, which camera and the time to the second on a strip above
// it. Nothing lies over the picture (owner, 10-08: "Camera view is too camera ey, we want to see them"): the
// scanlines, darker edges and viewfinder corners it had at first washed the orbs out.
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

const bar: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 6px 6px", font: "700 11px/16px var(--mono)", letterSpacing: ".06em", color: "var(--text-3)", whiteSpace: "nowrap", minWidth: 0 };

/** The floor seen through a camera: `n` and `room` name the camera shown. Its REC, name and stamp sit on a strip
 * above the picture, as a monitor's bezel would carry them, and nothing of the camera's lies over the office. */
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
      <div style={{ position: "relative", minWidth: 0 }}>{children}</div>
    </div>
  );
}
