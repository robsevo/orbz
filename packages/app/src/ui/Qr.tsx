// A QR code drawn from `qr.ts`: dark on light in both themes (a reader wants that), with the
// standard's four-module margin, crisp at any size.
import { qr } from "./qr.ts";

export function QrCode({ text, size, label }: { text: string; size: number; label: string }) {
  const m = qr(text);
  const side = m.length + 8;
  let d = "";
  m.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  }));
  return (
    <svg role="img" aria-label={label} data-qr={text} viewBox={`0 0 ${side} ${side}`} width={size} height={size} shapeRendering="crispEdges" style={{ display: "block", borderRadius: 12, flex: "0 0 auto" }}>
      <rect width={side} height={side} fill="var(--qr-paper)" />
      <path d={d} fill="var(--qr-ink)" />
    </svg>
  );
}
