// The floor's small things (floor/props.ts): where each answers a press on the floor, what it does when it is its turn
// (a shake, something falling to the floor, a bin pushed aside), and nothing at all when it is not. What falls is picked
// up with a press and kept by the home. The game in the games corner takes what is carried to it and asks for its words.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CLASS_DESKS, DESKS, LOW, PIECES, ROOMS, type Rect } from "./plan.ts";
import { CARRIED, NAMES, opens, piecesOf, TURNS, turnNow, type Thing } from "./props.ts";

/** Where each thing is on the plan, and where what it lets fall comes to rest. */
const cls = ROOMS.find((r) => r.id === "classroom")!.rect;
const think = DESKS.find((d) => d.zone === "think" && d.n === 1)!;
const BIN: Rect = { x: cls.x + 183, y: LOW + 52, w: 22, h: 26 };
const SPOTS: Record<Thing, { hit: Rect; from: { x: number; y: number }; to: { x: number; y: number } }> = {
  shelf: { hit: { x: PIECES.bookshelf.x, y: 32, w: PIECES.bookshelf.w, h: PIECES.bookshelf.y + PIECES.bookshelf.h - 32 }, from: { x: PIECES.bookshelf.x + 48, y: 70 }, to: { x: PIECES.bookshelf.x + 44, y: PIECES.bookshelf.y + PIECES.bookshelf.h + 24 } },
  arcade: { hit: { x: PIECES.arcade.x - 4, y: PIECES.arcade.y - 28, w: PIECES.arcade.w + 8, h: PIECES.arcade.h + 32 }, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
  paper: { hit: { x: PIECES.meetingTable.x + 24, y: PIECES.meetingTable.y + 4, w: 34, h: 26 }, from: { x: PIECES.meetingTable.x + 40, y: PIECES.meetingTable.y + 16 }, to: { x: PIECES.meetingTable.x - 14, y: PIECES.meetingTable.y + PIECES.meetingTable.h + 12 } },
  screen: { hit: { x: (think.monitor === "left" ? think.rect.x + 6 : think.rect.x + think.rect.w - 40) - 2, y: think.rect.y - 32, w: 38, h: 38 }, from: { x: think.rect.x + think.rect.w / 2, y: think.rect.y }, to: { x: think.rect.x + think.rect.w / 2 + 8, y: think.rect.y + think.rect.h + 16 } },
  bin: { hit: { x: BIN.x - 4, y: BIN.y - 4, w: BIN.w + 8, h: BIN.h + 8 }, from: { x: BIN.x + BIN.w / 2, y: BIN.y + BIN.h - 6 }, to: { x: BIN.x + BIN.w / 2, y: BIN.y + BIN.h - 6 } },
};
/** The desk whose screen rests on a coin's colour (art.tsx DeskPiece `coin`). */
export const COIN_DESK = { zone: think.zone, n: think.n };
void CLASS_DESKS;

/** A stick, drawn: a body in the menu's colour and its metal end. */
export function StickIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" style={{ display: "block" }}>
      <rect x={5} y={1.5} width={6} height={4} rx={0.8} style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.4 }} />
      <rect x={6.6} y={2.8} width={1} height={1.2} style={{ fill: "currentColor" }} />
      <rect x={8.4} y={2.8} width={1} height={1.2} style={{ fill: "currentColor" }} />
      <rect x={3.5} y={5.5} width={9} height={9} rx={2} style={{ fill: "currentColor", opacity: 0.85 }} />
    </svg>
  );
}
/** A torn piece of paper, drawn. */
export function PaperIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" style={{ display: "block" }}>
      <path d="M3 2 h8 l2 2 v6 l-1.5 1 l1 1.2 l-1.2 1.3 l1 1 l-1.3 1.5 H3 Z" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" }} />
      <path d="M5 6 h5 M5 8.5 h4" style={{ stroke: "currentColor", strokeWidth: 1.2 }} />
    </svg>
  );
}

const shake = (root: HTMLElement | null, thing: Thing, soft: boolean): void => {
  const el = root?.querySelector(`[data-prop="${thing}"]`);
  if (!el) return;
  const cls = soft ? "orbs-prop-nudge" : "orbs-prop-shake";
  el.classList.remove(cls);
  void (el as SVGGraphicsElement).getBoundingClientRect(); // its animation from the start again
  el.classList.add(cls);
};

type Dropped = { id: string; thing: Thing; at: { x: number; y: number }; from: { x: number; y: number } };

