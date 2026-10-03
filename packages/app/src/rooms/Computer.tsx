// His computer (PLAN 2.8; owner, 10-01: "we want to see what theire doing ... wether its an excel
// file were creating or an app or just doing our finances"). A panel in his own colour, the way
// the Dots film shows it:
//   - Work: what he is making, shown as what it is (rooms/work.ts): a dataset as its table, a page
//     as the page (its scripts do not run here), a dashboard's numbers as bars, a document, a
//     calendar's events, or the code;
//   - Browser: his own browser (PLAN 4.1, 4.6): the last still of his screen, or his screen live,
//     his face where he last clicked, and your hands on it (take over: clicks on his screen, typing,
//     an address; hand back; reset);
//   - Files: his workspace; Terminal: his commands and what they print as they print it, and yours
//     when you have his computer; Activity: every step;
//   - him as the cursor: his own orb, which goes to where his last step acted and stays put
//     otherwise, with a little hop and a chime when he finishes.
// Every number in it is read from his files and his run: none is typed.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import type { Gesture } from "../orb/life.ts";
import { type ComputerState, type Hands, idOf, type Entry, type Message, type Office, type WorkFile } from "../home/link.ts";
import { play } from "../ui/sound.ts";
import { OneLine } from "../ui/Balanced.tsx";
import { ACT_WORDS, actsOf, chartOf, docBlocks, filesOf, icsEvents, kindOf, parseCsv, type Act, type Kind } from "./work.ts";

