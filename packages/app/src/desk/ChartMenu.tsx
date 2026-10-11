// The chart's menu (PLAN 5.32; owner, 10-11: "right click and add lets say indicators, or an orbs strategy so we can
// see it visually. paper or live"): opened where the chart was right-clicked, or by its ƒx button and a long press (on
// a phone, a sheet from the bottom). Indicators over the price and in panes under it; the desk's strategies, each on
// paper (its rules on these bars, as the paper desk runs them) or live (where its orb really traded this coin); each
// orb's own trades here, on paper or real; a study's numbers changed; the chart cleared. Escape or a press outside
// closes it, and only it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Ink } from "../ui/Candles.tsx";
import { KINDS, saneNumbers, STUDIES, studyLabel, type Study, type StudyKind } from "../ui/studies.ts";
import { button, chip, head, small } from "./kit.ts";

export type Mode = "paper" | "live";
export type StrategyItem = { id: number; name: string; who: string; hue: Ink; words: string; mode: Mode | null };
export type OrbItem = { orb: string | null; name: string; hue: Ink; paper: number; real: number; mode: Mode | null };

const WIDTH = 340;

/** Paper and Live, the one on pressed; pressed again, off. */
function Modes({ mode, set, data, live = true }: { mode: Mode | null; set: (m: Mode | null) => void; data: Record<string, string>; live?: boolean }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flex: "0 0 auto" }}>
      {(["paper", "live"] as const).filter((m) => live || m === "paper").map((m) => (
        <button key={m} type="button" {...data} data-mode={m} aria-pressed={mode === m} onClick={() => set(mode === m ? null : m)} style={{ ...chip(mode === m), padding: "4px 10px", minHeight: 28, font: "700 12px/18px var(--font)" }}>
          {m === "paper" ? "Paper" : "Live"}
        </button>
      ))}
    </span>
  );
}

