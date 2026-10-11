// The home page, what the app opens on (owner, 10-07: "a nice home page the app can default to with the same logo
// and splash on it with a nice dashboard and stats and i dont know, make it nice and inviting like the rest of the
// site. placed well, organized"). At its top the splash, awake: the office's orbs in a row, the Orbz mark and its
// wordmark on the same glow, a greeting, the day, how the office is, and the four things you most often do next.
// Under it four numbers (who is working, what waits for you, the week's XP, the brain spent today), then what is
// coming up beside the top of the office, the latest work beside the sessions, and the office's life. Every number
// is the home's, read by code (home/src/dashboard.ts); who is working and who waits are the orbs' live moods, the
// same the side menu's dots wear. It is the office's: an empty office opens on making its first orb (orbs.tsx).
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import type { Mood } from "../orb/mood.ts";
import { idOf, type CalendarEntry, type DashboardState, type Office } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";
import { Balanced, Tall } from "../ui/Balanced.tsx";
import { useCramped } from "../ui/fill.ts";
import { STAGGER_MS } from "../ui/splash.ts";
import { markSvg } from "../brand/mark.ts";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const body: CSSProperties = { font: "500 14px/20px var(--font)", color: "var(--text-1)", textWrap: "pretty", overflowWrap: "anywhere" };
const card: CSSProperties = { display: "grid", gap: 12, alignContent: "start", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 };
const button: CSSProperties = { font: "700 14px/20px var(--font)", border: 0, borderRadius: 12, padding: "10px 14px", background: "var(--fill-2)", color: "var(--text-1)", cursor: "pointer", minHeight: 40, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const link: CSSProperties = { font: "600 13px/18px var(--font)", border: 0, borderRadius: 999, padding: "4px 10px", background: "transparent", color: "var(--text-2)", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", whiteSpace: "nowrap" };
const MARK = `data:image/svg+xml;utf8,${encodeURIComponent(markSvg({ scale: 0.86 }))}`;

const greeting = (h: number): string => (h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** A count the way a tile says it: 950, 12.3k, 1.2M. */
export function short(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
/** How long ago, in words: "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function ago(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
const dayKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** When a calendar entry is: "Today 15:00", "Tomorrow", "Fri 9 Oct 08:00". */
function whenOf(c: CalendarEntry, now: number): string {
  const day = c.day === dayKey(now) ? "Today" : c.day === dayKey(now + 86_400_000) ? "Tomorrow" : new Date(`${c.day}T12:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return c.time ? `${day} ${c.time}` : day;
}
const KIND: Record<CalendarEntry["kind"], string> = { bill: "Bill", reminder: "Reminder", schedule: "Scheduled", event: "Event" };
const PLACE: Record<string, string> = { coffee: "over a coffee", cooler: "at the water cooler", bistro1: "at the bistro table", bistro2: "at the bistro table", pingpong: "at the ping-pong table", arcade: "at the arcade", desk: "at a desk" };

function Section({ title, label, more, children }: { title: string; label?: string; more?: { words: string; go: () => void }; children: ReactNode }) {
  return (
    <section aria-label={label ?? title} style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <span style={head}>{title}</span>
        {more && <button type="button" onClick={more.go} style={link}>{`${more.words} ›`}</button>}
      </div>
      {children}
    </section>
  );
}

/** One of the four numbers: what it counts, the number, a line under it; pressed, where it is from. */
function Tile({ id, label, value, sub, alert = false, go }: { id: string; label: string; value: string; sub: string; alert?: boolean; go?: () => void }) {
  const inner = (
    <>
      <span style={head}>{label}</span>
      <span className="num" style={{ font: "800 30px/36px var(--font)", color: alert ? "var(--alert)" : "var(--text-1)" }}>{value}</span>
      <span style={{ ...small, color: "var(--text-2)", textWrap: "balance" }}>{sub}</span>
    </>
  );
  const style: CSSProperties = { ...card, gap: 2, textAlign: "left", border: 0, cursor: go ? "pointer" : "default", boxShadow: alert ? "inset 0 0 0 1.5px var(--alert)" : card.boxShadow, color: "inherit", font: "inherit" };
  return go ? <button type="button" data-tile={id} onClick={go} style={style}>{inner}</button> : <div data-tile={id} style={style}>{inner}</div>;
}

export function HomeRoom({ home, office, person, moods, go }: { home: Office | null; office: Character[]; person: string | null; moods: Record<string, Mood>; go: (r: Route) => void }) {
  const phone = useCramped("(max-width: 760px)");
  const tiny = useCramped("(max-width: 360px)"); // a small phone: three orbs across, not five
  const wide = useCramped("(min-width: 1100px)"); // two columns, side by side
  const [d, setD] = useState<DashboardState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000); // the greeting's clock
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!home) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (): void => void home.dashboard().then((x) => (setD(x), setSaid(null)), (e: Error) => setSaid(e.message));
    load();
    // what moves its numbers, at most one look every two seconds (a working orb's brain spends many times a minute)
    const stop = home.watch({ event: (e) => {
      if (!/^(run\.finished|card\.|xp\.|brain\.spend|social\.met|notice\.|position\.|applicant\.|reminder\.|schedule\.|session\.|team\.|orb\.)/.test(e.type) || timer) return;
      timer = setTimeout(() => ((timer = null), load()), 2000);
    } });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [home]);

  const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const name = d?.name ?? person;
  const ids = office.map((c) => idOf(c.name));
  // who is working and who waits: the live moods (the side menu's dots)
  const working = ids.filter((id) => moods[id] === "working" || moods[id] === "thinking" || moods[id] === "gym").length;
  const waiting = ids.filter((id) => moods[id] === "waiting").length;
  const free = office.length - working - waiting;
  const assistant = office.find((c) => c.specialty === "assistant") ?? office[0] ?? null;
  const byId = new Map(office.map((c) => [idOf(c.name), c]));
  const byName = new Map(office.map((c) => [c.name, c]));
  // the row, your CEO in its middle and the biggest (owner, 10-07: "on home page, middle orb should always be your CEO")
  const across = tiny ? 3 : phone ? 5 : 7;
  const ceo = office.find((c) => c.specialty === "ceo");
  const others = office.filter((c) => c !== ceo).slice(0, ceo ? across - 1 : across);
  const half = Math.floor(others.length / 2);
  const shown = ceo ? [...others.slice(0, half), ceo, ...others.slice(half)] : others;
  const big = phone ? 84 : 140;
  const little = phone ? 56 : 92;
  const mid = ceo ? half : Math.floor(shown.length / 2);
  const date = new Date(now);

  // the sections under the numbers, once the home has answered: on a wide screen two columns, each stacking its own
  // (coming up, the sessions and the office's life; the top of the office and the latest work), so no card stands
  // half empty beside a longer one; on a phone one column, in that order of use
  const column: CSSProperties = { display: "grid", gap: "var(--s4)", alignContent: "start", minWidth: 0 };
  const coming = d && (
    <Section title="Coming up" more={{ words: "Calendar", go: () => go({ room: "calendar" }) }}>
      {d.coming.length ? (
        <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
          {d.coming.map((c) => (
            <li key={`${c.kind}${c.id}${c.day}${c.time ?? ""}`} data-coming={c.kind} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 10, alignItems: "baseline" }}>
              <span style={{ ...head, fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "var(--fill-2)", color: "var(--text-2)" }}>{KIND[c.kind]}</span>
              <span style={{ display: "grid", minWidth: 0 }}>
                <span style={body}>{`${c.title}${c.kind === "bill" && c.amount ? ` · ${c.amount}` : ""}`}</span>
                <span style={small}>{whenOf(c, d.now)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : <span style={small}>Nothing in the next two days: bills, reminders and scheduled work show here.</span>}
    </Section>
  );
  const top = d && (
    <Section title="Top of the office" more={{ words: "Org chart", go: () => go({ room: "org" }) }}>
      <ol aria-label="The top of the office by XP" style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
        {d.xp.top.map((r, i) => {
          const c = byId.get(r.orb);
          const most = Math.max(1, d.xp.top[0]!.xp);
          return (
            <li key={r.orb} data-top={r.orb} data-orb={c?.hue} style={{ display: "grid", gridTemplateColumns: "2ch auto minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
              <b className="num" style={{ ...small, fontWeight: 800, color: "var(--text-2)" }}>{i + 1}</b>
              {c ? <Orb character={c} size={28} poke={false} every={3} fidget={false} /> : <span style={{ width: 28 }} />}
              <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <span style={{ ...small, fontWeight: 700, color: i === 0 ? "var(--accent)" : "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                <span style={{ display: "block", height: 5, borderRadius: 3, background: "var(--fill-2)", overflow: "hidden" }}>
                  <i style={{ display: "block", height: "100%", width: `${(r.xp / most) * 100}%`, background: "var(--accent)", opacity: 0.85 }} />
                </span>
              </span>
              <span className="num" style={{ ...small, whiteSpace: "nowrap" }}>{`${r.xp.toLocaleString("en-GB")} XP`}</span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
  const lately = d && (
    <Section title="Lately" label="The office's latest work">
      {d.lately.length ? (
        <Tall max="36dvh" label="The office's latest work, every piece">
          <ul style={{ display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
            {d.lately.map((w) => (
              <li key={`${w.orb}${w.at}`} data-lately={w.orb} style={{ display: "grid", gap: 2 }}>
                <span style={small}>
                  {/* the name underlined in its colour (owner, 10-11: "underline their names so we can see better") */}
                  <b data-orb={byId.get(w.orb)?.hue} style={{ color: "var(--accent)", fontWeight: 800, textDecoration: "underline", textDecorationThickness: 1.5, textUnderlineOffset: 3 }}>{w.name}</b>
                  {` · ${ago(w.at, d.now)}${w.conversation?.startsWith("team:") ? " · in a session" : ""}`}
                </span>
                <span style={body}>{w.summary}</span>
              </li>
            ))}
          </ul>
        </Tall>
      ) : <span style={small}>Nothing finished yet: what the orbs finish shows here, newest first.</span>}
    </Section>
  );
  const sessions = d && (
    <Section title="Sessions" more={{ words: "All sessions", go: () => go({ room: "sessions", id: null, tab: "brainstorm" }) }}>
      {d.sessions.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          {d.sessions.map((s) => (
            <button key={s.id} type="button" data-session={s.id} onClick={() => go({ room: "sessions", id: s.id, tab: "brainstorm" })}
              style={{ display: "grid", gap: 2, textAlign: "left", padding: "10px 12px", border: 0, borderRadius: 12, background: "var(--fill-2)", cursor: "pointer", color: "inherit", minWidth: 0 }}>
              <span style={{ ...body, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
              <span style={small}>{`${plural(s.orbs, "orb")} · ${ago(s.at, d.now)}`}</span>
            </button>
          ))}
        </div>
      ) : <span style={small}>No sessions yet: start one to put orbs to work on something together.</span>}
    </Section>
  );
  // the board's report (PLAN 5.18): the morning's ideas wait here for your verdict
  const board = d && (
    <Section title="From the board" label="From the board" more={{ words: d.report ? "Read the report" : "The report", go: () => go({ room: "report" }) }}>
      {d.report ? (
        <div data-home-report style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <span style={body}>{`${new Date(d.report.at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${d.report.chair ? `, from ${d.report.chair}` : ""}: ${plural(d.report.ideas, "idea")} to make money${d.report.open ? `, ${d.report.open} waiting for your verdict` : ""}`}</span>
          {d.report.first && <span style={{ ...small, color: "var(--text-2)", textWrap: "pretty" }}>{`${d.report.first.name}: “${d.report.first.text}”`}</span>}
        </div>
      ) : <span style={small}>The board sends its first report at 08:00: ideas to make money from your orbs, the office, the world, who to hire.</span>}
    </Section>
  );
  const life = d && (
    <Section title="Life in the office" label="Life in the office" more={d.hiring.positions ? { words: `Hiring: ${plural(d.hiring.applicants, "applicant")}`, go: () => go({ room: "recruiter" }) } : undefined}>
      {d.meetings.length ? (
        <ul style={{ display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
          {d.meetings.map((m) => (
            <li key={m.at} data-meeting={m.kind} style={{ display: "grid", gap: 2, paddingLeft: 12, boxShadow: "inset 2px 0 0 var(--accent)" }} data-orb={byName.get(m.a)?.hue}>
              <span style={body}>{`${m.a} and ${m.b} ${m.kind === "ideas" ? "traded ideas" : m.kind === "game" ? "played a game" : m.kind === "lesson" ? "had a lesson" : "talked"} ${PLACE[m.place] ?? ""}`.trim()}</span>
              {m.idea && <span style={small}>{`${m.a} brought: ${m.idea}`}</span>}
              <span style={small}>{ago(m.at, d.now)}</span>
            </li>
          ))}
        </ul>
      ) : <span style={small}>{"No one has met yet: free orbs meet through the office's day, 07:00 to 22:30."}</span>}
    </Section>
  );

  return (
    <div data-home-page style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      {/* the splash, awake: the office's orbs, the mark and the wordmark on the same glow */}
      <header data-home-hero data-orb="azure" style={{ ...card, justifyItems: "center", textAlign: "center", gap: "var(--s3)", padding: phone ? "var(--s5) var(--s4)" : "var(--s6) var(--s5)", background: "radial-gradient(70% 90% at 50% 0%, var(--accent-wash), transparent 70%), var(--fill)" }}>
        {shown.length > 0 && (
          // an orb's frame keeps room above it for a hop: the row reaches up into the header's padding
          <div style={{ display: "flex", flexWrap: "nowrap", justifyContent: "center", alignItems: "end", gap: phone ? 2 : 6, maxWidth: "100%", marginTop: phone ? -12 : -28 }}>
            {shown.map((c, i) => (
              <button key={c.name} type="button" data-orb={c.hue} aria-label={`${c.name}'s profile`} onClick={() => go({ room: "office", orb: c.name })}
                style={{ padding: 0, border: 0, background: "transparent", cursor: "pointer", minWidth: 0, animation: calm ? undefined : `orbs-arrive 520ms var(--m-spring) ${i * STAGGER_MS}ms both` }}>
                <Orb character={c} size={i === mid ? big : little} poke={false} state={moods[idOf(c.name)] === "thinking" || moods[idOf(c.name)] === "working" ? "thinking" : "idle"} />
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={MARK} alt="" aria-hidden="true" width={phone ? 34 : 40} height={phone ? 34 : 40} style={{ display: "block" }} />
          <span style={{ font: `800 ${phone ? 26 : 30}px/1 var(--font)`, letterSpacing: ".18em", color: "var(--text-1)" }}>ORBZ</span>
        </div>
        {office.length ? (
          <>
            <div style={{ display: "grid", gap: 4, justifyItems: "center" }}>
              <h1 style={{ margin: 0, font: `800 ${phone ? 24 : 28}px/1.2 var(--font)`, color: "var(--text-1)" }}>{`${greeting(date.getHours())}${name ? `, ${name}` : ""}`}</h1>
              <span style={{ ...small, color: "var(--text-2)" }}>{`${d?.company ? `${d.company} · ` : ""}${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`}</span>
              <span data-home-status style={{ ...body, color: "var(--text-2)" }}>
                {[plural(office.length, "orb"), `${working} working`, waiting ? `${waiting} ${waiting === 1 ? "needs" : "need"} you` : "nothing waiting for you"].join(" · ")}
              </span>
            </div>
            {/* what you most often do next */}
            <div style={{ width: "min(100%, 680px)" }}>
              <Balanced min={150} gap={8}>
                {assistant && (
                  <button type="button" data-sound="pick" data-orb={assistant.hue} onClick={() => go({ room: "chat", orb: assistant.name })} style={{ ...button, background: "var(--accent)", color: "var(--ground)" }}>
                    {`Chat with ${assistant.name}`}
                  </button>
                )}
                <button type="button" onClick={() => go({ room: "office", orb: null })} style={button}>The office</button>
                <button type="button" onClick={() => go({ room: "sessions", id: null, tab: "brainstorm" })} style={button}>Start a session</button>
                <button type="button" onClick={() => go({ room: "new" })} style={button}>New orb</button>
              </Balanced>
            </div>
          </>
        ) : null}
      </header>

      {office.length > 0 && (
        <>
          {/* the four numbers */}
          <Balanced min={phone ? 140 : 170} gap={10}>
            <Tile id="working" label="Working now" value={`${working}`} sub={`of ${plural(office.length, "orb")} · ${free} free`} go={() => go({ room: "office", orb: null })} />
            <Tile id="waiting" label="Need you" value={`${waiting}`} sub={d ? plural(d.notices, "notification") : "cards to answer"} alert={waiting > 0} go={() => go({ room: "notices" })} />
            <Tile id="xp" label="XP this week" value={d ? `${d.xp.week < 0 ? "−" : "+"}${short(Math.abs(d.xp.week))}` : "·"} sub={d ? `${d.xp.today >= 0 ? "+" : ""}${d.xp.today} today` : "from work you approve"} go={() => go({ room: "stats", tab: "xp" })} />
            <Tile id="brain" label="Brain today" value={d ? short(d.brain.today.tokens) : "·"} sub={d ? `tokens · ${plural(d.brain.today.requests, "request")}, ${short(d.brain.week.tokens)} this week` : "tokens spent"} go={() => go({ room: "stats", tab: "brain" })} />
          </Balanced>

          {!home ? (
            <p style={{ ...small, margin: 0, textAlign: "center" }}>Open the app from your home to see its week here: what is coming up, the top of the office, the latest work.</p>
          ) : !d ? (
            <p style={{ ...small, margin: 0, textAlign: "center" }}>{said ?? "Loading the office…"}</p>
          ) : (
            <>
              {wide ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "var(--s4)", alignItems: "start", minWidth: 0 }}>
                  <div style={column}>{board}{coming}{sessions}{life}</div>
                  <div style={column}>{top}{lately}</div>
                </div>
              ) : (
                <>{board}{coming}{top}{lately}{sessions}{life}</>
              )}
            </>
          )}
        </>
      )}
      {said && d && <span role="status" style={small}>{said}</span>}
    </div>
  );
}