type Tab = "Work" | "Browser" | "Files" | "Terminal" | "Activity";
const TABS: Tab[] = ["Work", "Browser", "Files", "Terminal", "Activity"];
const MARK: Record<Kind | "folder", string> = { dataset: "▦", ui: "◧", dashboard: "▥", doc: "▤", calendar: "☷", code: "‹›", folder: "▸" };
const KIND_WORDS: Record<Kind, string> = { dataset: "Dataset", ui: "Page", dashboard: "Dashboard", doc: "Document", calendar: "Calendar", code: "Code" };
const mono: CSSProperties = { font: "500 12px/18px var(--mono)", color: "var(--text-2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 };
const hhmm = (t: number): string => new Date(t).toTimeString().slice(0, 5);

export function Computer(o: { home: Office; orb: Character; messages: Message[]; busy?: "thinking" | "speaking"; big?: boolean }) {
  const id = idOf(o.orb.name);
  const acts = actsOf(o.messages, id);
  const latest = acts[acts.length - 1];
  const written = filesOf(acts.filter((a) => a.tool === "write_file"));
  const [tab, setTab] = useState<Tab>("Work");
  const [chosen, setChosen] = useState<string | null>(null);
  const open = chosen ?? written[written.length - 1] ?? null;
  // the step that last touched the open file: a new one reloads it
  const lastOnOpen = [...acts].reverse().find((a) => a.args.path === open && a.tool === "write_file" && a.result !== null);
  const [file, setFile] = useState<WorkFile | null>(null);
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // his browser's own news (a still, a sleep, your hand on it): its state is looked at again; and
  // what his commands print, as they print it (PLAN 4.6)
  const [screenNews, setScreenNews] = useState(0);
  const [liveOut, setLiveOut] = useState<Record<string, string>>({});
  useEffect(
    () =>
      o.home.watch({
        event: (e) => (e.orb === id && e.type.startsWith("computer.") ? setScreenNews((n) => n + 1) : undefined),
        terminal: (d) => (d.orb === id ? setLiveOut((m) => ({ ...m, [d.call]: ((m[d.call] ?? "") + d.chunk).slice(-20_000) })) : undefined),
      }),
    [o.home, id],
  );
  const [cstate, setCstate] = useState<ComputerState | null>(null);
  useEffect(() => {
    let live = true;
    o.home.computer(o.orb).then((s) => live && setCstate(s), (e: Error) => live && setSaid(e.message));
    return () => {
      live = false;
    };
  }, [o.home, id, screenNews]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    o.home.file(o.orb, open).then((f) => live && setFile(f), (e: Error) => live && setSaid(e.message));
    return () => {
      live = false;
    };
  }, [open, lastOnOpen?.id]);
  const writes = acts.filter((a) => a.tool === "write_file" && a.result !== null).length;
  useEffect(() => {
    if (tab !== "Files") return;
    let live = true;
    o.home.files(o.orb, dir).then((e) => live && setEntries(e), (e: Error) => live && setSaid(e.message));
    return () => {
      live = false;
    };
  }, [tab, dir, writes]);

  // him as the cursor: on what his last step acted on, when it is on screen; out of sight when it
  // is not (left where it was, he would point at something he did not touch)
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const root = panel.current;
    if (!root || !latest) return;
    const el = root.querySelector<HTMLElement>(`[data-act="${CSS.escape(latest.id)}"]`);
    if (!el) {
      setAt(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const p = root.getBoundingClientRect();
    const next = { x: Math.round(r.left - p.left + root.scrollLeft + Math.min(56, r.width / 2)), y: Math.round(r.top - p.top + root.scrollTop + r.height / 2) };
    setAt((a) => (a && a.x === next.x && a.y === next.y ? a : next));
  });
  // done: a hop, and a chime
  const [gesture, setGesture] = useState<{ name: Gesture; n: number } | null>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !o.busy && acts.length) {
      setGesture((g) => ({ name: "hop", n: (g?.n ?? 0) + 1 }));
      play("create");
    }
    wasBusy.current = Boolean(o.busy);
  }, [o.busy]);

  const doing = latest && latest.result === null ? `${ACT_WORDS[latest.tool] ?? latest.tool} ${latest.on}: waiting for your OK` : o.busy === "speaking" ? "Writing to you" : o.busy ? "Working" : acts.length ? "Done for now" : "Waiting for work";
  return (
    <section data-orb={o.orb.hue} data-computer={id} aria-label={`${o.orb.name}'s computer`} style={{ position: "relative", display: "grid", gridTemplateRows: "auto auto 1fr", minWidth: 0, borderRadius: 18, background: "var(--card)", boxShadow: "inset 0 0 0 1.5px var(--accent), 0 8px 24px var(--shadow)", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--accent-wash)", minWidth: 0 }}>
        <Orb character={o.orb} size={30} state={o.busy ?? "idle"} poke={false} />
        <div style={{ display: "grid", minWidth: 0 }}>
          <span style={{ font: "800 14px/18px var(--font)", color: "var(--text-1)" }}>{o.orb.name}'s computer</span>
          <span data-doing style={{ font: "500 12px/16px var(--font)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doing}</span>
        </div>
      </header>
      {/* five tabs: on a phone the row scrolls with a fade, never wider than his panel */}
      <div role="tablist" aria-label={`${o.orb.name}'s computer`} style={{ padding: "6px 8px 0", boxShadow: "inset 0 -1px 0 var(--sep)", minWidth: 0 }}>
        <OneLine gap={2} style={{ justifyContent: "flex-start" }}>
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ flex: "0 0 auto", whiteSpace: "nowrap", font: "700 12px/16px var(--font)", border: 0, background: "transparent", padding: "8px 10px", cursor: "pointer", color: tab === t ? "var(--text-1)" : "var(--text-3)", boxShadow: tab === t ? "inset 0 -2px 0 var(--accent)" : "none", minHeight: 32 }}>
              {t}
            </button>
          ))}
        </OneLine>
      </div>
      <div ref={panel} style={{ position: "relative", minWidth: 0, minHeight: o.big ? 320 : 200, maxHeight: o.big ? 560 : 360, overflowY: "auto", padding: 12 }}>
        {tab === "Work" && <Work open={open} file={file} acts={acts} touched={lastOnOpen} />}
        {tab === "Browser" && <Browser home={o.home} orb={o.orb} state={cstate} setState={setCstate} />}
        {tab === "Files" && (
          <Files
            dir={dir}
            entries={entries}
            acts={acts}
            go={setDir}
            pick={(p) => {
              setChosen(p);
              setTab("Work");
            }}
          />
        )}
        {tab === "Terminal" && <Terminal home={o.home} orb={o.orb} acts={acts.filter((a) => a.tool === "shell" || a.tool === "shell_output")} live={liveOut} yours={cstate?.takenOver ?? false} />}
        {tab === "Activity" && <Activity acts={acts} />}
        {said && <span role="alert" style={{ font: "500 12px/16px var(--font)", color: "var(--alert)" }}>{said}</span>}
        {at && (
          <div data-cursor aria-hidden style={{ position: "absolute", left: 0, top: 0, width: 32, transform: `translate(${at.x - 16}px, ${at.y - 15}px)`, transition: "transform 460ms var(--m-spring)", pointerEvents: "none", filter: "drop-shadow(0 3px 6px var(--shadow))" }}>
            <Orb character={o.orb} size={32} poke={false} fidget={false} gesture={gesture} framing="portrait" />
            {/* a ring where his step lands: it rests unseen at his size, and grows only while it plays */}
            {latest && <i key={latest.id} style={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: "0 0 0 2px var(--accent)", opacity: 0, animation: "orbs-click 520ms ease-out" }} />}
          </div>
        )}
      </div>
    </section>
  );
}