export function Props({ root, px, kept, keep, holding, setHolding, opened }: {
  root: HTMLElement | null; px: (v: number) => number; kept: readonly string[]; keep: (id: string) => Promise<void>;
  holding: boolean; setHolding: (h: boolean) => void; opened: () => void;
}) {
  const turn = turnNow(kept);
  const [count, setCount] = useState(0);
  const [dropped, setDropped] = useState<Dropped | null>(null);
  const [bin, setBin] = useState({ x: 0, y: 0 });
  // once what was under the bin is found, the bin stands aside, a reload or another device too
  const binDone = TURNS.some((t) => t.k === "move" && t.on === "bin" && kept.includes(t.drop));
  useEffect(() => {
    if (binDone) setBin((b) => (b.x || b.y ? b : { x: 48, y: 6 }));
  }, [binDone]);
  const [screen, setScreen] = useState(false);
  const live = useRef({ turn, holding, kept });
  live.current = { turn, holding, kept };
  useEffect(() => setCount(0), [turn ? `${turn.k}:${turn.on}` : "done"]);
  const fall = (thing: Thing, id: string): void => setDropped({ id, thing, at: SPOTS[thing].to, from: SPOTS[thing].from });
  const press = (thing: Thing): void => {
    const t = live.current.turn;
    // the stick put in the game: its screen asks for its words whenever it is, and only the last turn's words open it
    if (thing === "arcade" && live.current.holding && live.current.kept.includes(CARRIED.stick)) {
      setScreen(true);
      setHolding(false);
      if (t?.k === "carry" && t.on === thing) void keep(t.gives); // the screen has asked once: the rest can now be found
      return;
    }
    if (!t || t.on !== thing || t.k !== "press" || dropped) return; // not its turn: nothing moves, nothing shakes
    shake(root, thing, thing !== "shelf");
    const n = count + 1;
    setCount(n);
    if (n >= t.n) window.setTimeout(() => fall(thing, t.drop), 380);
  };
  // the stick carried to the game from the side menu (dragged, and let go over it)
  useEffect(() => {
    const onDrop = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === "arcade") {
        setHolding(true);
        live.current.holding = true;
        press("arcade");
      }
    };
    window.addEventListener("orbs-carry-drop", onDrop);
    return () => window.removeEventListener("orbs-carry-drop", onDrop);
  });
  // the bin, pushed with a finger: once it is a little way off, what was under it shows
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const binTurn = turn?.k === "move" && turn.on === "bin";
  const hit = (thing: Thing, children?: ReactNode, extra: CSSProperties = {}) => {
    const r = SPOTS[thing].hit;
    return (
      <div key={thing} data-prop-hit={thing} role="presentation"
        onClick={() => thing !== "bin" && press(thing)}
        style={{ position: "absolute", left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h), zIndex: Math.round(r.y + r.h) + 2, ...extra }}>
        {children}
      </div>
    );
  };
  const at = (p: { x: number; y: number }): CSSProperties => ({ position: "absolute", left: px(p.x), top: px(p.y), zIndex: Math.round(p.y) + 3 });
  return (
    <>
      {hit("shelf")}
      {hit("arcade")}
      {hit("paper")}
      {hit("screen")}
      {/* the bin in front of the classroom's board: still unless it is its turn */}
      <div data-prop-hit="bin" role="presentation" data-moved={bin.x || bin.y ? "true" : "false"}
        onPointerDown={(e) => {
          if (!binTurn) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: bin.x, oy: bin.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const k = px(1);
          setBin({ x: Math.max(-90, Math.min(90, d.ox + (e.clientX - d.x) / k)), y: Math.max(-30, Math.min(40, d.oy + (e.clientY - d.y) / k)) });
        }}
        onPointerUp={() => {
          drag.current = null;
          if (binTurn && Math.hypot(bin.x, bin.y) >= 28 && !dropped) fall("bin", turn.drop);
        }}
        style={{ position: "absolute", left: px(SPOTS.bin.hit.x + bin.x), top: px(SPOTS.bin.hit.y + bin.y), width: px(SPOTS.bin.hit.w), height: px(SPOTS.bin.hit.h), zIndex: Math.round(BIN.y + BIN.h) + 4, touchAction: binTurn ? "none" : "auto" }}>
        <svg aria-hidden viewBox="-2 -2 30 34" width="100%" height="100%" style={{ display: "block" }}>
          <path d="M4 8 h18 l-2 22 h-14 Z" style={{ fill: "var(--raised)", stroke: "var(--hairline)", strokeWidth: 1 }} />
          <rect x={2} y={5} width={22} height={4} rx={1.5} style={{ fill: "var(--text-3)" }} />
          <path d="M9 12 v15 M13 12 v15 M17 12 v15" style={{ stroke: "var(--fill-2)", strokeWidth: 1.2 }} />
          <circle cx={11} cy={4} r={3} style={{ fill: "var(--text-2)" }} opacity={0.9} />
        </svg>
      </div>
      {/* what fell, waiting to be picked up */}
      {dropped && (
        <button type="button" data-dropped={dropped.thing} aria-label="Pick it up" className="orbs-tag"
          onClick={() => {
            const d = dropped;
            setDropped(null);
            void keep(d.id);
          }}
          style={{ ...at({ x: dropped.at.x - 11, y: dropped.at.y - 11 }), width: px(22), height: px(22), padding: 0, border: 0, background: "transparent", cursor: "pointer",
            ["--from-x" as string]: `${px(dropped.from.x - dropped.at.x)}px`, ["--from-y" as string]: `${px(dropped.from.y - dropped.at.y)}px`,
            animation: "orbs-prop-fall 900ms cubic-bezier(.3, .7, .4, 1) both, orbs-prop-glint 1.6s ease-in-out 1s infinite" } as CSSProperties}>
          <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", color: "var(--text-1)" }}>{dropped.id === CARRIED.stick ? <StickIcon size={px(18)} /> : <PaperIcon size={px(18)} />}</span>
        </button>
      )}
      {screen && <GameScreen code={turn?.k === "code"} close={() => setScreen(false)} granted={async () => (await keep(CARRIED.open), opened())} />}
    </>
  );
}

