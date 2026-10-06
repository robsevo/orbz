// The notification centre (PLAN 2.11; owner, 10-01: "notification centre for things like that",
// bills due, the accountant). What needs you or happened, from every orb, grouped by orb: a bill
// coming due, a reminder, an approval waiting, work finished. Each opens where it came from; putting
// one away puts it away on every device (the home keeps them). Quiet: a count on the side menu.
import { useEffect, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import { idOf, type YourDay, type MorningCard, type Notice, type Office, type Undo } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";

const MARK: Record<Notice["kind"], string> = { bill: "¤", reminder: "◷", approval: "!", done: "✓", promotion: "↑", performance: "◔", reading: "≡" };
const KIND_WORDS: Record<Notice["kind"], string> = { bill: "Bill", reminder: "Reminder", approval: "Waiting for your OK", done: "Finished", promotion: "Ready for promotion", performance: "Weekly card", reading: "Reading" };
const button: CSSProperties = { font: "600 13px/18px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "6px 12px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 32 };

/** What is out, kept up to date as it comes and goes (on this device or another). */
export function useNotices(home: Office | null): { notices: Notice[]; reload: () => void; live: boolean } {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [live, setLive] = useState(false); // the stream is open: from here on, another device's change shows as it happens
  const reload = (): void => {
    if (home) home.notices().then(setNotices, () => {});
  };
  useEffect(() => {
    if (!home) return;
    reload();
    return home.watch({
      open: () => {
        setLive(true);
        reload();
      },
      event: (e) => {
        if (e.type === "notice.added" || e.type === "notice.put_away") reload();
      },
    });
  }, [home]);
  return { notices, reload, live };
}

/** The morning card (PLAN 3.5), kept up to date as the night and your taps change it. */
export function useMorning(home: Office | null): { card: MorningCard | null; setCard: (c: MorningCard | null) => void } {
  const [card, setCard] = useState<MorningCard | null>(null);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.morning().then(setCard, () => {});
    load();
    return home.watch({ open: load, event: (e) => void (MORNING_EVENTS.has(e.type) && load()) });
  }, [home]);
  return { card, setCard };
}
const MORNING_EVENTS = new Set(["gym.night_done", "habit.promoted", "habit.undone", "orb.learned", "orb.unlearned"]);

/** Your day (PLAN 4.5), read again when a calendar, a bill or a reminder changes. */
export function useYourDay(home: Office | null): YourDay | null {
  const [day, setDay] = useState<YourDay | null>(null);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.day().then(setDay, () => {});
    load();
    return home.watch({ open: load, event: (e) => void (/^(calendar\.|notice\.|reminder\.)/.test(e.type) && load()) });
  }, [home]);
  return day;
}

/** A habit's task, in words: what starts it and what it does ("A trigger (t1): read file, then remind"). */
export function habitWords(key: string): string {
  const [, trigger = "", shape = ""] = key.split("|");
  const [kind, id] = trigger.split(":");
  const tools = shape.split(" ")[0]!.split(">").map((t) => t.replace(/_/g, " "));
  return `${kind === "schedule" ? "A schedule" : kind === "trigger" ? "A trigger" : "A task"}${id ? ` (${id})` : ""}: ${tools.join(", then ")}`;
}

/** Where a notice came from, as an address: a private chat, or a session's tab. */
export function whereOf(n: Notice, office: Character[]): Route | null {
  const c = n.conversation;
  if (!c) return null;
  const chat = /^chat:(.+)$/.exec(c);
  if (chat) {
    const orb = office.find((o) => idOf(o.name) === chat[1]);
    return orb ? { room: "chat", orb: orb.name } : null;
  }
  const team = /^team:(\d+):(brainstorm|floor)$/.exec(c);
  if (team) return { room: "sessions", id: Number(team[1]), tab: team[2] as "brainstorm" | "floor" };
  return null;
}

const ago = (t: number, now: number): string => {
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};
const dueWords = (due: string): string => {
  const [y, mo, d] = due.slice(0, 10).split("-").map(Number);
  const day = new Date(y!, mo! - 1, d!).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `Due ${day}${due.length > 10 ? `, ${due.slice(11)}` : ""}`;
};

