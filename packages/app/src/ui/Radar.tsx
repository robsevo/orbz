// A radar in his colour (the house chart style): where he leans on the creator's sheet, what he does
// on his career page (PLAN 5.6). Each item 0 to 5 to begin with; a levelled orb's web grows past it, and
// the chart grows with it (its rings at fifths of the most it shows).
/** Where he leans, on eight skills: a radar in his colour. */
export function Radar({ items }: { items: { name: string; value: number }[] }) {
  const n = items.length;
  const R = 70;
  const top = Math.max(5, Math.ceil(Math.max(...items.map((t) => t.value)))); // the outer ring
  const at = (i: number, v: number): [number, number] => {
    const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return [Math.cos(a) * R * (v / top), Math.sin(a) * R * (v / top)];
  };
  const poly = items.map((t, i) => at(i, t.value).join(",")).join(" ");
  return (
    <svg viewBox="-118 -100 236 200" role="img" aria-label={`Leans toward: ${items.map((t) => `${t.name} ${t.value}`).join(", ")}`} style={{ width: "100%", maxWidth: 300, display: "block", margin: "0 auto" }}>
      {[1, 2, 3, 4, 5].map((ring) => (
        <polygon key={ring} points={items.map((_, i) => at(i, (ring * top) / 5).join(",")).join(" ")} fill="none" stroke="var(--fill-2)" strokeWidth={1} />
      ))}
      {items.map((_, i) => {
        const [x, y] = at(i, top);
        return <line key={i} x1={0} y1={0} x2={x} y2={y} stroke="var(--fill-2)" strokeWidth={1} />;
      })}
      <polygon points={poly} fill="var(--accent-wash)" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      {items.map((t, i) => {
        const [x, y] = at(i, top * 1.28);
        return (
          <text key={t.name} x={x} y={y} textAnchor="middle" dominantBaseline="middle" style={{ font: "600 11px var(--font)", fill: "var(--text-3)" }}>
            {t.name}
          </text>
        );
      })}
    </svg>
  );
}
