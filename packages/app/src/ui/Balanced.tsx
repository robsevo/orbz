// Layout without stragglers (owner, 2026-10-01: "i hate when like just 1 item is lingering in a
// table or header"). A grid takes the widest column count that fits, and never leaves one item
// alone on its last row (the arithmetic is ui/balance.ts). A row of choices stays on one line; when the screen is too narrow for
// it, it scrolls sideways, and a fade at its edge shows there is more. The render harness reports
// an orphan wherever this is not used.
import { Children, isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { layoutOf, type GridPlan } from "./balance.ts";

export function Balanced({ min, gap = 8, lead, children, style }: { min: number; gap?: number; lead?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children);
  const n = items.length;
  const [shape, setShape] = useState<{ plan: GridPlan; spanLead: boolean }>({ plan: { cols: 1, spans: [] }, spanLead: false });
  useLayoutEffect(() => {
    const el = ref.current!;
    const fit = (): void => {
      const max = Math.max(1, Math.floor((el.clientWidth + gap) / (min + gap)));
      const next = layoutOf(n, max, Boolean(lead));
      setShape((s) => (JSON.stringify(s) === JSON.stringify(next) ? s : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n, min, gap, Boolean(lead)]);
  const { plan, spanLead } = shape;
  // when the rows are uneven (4, 3, 3, 3), each item spans its share of the tracks
  const offset = lead && !spanLead ? 1 : 0;
  const span = (i: number): number => plan.spans[i + offset] ?? 1;
  return (
    <div ref={ref} style={{ display: "grid", gap, gridTemplateColumns: `repeat(${plan.cols}, minmax(0, 1fr))`, ...style }}>
      {lead && (
        <div data-lead={spanLead ? "row" : "cell"} style={{ display: "grid", gridColumn: spanLead ? "1 / -1" : `span ${plan.spans[0] ?? 1}`, minWidth: 0 }}>
          {lead}
        </div>
      )}
      {items.map((child, i) =>
        span(i) === 1 ? child : (
          // its own cell, so the span holds whatever the item is (a component may not take a style)
          <div key={isValidElement(child) ? child.key ?? i : i} style={{ display: "grid", gridColumn: `span ${span(i)}`, minWidth: 0 }}>
            {child}
          </div>
        ),
      )}
    </div>
  );
}

/** Marks a sideways scroller with where it has more to show (`data-more="left right"`), for the fade. */
export function useMore(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current!;
    const mark = (): void => {
      const more = [el.scrollLeft > 1 ? "left" : "", el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? "right" : ""].filter(Boolean).join(" ");
      if ((el.dataset.more ?? "") !== more) el.dataset.more = more;
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    for (const k of el.children) ro.observe(k);
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
    };
  });
}

/** A row of choices on one line: centred when it fits, scrolling sideways (with a fade) when it does not. */
export function OneLine({ children, gap = 6, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useMore(ref);
  return (
    <div ref={ref} className="one-line" style={{ display: "flex", flexWrap: "nowrap", gap, overflowX: "auto", justifyContent: "safe center", maxWidth: "100%", scrollbarWidth: "none", ...style }}>
      {children}
    </div>
  );
}