/** A thing carried in the side menu: pressed, it is taken in hand (`take`); dragged and let go over something on the
 * floor, it is offered to that (Props' "orbs-carry-drop"). */
export function Carried({ label, icon, take, style }: { label: string; icon: ReactNode; take: () => void; style: CSSProperties }) {
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const from = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <>
      <button type="button" data-carried
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          from.current = { x: e.clientX, y: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const f = from.current;
          if (!f || (!f.moved && Math.hypot(e.clientX - f.x, e.clientY - f.y) < 6)) return;
          f.moved = true;
          setGhost({ x: e.clientX, y: e.clientY });
        }}
        onPointerUp={(e) => {
          const f = from.current;
          from.current = null;
          setGhost(null);
          if (!f) return;
          if (!f.moved) return take();
          const on = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest("[data-prop-hit]")?.getAttribute("data-prop-hit")).find(Boolean);
          if (on) window.dispatchEvent(new CustomEvent("orbs-carry-drop", { detail: on }));
        }}
        onPointerCancel={() => {
          from.current = null;
          setGhost(null);
        }}
        onClick={(e) => e.detail === 0 && take() /* a key's press: a pointer's is its pointerup's */}
        style={{ ...style, touchAction: "none", cursor: ghost ? "grabbing" : "grab" }}>
        {icon}
        {label}
      </button>
      {ghost && createPortal(<div aria-hidden data-carrying style={{ position: "fixed", left: ghost.x - 13, top: ghost.y - 13, width: 26, height: 26, display: "grid", placeItems: "center", borderRadius: 8, background: "var(--card)", boxShadow: "0 6px 18px var(--shadow), inset 0 0 0 1px var(--hairline)", color: "var(--text-1)", pointerEvents: "none", zIndex: 70 }}>{icon}</div>, document.body)}
    </>
  );
}

