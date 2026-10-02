// The notification centre (PLAN 2.11; owner, 10-01: "notification centre for things like that",
// bills due, the accountant). What needs you or happened, from every orb, grouped by orb: a bill
// coming due, a reminder, an approval waiting, work finished. Each opens where it came from; putting
// one away puts it away on every device (the home keeps them). Quiet: a count on the side menu.
import { useEffect, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import { idOf, type Notice, type Office } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";

const MARK: Record<Notice["kind"], string> = { bill: "¤", reminder: "◷", approval: "!", done: "✓" };
const KIND_WORDS: Record<Notice["kind"], string> = { bill: "Bill", reminder: "Reminder", approval: "Waiting for your OK", done: "Finished" };
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
                <article key={n.id} data-notice={n.kind} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: 10, alignItems: "start", padding: "10px 12px", borderRadius: 14, background: "var(--card)", boxShadow: n.kind === "approval" || n.kind === "bill" ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)", minWidth: 0 }}>
                  <span aria-hidden style={{ width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--accent-fill)", color: "var(--accent)", font: "800 14px/16px var(--font)" }}>{MARK[n.kind]}</span>
                  <span style={{ display: "grid", minWidth: 0 }}>
                    <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere", textWrap: "balance" }}>{n.title}</span>
                    <span style={{ font: "400 12px/17px var(--font)", color: "var(--text-3)", overflowWrap: "anywhere" }}>
                      {[KIND_WORDS[n.kind], n.detail, n.due && dueWords(n.due), ago(n.at, now)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                    {where && (
                      <button onClick={() => o.go(where)} style={button}>
                        Open
                      </button>
                    )}
                    <button onClick={() => away(n.id)} aria-label={`Put away: ${n.title}`} style={{ ...button, padding: "6px 10px" }}>
                      ✕
                    </button>
                  </span>
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
