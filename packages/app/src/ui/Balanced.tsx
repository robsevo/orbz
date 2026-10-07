// Layout without stragglers (owner, 2026-10-01: "i hate when like just 1 item is lingering in a
// table or header"). A grid takes the widest column count that fits, and never leaves one item
// alone on its last row (the arithmetic is ui/balance.ts). A row of choices stays on one line; when the screen is too narrow for
// it, it scrolls sideways, in a rounded track with an arrow at each end and a fade where there is more
// (SideScroll). The render harness reports an orphan wherever this is not used.
import { Children, createElement, isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
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

type Sides = { over: boolean; left: boolean; right: boolean };

/** Whether a sideways scroller holds more than its track has room for (`over`, measured against the track, so its
 * arrows coming and going never decide it), and whether there is more to its left and to its right. Read when it
 * scrolls, or it, its track or what is in it changes size. */
function useSides(ref: RefObject<HTMLElement | null>, track: RefObject<HTMLElement | null>): Sides {
  const [sides, setSides] = useState<Sides>({ over: false, left: false, right: false });
  useLayoutEffect(() => {
    const el = ref.current!;
    const box = track.current!;
    const mark = (): void => {
      const over = el.scrollWidth > box.clientWidth + 1;
      const next = { over, left: over && el.scrollLeft > 1, right: over && el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
      setSides((s) => (s.over === next.over && s.left === next.left && s.right === next.right ? s : next));
    };
    const ro = new ResizeObserver(mark);
    const watch = (): void => {
      ro.disconnect();
      ro.observe(el);
      ro.observe(box);
      for (const k of el.children) ro.observe(k);
      mark();
    };
    watch();
    const mo = new MutationObserver(watch); // what is in it changed: watch the new children too
    mo.observe(el, { childList: true });
    el.addEventListener("scroll", mark, { passive: true });
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return sides;
}

/** A sideways scroller (owner, 10-07: "change the containers and add arrows to every side scroll"): when what it holds
 * is wider than its room, it sits in a rounded track with an arrow at each end, each moving it most of its width that
 * way, dimmed where there is no more; a fade at the edge where there is more. `bare`: the arrows without the track, for
 * a scroller that is its own box (the creator's tab bar, a code block, a table). Its margins are the track's. The
 * stylesheet's rules are design/tokens.ts's `.side-scroll`. */
export function SideScroll({ as = "div", scrollRef, bare = false, className, style, children, ...rest }: {
  as?: "div" | "pre";
  scrollRef?: RefObject<HTMLDivElement | null>;
  bare?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "style" | "className" | "children">) {
  const own = useRef<HTMLElement>(null);
  const ref = (scrollRef ?? own) as RefObject<HTMLElement | null>;
  const track = useRef<HTMLDivElement>(null);
  const { over, left, right } = useSides(ref, track);
  const { margin, marginTop, marginBottom, marginLeft, marginRight, marginBlock, marginInline, ...inner } = style ?? {};
  const go = (dir: -1 | 1) => (): void => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const arrow = (dir: -1 | 1, on: boolean) => (
    <button type="button" className="side-arrow" data-side={dir < 0 ? "left" : "right"} aria-label={dir < 0 ? "Scroll left" : "Scroll right"} tabIndex={-1} disabled={!on} onClick={go(dir)}>
      {/* a chevron drawn, not a glyph: Nunito's ‹ › are small and sit low */}
      <span aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={dir < 0 ? "M8.5 2.5 4 7l4.5 4.5" : "M5.5 2.5 10 7l-4.5 4.5"} />
        </svg>
      </span>
    </button>
  );
  const more = [left ? "left" : "", right ? "right" : ""].filter(Boolean).join(" ");
  return (
    <div ref={track} className="side-scroll" data-over={over || undefined} data-bare={bare || undefined} style={{ margin, marginTop, marginBottom, marginLeft, marginRight, marginBlock, marginInline }}>
      {over && arrow(-1, left)}
      {createElement(as, { ...rest, ref, className, style: inner, "data-more": more || undefined }, children)}
      {over && arrow(1, right)}
    </div>
  );
}

/** Marks a tall box with where there is more to scroll to ("up", "down"), for its fade: when it scrolls,
 * or it or what is in it changes size, never on every render (that read forces a layout of the whole box,
 * which slowed the creator, whose every choice re-renders it). */
function useMoreDown(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current!;
    const mark = (): void => {
      const more = [el.scrollTop > 1 ? "up" : "", el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? "down" : ""].filter(Boolean).join(" ");
      if ((el.dataset.more ?? "") !== more) el.dataset.more = more;
    };
    const ro = new ResizeObserver(mark);
    const watch = (): void => {
      ro.disconnect();
      ro.observe(el);
      for (const k of el.children) ro.observe(k);
    };
    watch();
    const mo = new MutationObserver(watch); // what is in it changed: watch the new children too
    mo.observe(el, { childList: true });
    el.addEventListener("scroll", mark, { passive: true });
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
}

/** A box that, on a phone, holds no more than most of the screen and scrolls inside itself, with a fade
 * where there is more (owner, 10-04: "mobile has to be a little more mobile friendly, if theres too much
 * info in any container, make it scrollable"); wider, it is just its children. `max` is how much of the
 * screen it may take. The rule is the app's stylesheet's `.orbs-tall`. */
export function Tall({ children, max = "48dvh", style, label }: { children: ReactNode; max?: string; style?: CSSProperties; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useMoreDown(ref);
  return (
    <div ref={ref} className="orbs-tall" aria-label={label} style={{ ...style, ["--tall" as string]: max }}>
      {children}
    </div>
  );
}

/** A row of choices on one line: centred when it fits; when it does not, it scrolls sideways in its track, with arrows. */
export function OneLine({ children, gap = 6, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) {
  return (
    <SideScroll className="one-line" style={{ display: "flex", flexWrap: "nowrap", gap, overflowX: "auto", justifyContent: "safe center", maxWidth: "100%", scrollbarWidth: "none", ...style }}>
      {children}
    </SideScroll>
  );
}
