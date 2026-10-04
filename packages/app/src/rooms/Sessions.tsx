// Sessions (PLAN 2.9; owner, 2026-10-01: "basically like the video we sent, are seen as sessions,
// who have a brainstorming tab with a chat next to it ... same for the floor tab, and you choose
// which orbs to bring into each session and each tab ... we want to see what theire doing. make
// it nice modern and visuals and anims. professional but fun, like a switch game").
//
// A session's page is the GPT Dots clip's layout:
//   - the tab's orbs along the top, alive (thinking while they work, speaking as they write);
//   - a picker to bring others in;
//   - the stage: on the Brainstorm, what has been agreed so far; on the Floor, each orb's
//     computer showing what he did last;
//   - the chat beside it, everyone in it.
import { useEffect, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import { idOf, tabOf, type Message, type Office, type Session, type Tab } from "../home/link.ts";
import { Talk, type Busy } from "./Talk.tsx";
import { Computer } from "./Computer.tsx";
import { TeamBoard } from "./Board.tsx";
import { actsOf } from "./work.ts";

const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };
const strong: CSSProperties = { ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", fontWeight: 800 };
const TAB_WORDS: Record<Tab, { label: string; about: string; empty: string }> = {
  brainstorm: { label: "Brainstorm", about: "Ideas and the debate. A decision lands as ✓ Agreed.", empty: "Throw out an idea, a question, a goal: everyone here takes a turn on it." },
  floor: { label: "Floor", about: "The agreed work, done. Watch each one's computer.", empty: "Say what to build: everyone here does their part, and asks before anything that matters." },
};

export function SessionsRoom(o: { home: Office | null; office: Character[]; open: number | null; tab: Tab; go: (id: number | null, tab?: Tab) => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const reload = (): void => {
    if (o.home) o.home.sessions().then(setSessions, (e: Error) => setSaid(e.message));
  };
  useEffect(reload, [o.home]);
  if (!o.home) {
    return (
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: "var(--s3)", padding: "var(--s7) var(--s5)", textAlign: "center" }}>
        <span style={{ font: "700 20px/26px var(--font)", color: "var(--text-1)" }}>Sessions need your home</span>
        <span style={{ font: "400 15px/21px var(--font)", color: "var(--text-3)", maxWidth: 440 }}>A session is your orbs working together, so they need to be awake on your home. Start it (pnpm start) and open the link it prints.</span>
      </div>
    );
  }
  if (o.open !== null && sessions === null && !said) return null; // a link straight to a session: his page, once the sessions are in
  const current = o.open !== null ? sessions?.find((s) => s.id === o.open) : undefined;
  if (current) return <SessionView home={o.home} office={o.office} session={current} tab={o.tab} go={o.go} changed={(s) => setSessions((all) => all?.map((x) => (x.id === s.id ? s : x)) ?? [s])} />;
  return <SessionList home={o.home} office={o.office} sessions={sessions} said={said ?? (o.open !== null ? `There is no session ${o.open}.` : null)} made={(s) => { setSessions((all) => [s, ...(all ?? [])]); o.go(s.id, "brainstorm"); }} open={(s) => o.go(s.id, "brainstorm")} />;
}