const Row = ({ hue, title, sub, children }: { hue: Ink; title: string; sub: string; children: ReactNode }) => (
  <div data-orb={hue} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: "6px 0" }}>
    <span aria-hidden style={{ flex: "0 0 auto", width: 10, height: 10, borderRadius: 5, background: "var(--accent)" }} />
    <span style={{ display: "grid", minWidth: 0, flex: "1 1 auto" }}>
      <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
      <span style={{ ...small, fontSize: 12, lineHeight: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
    </span>
    {children}
  </div>
);

export function ChartMenu({ at, phone, editing, strategies, orbs, addStudy, setNumbers, removeStudy, drawStrategy, drawOrb, clear, close }: {
  /** where it was opened, on the screen */
  at: { x: number; y: number };
  phone: boolean;
  /** a study whose numbers are being changed, in place of the rest */
  editing: Study | null;
  strategies: StrategyItem[];
  orbs: OrbItem[];
  addStudy: (k: StudyKind) => void;
  setNumbers: (id: string, n: number[]) => void;
  removeStudy: (id: string) => void;
  drawStrategy: (id: number, mode: Mode | null) => void;
  drawOrb: (orb: string | null, mode: Mode | null) => void;
  clear: () => void;
  close: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // where it fits: at the pointer, kept inside the window
  useLayoutEffect(() => {
    if (phone || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPlace({ left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
  }, [at.x, at.y, phone, editing?.id]);
  useEffect(() => {
    // Escape closes the menu and nothing under it (the screen it is on listens for Escape too)
    const esc = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", esc, true);
    // into the menu: its first control on a desk; on a phone the sheet itself (a field focused there would open the keyboard)
    (phone ? box.current : box.current?.querySelector<HTMLElement>("button, input"))?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", esc, true);
  }, [editing?.id]);
  const studyButtons = (on: "price" | "pane") =>
    KINDS.filter((k) => STUDIES[k].on === on).map((k) => (
      <button key={k} type="button" data-add-study={k} title={STUDIES[k].name} aria-label={`Add ${STUDIES[k].name}`} onClick={() => addStudy(k)} style={chip(false)}>
        {k === "bb" ? "Bollinger" : STUDIES[k].short}
      </button>
    ));
  const body = editing ? (
    <div data-study-edit={editing.id} style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={head}>{studyLabel(editing)}</span>
        <span style={{ font: "700 15px/20px var(--font)", color: "var(--text-1)" }}>{STUDIES[editing.kind].name}</span>
      </div>
      {STUDIES[editing.kind].numbers.length === 0 && <span style={small}>Nothing to set: it starts again at each UTC midnight.</span>}
      {STUDIES[editing.kind].numbers.map((num, i) => (
        <label key={num.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, font: "600 14px/20px var(--font)", color: "var(--text-2)" }}>
          {num.label}
          <input type="number" data-study-number={i} min={num.min} max={num.max} step={num.step} defaultValue={editing.n[i]} className="num"
            onChange={(e) => {
              const next = [...editing.n];
              next[i] = Number(e.target.value);
              const sane = saneNumbers(editing.kind, next);
              if (sane && e.target.value !== "") setNumbers(editing.id, sane);
            }}
            style={{ width: 96, font: "700 15px/21px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "6px 10px", boxShadow: "inset 0 0 0 1px var(--hairline)" }} />
        </label>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" data-study-remove onClick={() => (removeStudy(editing.id), close())} style={button}>Take it off</button>
        <button type="button" data-study-done onClick={close} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>Done</button>
      </div>
    </div>
  ) : (
    <div style={{ display: "grid", gap: 14 }}>
      <section aria-label="Indicators" style={{ display: "grid", gap: 8 }}>
        <span style={head}>Indicators</span>
        <span style={{ ...small, fontSize: 12 }}>On the price</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{studyButtons("price")}</div>
        <span style={{ ...small, fontSize: 12 }}>Under it, in a pane</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{studyButtons("pane")}</div>
      </section>
      <section aria-label="Strategies" style={{ display: "grid", gap: 2 }}>
        <span style={head}>Strategies</span>
        {strategies.length === 0 && <span style={small}>None kept yet: build one in Strategies, or an orb proposes one.</span>}
        {strategies.map((s) => (
          <Row key={s.id} hue={s.hue} title={s.name} sub={`${s.who} · ${s.words}`}>
            <Modes mode={s.mode} set={(m) => drawStrategy(s.id, m)} data={{ "data-draw-strategy": String(s.id) }} />
          </Row>
        ))}
      </section>
      <section aria-label="Trades here" style={{ display: "grid", gap: 2 }}>
        <span style={head}>Trades here</span>
        {orbs.length === 0 && <span style={small}>No orb has traded this coin yet: send one to it.</span>}
        {orbs.map((o) => (
          <Row key={o.orb ?? ""} hue={o.hue} title={o.name} sub={[o.paper && `${o.paper} on paper`, o.real && `${o.real} real`].filter(Boolean).join(" · ")}>
            <Modes mode={o.mode} set={(m) => drawOrb(o.orb, m)} data={{ "data-draw-orb": o.orb ?? "you" }} live={o.real > 0 || o.orb === null} />
          </Row>
        ))}
      </section>
      <button type="button" data-chart-clear onClick={() => (clear(), close())} style={{ ...button, justifySelf: "start" }}>Clear the chart</button>
    </div>
  );
  return createPortal(
    <div data-chart-menu style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div aria-hidden onPointerDown={close} onContextMenu={(e) => (e.preventDefault(), close())} style={{ position: "absolute", inset: 0, background: phone ? "var(--ground)" : "transparent", opacity: phone ? 0.6 : 1 }} />
      <div ref={box} role="dialog" aria-label="The chart's menu" tabIndex={-1}
        style={phone
          ? { position: "absolute", left: 0, right: 0, bottom: 0, outline: "none", maxHeight: "78dvh", overflowY: "auto", overscrollBehavior: "contain", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))", borderRadius: "20px 20px 0 0", background: "var(--raised)", boxShadow: "0 -12px 40px var(--shadow), inset 0 0 0 .5px var(--hairline)" }
          : { position: "absolute", outline: "none", left: place?.left ?? at.x, top: place?.top ?? at.y, width: WIDTH, maxHeight: "calc(100dvh - 16px)", overflowY: "auto", overscrollBehavior: "contain", padding: 16, borderRadius: 16, background: "var(--raised)", boxShadow: "0 16px 48px var(--shadow), inset 0 0 0 .5px var(--hairline)", visibility: place ? "visible" : "hidden" }}>
        {body}
      </div>
    </div>,
    document.body,
  );
}