export function NoticesRoom(o: { home: Office | null; office: Character[]; notices: Notice[]; reload: () => void; live: boolean; go: (r: Route) => void }) {
  const [said, setSaid] = useState<string | null>(null);
  const morning = useMorning(o.home);
  const today = useYourDay(o.home);
  if (!o.home) {
    return (
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: "var(--s3)", padding: "var(--s7) var(--s5)", textAlign: "center" }}>
        <span style={{ font: "700 20px/26px var(--font)", color: "var(--text-1)" }}>Notifications live on your home</span>
        <span style={{ font: "400 15px/21px var(--font)", color: "var(--text-3)", maxWidth: 440 }}>Bills coming due, reminders, approvals waiting and finished work are kept there, for every device. Start it (pnpm start) and open the link it prints.</span>
      </div>
    );
  }
  const home = o.home;
  const now = Date.now();
  const byOrb = new Map<string, Notice[]>();
  for (const n of o.notices) byOrb.set(n.orb, [...(byOrb.get(n.orb) ?? []), n]);
  const away = (id?: number): void => {
    (id === undefined ? home.putAwayAll() : home.putAway(id)).then(o.reload, (e: Error) => setSaid(e.message));
  };
  const takeBack = (u: Undo): void => {
    home.undo(u).then(morning.setCard, (e: Error) => setSaid(e.message));
  };
  // a promotion is yours to give (PLAN 3.8): to the level the evidence names, or not yet
  const promotion = (n: Notice, yes: boolean): void => {
    const c = o.office.find((x) => idOf(x.name) === n.orb);
    if (!c) return;
    home
      .standing(c)
      .then((st) => (st.next ? (yes ? home.promote(c, st.next.to) : home.notYet(c, st.next.to)) : undefined))
      .then(o.reload, (e: Error) => setSaid(e.message));
  };
  return (
    <div data-stream={o.live ? "open" : "connecting"} style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ margin: 0, font: "800 28px/34px var(--font)", color: "var(--text-1)" }}>Notifications</h2>
        {o.notices.length > 1 && (
          <button onClick={() => away()} style={button}>
            Put all away
          </button>
        )}
      </div>
      {said && <span role="alert" style={{ color: "var(--alert)" }}>{said}</span>}
      {today && "brief" in today && <YourDayCard day={today} go={o.go} />}
      {morning.card && <Morning card={morning.card} office={o.office} takeBack={takeBack} />}
      {!o.notices.length && (
        <div style={{ display: "grid", justifyItems: "center", gap: 8, padding: "var(--s6) 0", textAlign: "center" }}>
          <span style={{ font: "700 17px/22px var(--font)", color: "var(--text-1)" }}>Nothing needs you</span>
          <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-3)" }}>Bills coming due, reminders, approvals and finished work show here.</span>
        </div>
      )}
      {[...byOrb.entries()].map(([orb, list]) => {
        const c = o.office.find((x) => idOf(x.name) === orb);
        return (
          <section key={orb} data-orb={c?.hue} data-notices={orb} aria-label={`From ${c?.name ?? orb}`} style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {c && <Orb character={c} size={30} poke={false} still />}
              <span style={{ font: "800 15px/20px var(--font)", color: "var(--accent)" }}>{c?.name ?? orb}</span>
              <span style={{ font: "600 12px/16px var(--font)", color: "var(--text-3)" }}>{list.length}</span>
            </div>
            {list.map((n) => {
              const where = whereOf(n, o.office);
              return (
                <article key={n.id} data-notice={n.kind} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: "6px 10px", alignItems: "start", padding: "10px 12px", borderRadius: 14, background: "var(--card)", boxShadow: n.kind === "approval" || n.kind === "bill" ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--hairline)", minWidth: 0 }}>
                  <span aria-hidden style={{ width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--accent-fill)", color: "var(--accent)", font: "800 14px/16px var(--font)" }}>{MARK[n.kind]}</span>
                  <span style={{ display: "grid", minWidth: 0 }}>
                    <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", overflowWrap: "break-word", textWrap: "balance" }}>{n.title}</span>
                    <span style={{ font: "400 12px/17px var(--font)", color: "var(--text-3)", overflowWrap: "break-word", textWrap: "pretty" }}>
                      {[KIND_WORDS[n.kind], n.detail, n.due && dueWords(n.due), ago(n.at, now)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {/* put away stays in the corner; what else he can do goes UNDER the words, so on a phone
                      the words keep the card's width (owner, 10-02: three buttons beside them left 60 px) */}
                  <button onClick={() => away(n.id)} aria-label={`Put away: ${n.title}`} style={{ ...button, padding: "6px 10px" }}>
                    ✕
                  </button>
                  {(n.kind === "promotion" || (n.kind === "performance" && c) || n.kind === "reading" || where) && (
                    <span style={{ gridColumn: "1 / -1", paddingLeft: 38, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {n.kind === "promotion" && (
                        <>
                          <button data-sound="pick" onClick={() => promotion(n, true)} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
                            Promote
                          </button>
                          <button onClick={() => promotion(n, false)} style={button}>
                            Not yet
                          </button>
                        </>
                      )}
                      {/* the reading library's night (PLAN 3.12): what changed is in the Lab */}
                      {n.kind === "reading" && (
                        <button onClick={() => o.go({ room: "lab" })} style={button}>
                          The reading library
                        </button>
                      )}
                      {/* his week (PLAN 5.5): the evidence is on his career page */}
                      {n.kind === "performance" && c && (
                        <button onClick={() => o.go({ room: "career", orb: c.name })} style={button}>
                          {c.name}'s career
                        </button>
                      )}
                      {where && (
                        <button onClick={() => o.go(where)} style={button}>
                          Open
                        </button>
                      )}
                    </span>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/** Your day (PLAN 4.5): the brief in Ash's words, and what clashes, named, never moved for you. */
function YourDayCard(o: { day: Extract<YourDay, { brief: string }>; go: (r: Route) => void }) {
  return (
    <section aria-label="Your day" data-day style={{ display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }}>
      <span style={{ font: "800 17px/22px var(--font)", color: "var(--text-1)" }}>Your day</span>
      <span style={{ font: "400 15px/22px var(--font)", color: "var(--text-1)", textWrap: "pretty", overflowWrap: "anywhere" }}>{o.day.brief}</span>
      {o.day.clashes.length > 0 && (
        <ul aria-label="What clashes" style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
          {o.day.clashes.map((c, i) => (
            <li key={i} data-clash={c.kind} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "start", font: "600 13px/19px var(--font)", color: "var(--text-1)" }}>
              <span aria-hidden style={{ width: 16, textAlign: "center", color: "var(--alert)" }}>{c.kind === "overlap" ? "⧉" : "⇥"}</span>
              <span style={{ overflowWrap: "anywhere", textWrap: "pretty" }}>{c.said}</span>
            </li>
          ))}
        </ul>
      )}
      {o.day.owedSaid && <span data-owed style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)", textWrap: "pretty", overflowWrap: "anywhere" }}>{o.day.owedSaid}</span>}
      <button onClick={() => o.go({ room: "calendar" })} style={{ ...button, justifySelf: "start" }}>
        Open the calendar
      </button>
    </section>
  );
}

/** This morning (PLAN 3.5): who answered yesterday's work (his habits, his own brain, the big brain),
 * what it cost, what he learned and the habits the night made, each a tap from being taken back. */
function Morning(o: { card: MorningCard; office: Character[]; takeBack: (u: Undo) => void }) {
  const day = new Date(`${o.card.day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <section aria-label="This morning" data-morning={o.card.day} style={{ display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }}>
      <span style={{ display: "grid" }}>
        <span style={{ font: "800 17px/22px var(--font)", color: "var(--text-1)" }}>This morning</span>
        <span style={{ font: "400 12px/17px var(--font)", color: "var(--text-3)" }}>{day}, and the night after it</span>
      </span>
      {o.card.orbs.map((n) => {
        const c = o.office.find((x) => idOf(x.name) === n.orb);
        const answered = n.habits + n.own + n.big;
        return (
          <div key={n.orb} data-orb={c?.hue} data-morning-orb={n.orb} style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {c && <Orb character={c} size={26} poke={false} still />}
              <span style={{ font: "800 14px/19px var(--font)", color: "var(--accent)" }}>{c?.name ?? n.orb}</span>
              <span style={{ font: "400 12px/17px var(--font)", color: "var(--text-3)", marginLeft: "auto" }}>{n.costUsd ? `$${n.costUsd.toFixed(4)}` : "no cost"} · {n.tokens.toLocaleString("en-GB")} tokens</span>
            </div>
            {answered > 0 && (
              <div role="img" aria-label={`${n.habits} by habits, ${n.own} by ${c?.name ?? n.orb}'s own brain, ${n.big} by the big brain`} style={{ display: "grid", gap: 4 }}>
                <span style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--fill)" }}>
                  {n.habits > 0 && <i data-split="habits" style={{ flex: n.habits, background: "var(--accent)" }} />}
                  {n.own > 0 && <i data-split="own" style={{ flex: n.own, background: "var(--accent-glow)" }} />}
                  {n.big > 0 && <i data-split="big" style={{ flex: n.big, background: "var(--text-3)" }} />}
                </span>
                <span style={{ font: "400 12px/17px var(--font)", color: "var(--text-2)" }}>
                  {n.habits} by habit · {n.own} by {c?.name ?? n.orb}'s own brain · {n.big} by the big brain
                </span>
              </div>
            )}
            {n.undo.map((u) => (
              <div key={u.kind === "lesson" ? `l${u.index}` : `h${u.habit}${u.version}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
                <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere" }}>
                  {u.kind === "lesson" ? `Learned: “${u.line}”` : `A new habit: ${habitWords(u.habit)}`}
                </span>
                <button onClick={() => o.takeBack(u)} style={button}>
                  Take back
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