function SessionList(o: { home: Office; office: Character[]; sessions: Session[] | null; said: string | null; made: (s: Session) => void; open: (s: Session) => void }) {
  const [title, setTitle] = useState("");
  const [crew, setCrew] = useState<string[]>(() => o.office.slice(0, 1).map((c) => idOf(c.name)));
  const [why, setWhy] = useState<string | null>(null);
  const start = (): void => {
    const t = title.trim();
    if (!t) return setWhy("A session needs a title: what is it for?");
    if (!crew.length) return setWhy("Bring at least one orb in.");
    o.home.newSession(t, { brainstorm: crew, floor: crew }).then(o.made, (e: Error) => setWhy(e.message));
  };
  return (
    <div style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <h2 style={{ margin: 0, font: "800 28px/34px var(--font)", color: "var(--text-1)" }}>Sessions</h2>
      <section aria-label="A new session" style={{ display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
        <span style={{ font: "700 15px/20px var(--font)", color: "var(--text-1)" }}>A new session: a piece of work, brainstormed, then done</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="What the session is for" placeholder="A landing page, the month's budget, a trip to Lisbon…" size={1} style={{ font: "600 16px/22px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "10px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }} />
        <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>Who's in</span>
        <Picker office={o.office} chosen={crew} set={setCrew} />
        {why && <span style={{ font: "500 13px/18px var(--font)", color: "var(--alert)" }}>{why}</span>}
        <button data-sound="create" onClick={start} style={{ ...strong, justifySelf: "start" }}>
          Start the session
        </button>
      </section>
      {o.said && <span role="alert" style={{ color: "var(--alert)" }}>{o.said}</span>}
      {o.sessions && o.sessions.length > 0 && (
        <Balanced min={240} gap={12}>
          {o.sessions.map((s) => {
            const who = [...new Set([...s.brainstorm, ...s.floor])].map((id) => o.office.find((c) => idOf(c.name) === id)).filter((c): c is Character => Boolean(c));
            return (
              <button key={s.id} onClick={() => o.open(s)} style={{ ...button, display: "grid", gap: 6, padding: "var(--s4)", borderRadius: 18, textAlign: "left", minWidth: 0 }}>
                <span style={{ font: "800 16px/22px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                <span style={{ display: "flex", gap: 2 }}>
                  {who.slice(0, 6).map((c) => (
                    <Orb key={c.name} character={c} size={34} poke={false} every={3} fidget={false} still />
                  ))}
                </span>
              </button>
            );
          })}
        </Balanced>
      )}
    </div>
  );
}

/** Who works a tab: the office's orbs, chosen by a press, in the order chosen (their turn order). */
function Picker({ office, chosen, set }: { office: Character[]; chosen: string[]; set: (ids: string[]) => void }) {
  return (
    <OneLine style={{ justifyContent: "flex-start" }} gap={8}>
      {office.map((c) => {
        const id = idOf(c.name);
        const on = chosen.includes(id);
        return (
          <button key={id} data-orb={c.hue} aria-pressed={on} onClick={() => set(on ? chosen.filter((x) => x !== id) : [...chosen, id])} style={{ ...button, display: "grid", justifyItems: "center", gap: 2, padding: "6px 10px", borderRadius: 14, background: on ? "var(--accent-fill)" : "var(--fill)", boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--hairline)" }}>
            <Orb character={c} size={44} poke={false} still />
            <span style={{ font: "700 12px/16px var(--font)", color: on ? "var(--text-1)" : "var(--text-3)" }}>{c.name}</span>
          </button>
        );
      })}
    </OneLine>
  );
}

function SessionView(o: { home: Office; office: Character[]; session: Session; tab: Tab; go: (id: number | null, tab?: Tab) => void; changed: (s: Session) => void }) {
  const [busy, setBusy] = useState<Busy>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [bringing, setBringing] = useState(false);
  const ids = o.session[o.tab];
  const crew = ids.map((id) => o.office.find((c) => idOf(c.name) === id)).filter((c): c is Character => Boolean(c));
  const agreed = messages.filter((m) => m.role === "notice" && typeof m.meta.agreed === "string");
  // on the Floor, one computer is big: the one you chose, or whoever last did something
  const [focus, setFocus] = useState<string | null>(null);
  const lastActor = [...messages].reverse().find((m) => m.role === "assistant" && m.toolCalls?.length && crew.some((c) => idOf(c.name) === m.orb))?.orb;
  const shown = crew.find((c) => idOf(c.name) === focus) ?? crew.find((c) => idOf(c.name) === lastActor) ?? crew[0];
  const talk = (
    <Talk
      home={o.home}
      conversation={tabOf(o.session.id, o.tab)}
      orbs={crew}
      send={(text) => o.home.sayIn(o.session.id, o.tab, text)}
      placeholder={`Say something to the ${TAB_WORDS[o.tab].label}`}
      empty={crew.length ? TAB_WORDS[o.tab].empty : "No one is in this tab yet: bring someone in."}
      onBusy={setBusy}
      onMessages={setMessages}
    />
  );
  return (
    <div data-session={o.session.id} data-tab={o.tab} style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: "min(100%, calc(100dvh - 120px))", minWidth: 0 }}>
      <header style={{ display: "grid", gap: "var(--s3)", padding: "var(--s4) var(--s5) var(--s3)", boxShadow: "0 1px 0 var(--sep)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
          <h2 style={{ margin: 0, font: "800 22px/28px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.session.title}</h2>
          <div role="tablist" style={{ display: "flex", gap: 3, padding: 3, borderRadius: 12, background: "var(--fill)", flex: "0 0 auto" }}>
            {(["brainstorm", "floor"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={o.tab === t} onClick={() => o.go(o.session.id, t)} style={{ ...button, padding: "6px 14px", borderRadius: 9, boxShadow: o.tab === t ? "0 1px 3px var(--shadow)" : "none", background: o.tab === t ? "var(--fill-2)" : "transparent", color: o.tab === t ? "var(--text-1)" : "var(--text-3)" }}>
                {TAB_WORDS[t].label}
              </button>
            ))}
          </div>
        </div>
        <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>{TAB_WORDS[o.tab].about}</span>
        <OneLine style={{ justifyContent: "flex-start" }} gap={10}>
          {crew.map((c) => (
            <div key={c.name} data-orb={c.hue} data-member={idOf(c.name)} style={{ display: "grid", justifyItems: "center", gap: 0 }}>
              <Orb character={c} size={64} state={busy[idOf(c.name)] ?? "idle"} poke={false} />
              <span style={{ font: "700 12px/16px var(--font)", color: "var(--accent)" }}>{c.name}</span>
              <span style={{ font: "400 11px/14px var(--font)", color: "var(--text-3)" }}>{busy[idOf(c.name)] === "speaking" ? "writing" : busy[idOf(c.name)] ? "working" : "ready"}</span>
            </div>
          ))}
          <button onClick={() => setBringing((b) => !b)} aria-expanded={bringing} style={{ ...button, alignSelf: "center" }}>
            {bringing ? "Done" : "Bring someone in"}
          </button>
        </OneLine>
        {bringing && <Picker office={o.office} chosen={ids} set={(next) => o.home.bring(o.session.id, o.tab, next).then(o.changed, () => {})} />}
      </header>
      {o.tab === "brainstorm" ? (
        <div style={{ display: "grid", gridTemplateRows: agreed.length ? "auto 1fr" : "1fr", minWidth: 0 }}>
          {agreed.length > 0 && (
            <section aria-label="Agreed so far" style={{ display: "grid", gap: 6, padding: "var(--s4) var(--s5) 0" }}>
              <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>Agreed so far</span>
              {agreed.map((m) => (
                <span key={m.id} style={{ font: "600 14px/20px var(--font)", color: "var(--text-1)" }}>✓ {String(m.meta.agreed)}</span>
              ))}
            </section>
          )}
          {talk}
        </div>
      ) : (
        // the Floor (PLAN 2.9): the work shown big, each orb's computer a press away, the chat beside it
        <div className="orbs-beside" style={{ display: "grid", gap: "var(--s4)", paddingTop: "var(--s4)", minWidth: 0 }}>
          <div style={{ display: "grid", gap: 10, alignContent: "start", minWidth: 0, padding: "0 var(--s5)" }}>
            {crew.length > 1 && (
              <OneLine style={{ justifyContent: "flex-start" }} gap={8}>
                {crew.map((c) => {
                  const last = actsOf(messages, idOf(c.name)).at(-1);
                  const on = c === shown;
                  return (
                    <button key={c.name} data-orb={c.hue} data-show={idOf(c.name)} aria-pressed={on} onClick={() => setFocus(idOf(c.name))} style={{ ...button, display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 12, background: on ? "var(--accent-fill)" : "var(--fill)", boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)", maxWidth: 260 }}>
                      <Orb character={c} size={26} poke={false} still />
                      <span style={{ display: "grid", minWidth: 0, textAlign: "left" }}>
                        <span style={{ font: "700 12px/16px var(--font)", color: "var(--text-1)" }}>{c.name}'s computer</span>
                        <span style={{ font: "400 11px/14px var(--font)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last ? `${last.tool.replace(/_/g, " ")} ${last.on}` : "waiting for work"}</span>
                      </span>
                    </button>
                  );
                })}
              </OneLine>
            )}
            {/* the team's board (PLAN 5.1): who holds which row, the reviews waiting, the changes proposed */}
            <TeamBoard home={o.home} session={o.session.id} office={o.office} />
            {/* the shared computer: the session's own workspace, each orb's face on what he last touched */}
            {shown && <Computer key={idOf(shown.name)} home={o.home} orb={shown} messages={messages} busy={busy[idOf(shown.name)]} big session={o.session.id} />}
          </div>
          {talk}
        </div>
      )}
    </div>
  );
}