function Work({ open, file, acts, touched }: { open: string | null; file: WorkFile | null; acts: Act[]; touched: Act | undefined }) {
  const [source, setSource] = useState(false);
  if (!open) return <Quiet>{acts.length ? "Nothing made yet: what he does is under Activity." : "Nothing on his screen yet."}</Quiet>;
  if (!file || file.path !== open) return <Quiet>Opening {open}…</Quiet>;
  if (file.text === null) return <Quiet>{open} is not a text file ({file.size} bytes).</Quiet>;
  const kind = kindOf(open, file.text);
  const mark = touched?.id; // the part he changed last gets the cursor
  const title = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, minWidth: 0 }}>
      <span style={{ font: "700 13px/18px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span aria-hidden style={{ color: "var(--accent)" }}>{MARK[kind]}</span> {open}
      </span>
      <span style={{ display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }}>
        <span data-kind={kind} style={{ font: "700 11px/16px var(--font)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)" }}>{KIND_WORDS[kind]}</span>
        {kind !== "code" && (
          <button onClick={() => setSource((v) => !v)} aria-pressed={source} style={{ font: "600 11px/16px var(--font)", border: 0, borderRadius: 8, padding: "2px 8px", background: "var(--fill)", color: "var(--text-2)", cursor: "pointer" }}>
            Source
          </button>
        )}
      </span>
    </div>
  );
  const cut = file.truncated && <span style={{ font: "500 11px/16px var(--font)", color: "var(--text-3)" }}>Showing the first {Math.round(file.text.length / 1024)} KB of {Math.round(file.size / 1024)} KB.</span>;
  if (source || kind === "code") {
    const lines = file.text.replace(/\n$/, "").split("\n").slice(0, 400);
    return (
      <div>
        {title}
        <pre style={{ ...mono, display: "grid", gap: 0 }}>
          {lines.map((l, i) => (
            <span key={i} data-act={i === lines.length - 1 ? mark : undefined}>
              <span aria-hidden style={{ display: "inline-block", width: 32, color: "var(--text-3)", userSelect: "none" }}>{i + 1}</span>
              {l || " "}
            </span>
          ))}
        </pre>
        {cut}
      </div>
    );
  }
  if (kind === "dataset") {
    const rows = parseCsv(file.text);
    const [head, ...body] = rows;
    const cols = Math.max(...rows.map((r) => r.length));
    return (
      <div style={{ minWidth: 0 }}>
        {title}
        <span data-counts style={{ display: "block", font: "600 12px/16px var(--font)", color: "var(--text-3)", marginBottom: 6 }}>
          {body.length} {body.length === 1 ? "row" : "rows"} · {cols} {cols === 1 ? "column" : "columns"}
        </span>
        <div style={{ overflowX: "auto", borderRadius: 10, boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
          <table style={{ borderCollapse: "collapse", font: "500 12px/18px var(--font)", color: "var(--text-1)", minWidth: "100%" }}>
            <thead>
              <tr>
                {(head ?? []).map((h, i) => (
                  <th key={i} style={{ textAlign: "left", padding: "6px 10px", background: "var(--fill)", font: "700 12px/18px var(--font)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.slice(0, 60).map((r, i, shown) => (
                <tr key={i} data-act={i === shown.length - 1 ? mark : undefined} style={{ boxShadow: "inset 0 1px 0 var(--sep)" }}>
                  {Array.from({ length: cols }, (_, j) => (
                    <td key={j} style={{ padding: "5px 10px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r[j] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {body.length > 60 && <span style={{ font: "500 11px/16px var(--font)", color: "var(--text-3)" }}>The first 60 of {body.length} rows.</span>}
        {cut}
      </div>
    );
  }
  if (kind === "ui") {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        {title}
        {/* his page, as a page: in its own sandbox, with nothing of the app's, its scripts off */}
        <iframe data-act={mark} title={`${open}, as a page`} sandbox="" srcDoc={file.text} style={{ width: "100%", height: 300, border: 0, borderRadius: 10, background: "var(--raised)", boxShadow: "inset 0 0 0 1px var(--hairline)" }} />
        <span style={{ font: "500 11px/16px var(--font)", color: "var(--text-3)" }}>A preview: its scripts do not run here.</span>
      </div>
    );
  }
  if (kind === "dashboard") {
    const c = chartOf(file.text)!;
    const max = Math.max(...c.bars.map((b) => b.value), 0) || 1;
    const shown = c.bars.slice(0, 24);
    return (
      <div style={{ minWidth: 0 }}>
        {title}
        <span style={{ display: "block", font: "700 13px/18px var(--font)", color: "var(--text-1)", marginBottom: 8 }}>
          {c.value} by {c.label}
        </span>
        <div data-act={mark} role="img" aria-label={`${c.value} by ${c.label}: ${shown.map((b) => `${b.label} ${b.value}`).join(", ")}`} style={{ display: "grid", gap: 6 }}>
          {shown.map((b, i) => (
            <div key={i} data-bar={b.label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 7em) 1fr auto", alignItems: "center", gap: 8 }}>
              <span style={{ font: "600 12px/16px var(--font)", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label}</span>
              <span style={{ height: 14, borderRadius: 7, background: "var(--fill)", overflow: "hidden" }}>
                <i style={{ display: "block", height: "100%", width: `${Math.max(0, (b.value / max) * 100)}%`, borderRadius: 7, background: "var(--accent)", transformOrigin: "0 50%", animation: "orbs-grow 520ms var(--m-spring) both" }} />
              </span>
              <span style={{ font: "700 12px/16px var(--font)", color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>{b.value}</span>
            </div>
          ))}
        </div>
        {c.bars.length > shown.length && <span style={{ font: "500 11px/16px var(--font)", color: "var(--text-3)" }}>The first {shown.length} of {c.bars.length}.</span>}
      </div>
    );
  }
  if (kind === "calendar") {
    const evs = icsEvents(file.text);
    return (
      <div>
        {title}
        {!evs.length && <Quiet>No events in it yet.</Quiet>}
        <div style={{ display: "grid", gap: 6 }}>
          {evs.slice(0, 60).map((e, i, shown) => (
            <div key={i} data-act={i === shown.length - 1 ? mark : undefined} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "baseline" }}>
              <span style={{ font: "700 12px/16px var(--mono)", color: "var(--accent)" }}>{e.start}</span>
              <span style={{ font: "500 13px/18px var(--font)", color: "var(--text-1)" }}>{e.summary}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const blocks = docBlocks(file.text);
  return (
    <article style={{ display: "grid", gap: 8, color: "var(--text-1)" }}>
      {title}
      {blocks.map((b, i) => {
        const m = i === blocks.length - 1 ? mark : undefined;
        if (b.kind === "h1") return <h3 key={i} data-act={m} style={{ margin: 0, font: "800 18px/24px var(--font)" }}>{b.text}</h3>;
        if (b.kind === "h2") return <h4 key={i} data-act={m} style={{ margin: 0, font: "800 15px/20px var(--font)" }}>{b.text}</h4>;
        if (b.kind === "h3") return <h5 key={i} data-act={m} style={{ margin: 0, font: "700 14px/20px var(--font)" }}>{b.text}</h5>;
        if (b.kind === "li") return <div key={i} data-act={m} style={{ font: "400 14px/20px var(--font)", paddingLeft: 14, textIndent: -10 }}>• {b.text}</div>;
        if (b.kind === "code") return <pre key={i} data-act={m} style={{ ...mono, padding: 8, borderRadius: 8, background: "var(--fill)" }}>{b.text}</pre>;
        return <p key={i} data-act={m} style={{ margin: 0, font: "400 14px/21px var(--font)" }}>{b.text}</p>;
      })}
      {cut}
    </article>
  );
}

/** His browser (PLAN 4.1, 4.6): the last still of his screen, or his screen live, with his face
 * where he last clicked; your hands on it once you take it over (a press on his screen is a click
 * there, typing, a key, an address), and a reset in two presses. */
function Browser({ home, orb, state, setState }: { home: Office; orb: Character; state: ComputerState | null; setState: (s: ComputerState) => void }) {
  const [asking, setAsking] = useState(false);
  const [watching, setWatching] = useState(false);
  const [typed, setTyped] = useState("");
  const [address, setAddress] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const act = (a: "take-over" | "hand-back" | "reset"): void => {
    setSaid(null);
    setAsking(false);
    home.computerAct(orb, a).then(setState, (e: Error) => setSaid(e.message));
  };
  const hand = (h: Hands): void => {
    setSaid(null);
    home.hands(orb, h).then(setState, (e: Error) => setSaid(e.message));
  };
  if (!state) return <Quiet>Looking…</Quiet>;
  const s = state.screen;
  const live = watching || state.takenOver; // in your hands, you see him as he is
  const small: CSSProperties = { font: "500 12px/16px var(--font)", color: "var(--text-3)", overflowWrap: "anywhere" };
  const button: CSSProperties = { font: "600 12px/16px var(--font)", border: 0, borderRadius: 8, padding: "6px 10px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 30, flex: "0 0 auto" };
  const field: CSSProperties = { flex: "1 1 120px", minWidth: 0, font: "500 13px/18px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 8, padding: "6px 10px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" };
  const width = s?.width ?? 1280;
  const height = s?.height ?? 800;
  return (
    <div data-browser style={{ display: "grid", gap: 8, minWidth: 0 }}>
      {s && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span data-address style={{ flex: "1 1 auto", minWidth: 0, font: "600 12px/16px var(--mono)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.url}</span>
          <span style={{ ...small, flex: "0 0 auto" }}>{live ? "live" : hhmm(s.at)}</span>
        </div>
      )}
      {live ? (
        <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", boxShadow: state.takenOver ? "inset 0 0 0 2px var(--accent)" : "inset 0 0 0 1px var(--hairline)", background: "var(--raised)", cursor: state.takenOver ? "crosshair" : "default" }}>
          {/* his screen, frame by frame; in your hands a press on it is a click there, on his screen */}
          <img
            data-live
            key={state.awake ? "awake" : "asleep"} // woken again (after a reset), the stream starts again
            src={home.liveUrl(orb)}
            alt={`${orb.name}'s screen, live`}
            onClick={(e) => {
              if (!state.takenOver) return;
              const r = e.currentTarget.getBoundingClientRect();
              hand({ kind: "click", x: Math.round(((e.clientX - r.left) / r.width) * width), y: Math.round(((e.clientY - r.top) / r.height) * height) });
            }}
            style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${width} / ${height}` }}
          />
          {s?.cursor && (
            <div data-browser-cursor aria-hidden style={{ position: "absolute", left: `${(s.cursor.x / width) * 100}%`, top: `${(s.cursor.y / height) * 100}%`, width: 28, transform: "translate(-14px, -13px)", pointerEvents: "none", filter: "drop-shadow(0 3px 6px var(--shadow))", transition: "left 360ms var(--m-spring), top 360ms var(--m-spring)" }}>
              <Orb character={orb} size={28} poke={false} fidget={false} framing="portrait" />
            </div>
          )}
        </div>
      ) : s ? (
        <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", boxShadow: "inset 0 0 0 1px var(--hairline)", background: "var(--raised)" }}>
          {/* small here: a press opens his screen at its own size */}
          <a href={home.screenUrl(orb, s.shot)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${orb.name}'s screen at full size`} style={{ display: "block" }}>
            <img src={home.screenUrl(orb, s.shot)} alt={`${orb.name}'s screen: ${s.title || s.url}`} style={{ display: "block", width: "100%", height: "auto" }} />
          </a>
          {s.cursor && (
            <div data-browser-cursor aria-hidden style={{ position: "absolute", left: `${(s.cursor.x / width) * 100}%`, top: `${(s.cursor.y / height) * 100}%`, width: 28, transform: "translate(-14px, -13px)", pointerEvents: "none", filter: "drop-shadow(0 3px 6px var(--shadow))" }}>
              <Orb character={orb} size={28} poke={false} fidget={false} framing="portrait" />
            </div>
          )}
        </div>
      ) : (
        <Quiet>{state.awake ? "His browser is open, on nothing yet." : "His browser is asleep: it wakes when he opens a page."}</Quiet>
      )}
      {state.takenOver && (
        <div data-hands style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (address.trim()) hand({ kind: "go", url: /^https?:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}` });
            }}
            style={{ display: "flex", gap: 6, minWidth: 0 }}
          >
            <button type="button" onClick={() => hand({ kind: "back" })} aria-label="Back" style={button}>
              ‹
            </button>
            <button type="button" onClick={() => hand({ kind: "reload" })} aria-label="Reload" style={button}>
              ↻
            </button>
            <input value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Go to an address" placeholder="An address" size={1} autoComplete="off" spellCheck={false} style={field} />
            <button type="submit" style={button}>
              Go
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (typed) hand({ kind: "type", text: typed });
              setTyped("");
            }}
            style={{ display: "flex", gap: 6, minWidth: 0 }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type on his page" placeholder="Type on his page" size={1} autoComplete="off" style={field} />
            <button type="submit" style={button}>
              Type
            </button>
            <button type="button" onClick={() => hand({ kind: "key", key: "Enter" })} style={button}>
              Enter
            </button>
          </form>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {state.takenOver ? (
          <button onClick={() => act("hand-back")} data-sound="pick" style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
            Hand back
          </button>
        ) : (
          <>
            <button onClick={() => act("take-over")} style={button}>
              Take over
            </button>
            <button onClick={() => setWatching((w) => !w)} aria-pressed={watching} style={button}>
              {watching ? "Stop watching" : "Watch live"}
            </button>
          </>
        )}
        {asking ? (
          <>
            <span style={small}>Sign him out of every site?</span>
            <button onClick={() => act("reset")} style={{ ...button, color: "var(--alert)" }}>
              Reset
            </button>
            <button onClick={() => setAsking(false)} style={button}>
              Keep
            </button>
          </>
        ) : (
          <button onClick={() => setAsking(true)} style={button}>
            Reset his browser
          </button>
        )}
      </div>
      {state.takenOver && <span style={small}>You have his computer: a press on his screen clicks there. He waits until you hand it back.</span>}
      {said && <span role="alert" style={{ font: "500 12px/16px var(--font)", color: "var(--alert)" }}>{said}</span>}
    </div>
  );
}

function Files({ dir, entries, acts, go, pick }: { dir: string; entries: Entry[] | null; acts: Act[]; go: (d: string) => void; pick: (p: string) => void }) {
  const lastOn = new Map<string, string>();
  for (const a of acts) if (typeof a.args.path === "string") lastOn.set(a.args.path, a.id);
  if (!entries) return <Quiet>Looking…</Quiet>;
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {dir && (
        <button onClick={() => go(dir.split("/").slice(0, -1).join("/"))} style={row(false)}>
          <span aria-hidden>‹</span> {dir}
        </button>
      )}
      {!entries.length && <Quiet>His computer is empty: nothing made yet.</Quiet>}
      {entries.map((e) => {
        const name = e.path.split("/").pop()!;
        const act = lastOn.get(e.path);
        return (
          <button key={e.path} data-act={act} data-file={e.path} onClick={() => (e.dir ? go(e.path) : pick(e.path))} style={row(Boolean(act))}>
            <span aria-hidden style={{ width: 18, color: "var(--accent)" }}>{e.dir ? MARK.folder : MARK[kindOf(e.path)]}</span>
            <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{name}</span>
            {act && <span style={{ font: "700 10px/14px var(--font)", letterSpacing: ".06em", color: "var(--accent)" }}>HERE</span>}
            {!e.dir && <span style={{ font: "500 11px/16px var(--font)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{e.size < 1024 ? `${e.size} B` : `${Math.round(e.size / 1024)} KB`}</span>}
          </button>
        );
      })}
    </div>
  );
}
const row = (here: boolean): CSSProperties => ({ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", border: 0, borderRadius: 8, cursor: "pointer", background: here ? "var(--accent-wash)" : "transparent", font: "600 13px/18px var(--font)", color: "var(--text-1)", minHeight: 32 });

/** His commands and what they printed, the running one as it prints (PLAN 4.6); and, once you
 * have his computer, a line for your own, run in his sandbox. */
function Terminal({ home, orb, acts, live, yours }: { home: Office; orb: Character; acts: Act[]; live: Record<string, string>; yours: boolean }) {
  const [line, setLine] = useState("");
  const [mine, setMine] = useState<{ command: string; output: string | null; failed: boolean }[]>([]);
  const running = Object.keys(live).filter((k) => k.startsWith("you-")).at(-1); // your command printing now
  const run = (): void => {
    const command = line.trim();
    if (!command) return;
    setLine("");
    setMine((m) => [...m, { command, output: null, failed: false }]);
    home.terminal(orb, command).then(
      (r) => setMine((m) => m.map((x, i) => (i === m.length - 1 ? { command, output: r.output, failed: r.failed } : x))),
      (e: Error) => setMine((m) => m.map((x, i) => (i === m.length - 1 ? { command, output: e.message, failed: true } : x))),
    );
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {!acts.length && !mine.length && <Quiet>No commands yet.</Quiet>}
      {(acts.length > 0 || mine.length > 0) && (
        <div style={{ display: "grid", gap: 10, padding: 10, borderRadius: 10, background: "var(--ground)" }}>
          {acts.map((a) => (
            <div key={a.id} style={{ display: "grid", gap: 2 }}>
              <span data-act={a.id} style={{ ...mono, color: "var(--text-1)" }}>
                <span style={{ color: "var(--accent)" }}>$ </span>
                {a.tool === "shell" ? String(a.args.command ?? "") : `(${ACT_WORDS[a.tool]?.toLowerCase() ?? a.tool} ${a.on})`}
              </span>
              <pre data-output={a.id} style={{ ...mono, color: a.failed ? "var(--alert)" : "var(--text-3)" }}>
                {a.result === null ? (live[a.id] ?? "waiting for your OK…") : a.result.split("\n").slice(0, 40).join("\n")}
              </pre>
            </div>
          ))}
          {mine.map((x, i) => (
            <div key={`you-${i}`} data-yours style={{ display: "grid", gap: 2 }}>
              <span style={{ ...mono, color: "var(--text-1)" }}>
                <span style={{ color: "var(--text-3)" }}>you $ </span>
                {x.command}
              </span>
              <pre style={{ ...mono, color: x.failed ? "var(--alert)" : "var(--text-3)" }}>{x.output ?? (running ? live[running] : "running…")}</pre>
            </div>
          ))}
        </div>
      )}
      {yours && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          style={{ display: "flex", gap: 6, minWidth: 0 }}
        >
          <input value={line} onChange={(e) => setLine(e.target.value)} aria-label="A command for his terminal" placeholder="A command for his terminal" size={1} autoComplete="off" spellCheck={false} style={{ flex: "1 1 120px", minWidth: 0, font: "500 13px/18px var(--mono)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 8, padding: "6px 10px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" }} />
          <button type="submit" style={{ font: "600 12px/16px var(--font)", border: 0, borderRadius: 8, padding: "6px 10px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 30 }}>
            Run
          </button>
        </form>
      )}
    </div>
  );
}

function Activity({ acts }: { acts: Act[] }) {
  if (!acts.length) return <Quiet>Nothing yet.</Quiet>;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
      {[...acts].reverse().map((a) => (
        <li key={a.id} data-act={a.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "baseline", padding: "4px 6px", borderRadius: 8 }}>
          <span style={{ font: "600 11px/16px var(--mono)", color: "var(--text-3)" }}>{hhmm(a.at)}</span>
          <span style={{ display: "grid", minWidth: 0 }}>
            <span style={{ font: "600 13px/18px var(--font)", color: a.failed ? "var(--alert)" : "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ACT_WORDS[a.tool] ?? a.tool} {a.on}
            </span>
            <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.result === null ? "waiting for your OK" : a.result.split("\n")[0]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => <span style={{ display: "block", font: "400 13px/18px var(--font)", color: "var(--text-3)", padding: "8px 2px" }}>{children}</span>;