/** The game's screen: it asks for its words; the wrong ones are refused, the right ones open it. */
function GameScreen({ code, close, granted }: { code: boolean; close: () => void; granted: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [said, setSaid] = useState<"denied" | "granted" | null>(null);
  const [n, setN] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const mono = "var(--mono)";
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="The game's screen" data-game-screen style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: "var(--s5) var(--margin)" }}>
      <div aria-hidden onClick={close} style={{ position: "absolute", inset: 0, background: "var(--ground)", opacity: 0.82 }} />
      <form data-orb="lime" onSubmit={(e) => {
        e.preventDefault();
        void (async () => {
          if (code && (await opens(typed))) {
            setSaid("granted");
            window.setTimeout(() => void granted(), 1_100);
          } else {
            setSaid("denied");
            setN((x) => x + 1);
          }
        })();
      }}
        style={{ position: "relative", width: "min(520px, 100%)", display: "grid", gap: 14, padding: "28px 26px", borderRadius: 18, background: "var(--ground)", boxShadow: "0 0 0 2px var(--accent-fill), 0 0 40px var(--accent-glow)", animation: said === "denied" ? `${n % 2 ? "orbs-flash-a" : "orbs-flash-b"} 500ms ease-out` : undefined }}>
        <span style={{ font: `800 22px/28px ${mono}`, letterSpacing: ".08em", color: "var(--accent)", textAlign: "center" }}>{said === "granted" ? NAMES.yes : NAMES.ask}</span>
        <input ref={field} aria-label={NAMES.field} value={typed} onChange={(e) => (setTyped(e.target.value), setSaid(null))} autoComplete="off" spellCheck={false} size={1}
          style={{ font: `700 20px/28px ${mono}`, color: "var(--accent)", background: "var(--card)", border: 0, borderRadius: 10, padding: "10px 14px", outline: 0, boxShadow: "inset 0 0 0 1.5px var(--accent-fill)", textAlign: "center", letterSpacing: ".06em" }} />
        <span aria-live="polite" data-said={said ?? ""} style={{ minHeight: 22, font: `800 16px/22px ${mono}`, letterSpacing: ".1em", textAlign: "center", color: said === "denied" ? "var(--off)" : "var(--accent)" }}>{said === "denied" ? NAMES.no : said === "granted" ? "Opening…" : ""}</span>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="submit" style={{ font: `800 15px/20px ${mono}`, color: "var(--ground)", background: "var(--accent)", border: 0, borderRadius: 10, padding: "10px 22px", cursor: "pointer", minHeight: 44 }}>Enter</button>
          <button type="button" onClick={close} style={{ font: "700 15px/20px var(--font)", color: "var(--text-2)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer", minHeight: 44 }}>Leave it</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** What was found so far: three pieces side by side, each with its third of the words. */
export function PaperView({ kept, close }: { kept: readonly string[]; close: () => void }) {
  const pieces = piecesOf(kept);
  const have = pieces.filter(Boolean).length;
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`A ${NAMES.paper.toLowerCase()}: ${have} of 3`} data-paper-view={have} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: "var(--s5) var(--margin)" }}>
      <div aria-hidden onClick={close} style={{ position: "absolute", inset: 0, background: "var(--ground)", opacity: 0.88 }} />
      <div style={{ position: "relative", display: "grid", gap: 14, justifyItems: "center", width: "min(620px, 100%)" }}>
        <span style={{ font: "800 16px/22px var(--font)", color: "var(--text-1)" }}>{`A ${NAMES.paper.toLowerCase()} · ${have} of 3`}</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", width: "100%" }}>
          {pieces.map((w, i) => (
            <div key={i} data-piece={i} data-found={w ? "true" : "false"}
              style={{ minHeight: 120, display: "grid", placeItems: "center", padding: "18px 6px", background: w ? "var(--text-2)" : "var(--card)", boxShadow: w ? "0 6px 18px var(--shadow)" : "inset 0 0 0 1.5px var(--hairline)", borderRadius: 4,
                clipPath: i === 0 ? "polygon(0 0, 100% 0, 96% 18%, 100% 36%, 95% 55%, 100% 74%, 96% 90%, 100% 100%, 0 100%)" : i === 1 ? "polygon(4% 0, 100% 0, 96% 20%, 100% 40%, 95% 62%, 100% 80%, 97% 100%, 0 100%, 5% 82%, 0 64%, 4% 44%, 0 24%)" : "polygon(0 0, 100% 0, 100% 100%, 3% 100%, 0 84%, 5% 64%, 0 44%, 4% 22%)" }}>
              {w ? <span style={{ font: "700 clamp(15px, 4vw, 22px)/1.2 var(--mono)", letterSpacing: ".04em", color: "var(--ground)", transform: `rotate(${i === 1 ? 1.5 : -1.5}deg)`, overflowWrap: "anywhere", textAlign: "center" }}>{w}</span> : <span style={{ font: "600 13px/18px var(--font)", color: "var(--text-3)" }}>missing</span>}
            </div>
          ))}
        </div>
        <button type="button" onClick={close} style={{ font: "700 15px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer", minHeight: 44 }}>Put it away</button>
      </div>
    </div>,
    document.body,
  );
}
