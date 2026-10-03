// The team's board on the Floor (PLAN 5.1, 5.2): the session's plans row by row, who holds which
// (his face), the rows that passed and wait for a review (yours: Approve, or Ask for changes with a
// note), the changes an orb proposed (Agree is your second), a claim gone stale (Let it go), and what
// happened, in the board's own words (written by code from its events: no model, nothing spent).
import { useEffect, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import { idOf, type SessionBoard, type Office } from "../home/link.ts";

const small: CSSProperties = { font: "500 12px/16px var(--font)", color: "var(--text-3)" };
const button: CSSProperties = { font: "600 12px/16px var(--font)", border: 0, borderRadius: 8, padding: "5px 10px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 28, flex: "0 0 auto" };
const BOX: Record<string, string> = { "[ ]": "To do", "[~]": "Started", "[x]": "Done" };

export function TeamBoard({ home, session, office }: { home: Office; session: number; office: Character[] }) {
  const [board, setBoard] = useState<SessionBoard | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [noting, setNoting] = useState<{ plan: number; row: string; note: string } | null>(null);
  const load = (): void => void home.sessionBoard(session).then(setBoard, (e: Error) => setSaid(e.message));
  useEffect(() => {
    load();
    return home.watch({ event: (e) => void (/^(board\.|claim\.|amendment\.)/.test(e.type) && load()) });
  }, [home, session]);
  if (!board || !board.plans.length) return null; // no approved plan in this session yet: nothing to show
  const face = (orb: string): Character | undefined => office.find((c) => idOf(c.name) === orb);
  const holder = (plan: number, row: string) => board.claims.find((c) => c.plan === plan && c.rows.includes(row));
  const act = (p: Promise<unknown>): void => void p.then(load, (e: Error) => setSaid(e.message));

  return (
    <section aria-label="The board" data-board style={{ display: "grid", gap: 10, minWidth: 0 }}>
      {board.plans.map((p) => (
        <div key={p.id} style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>{p.title}</span>
          {p.rows.filter((r) => !r.test).map((r) => {
            const h = holder(p.id, r.row);
            const c = h ? face(h.orb) : undefined;
            const waiting = r.review?.startsWith("waiting:") ? r.review.slice("waiting:".length) : null;
            return (
              <div key={r.row} data-row={r.row} data-box={r.box} style={{ display: "grid", gap: 4, padding: "6px 10px", borderRadius: 10, background: "var(--fill)", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ font: "700 12px/16px var(--mono)", color: "var(--text-2)", flex: "0 0 auto" }}>{r.row}</span>
                  <span style={{ ...small, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{BOX[r.box] ?? r.box}{waiting ? ", waits for a review" : ""}</span>
                  {c && (
                    <span data-holder={h!.orb} data-orb={c.hue} style={{ display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}>
                      <Orb character={c} size={20} poke={false} still />
                      <span style={{ font: "600 12px/16px var(--font)", color: "var(--accent)" }}>{c.name}</span>
                    </span>
                  )}
                </div>
                {h?.stale && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={small}>{`${h.name} has been quiet for 90 minutes`}</span>
                    <button type="button" onClick={() => act(home.recoverClaim(session, h.id))} style={button}>Let it go</button>
                  </div>
                )}
                {waiting && (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <button type="button" onClick={() => act(home.reviewRow(p.id, r.row, true, ""))} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>Approve</button>
                    {noting?.row === r.row && noting.plan === p.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); act(home.reviewRow(p.id, r.row, false, noting.note)); setNoting(null); }} style={{ display: "flex", gap: 6, flex: "1 1 200px", minWidth: 0 }}>
                        <input aria-label="What to change" value={noting.note} onChange={(e) => setNoting({ ...noting, note: e.target.value })} style={{ flex: "1 1 auto", minWidth: 0, font: "400 13px/18px var(--font)", color: "var(--text-1)", background: "var(--raised)", border: 0, borderRadius: 8, padding: "5px 8px" }} />
                        <button type="submit" style={button}>Send</button>
                      </form>
                    ) : (
                      <button type="button" onClick={() => setNoting({ plan: p.id, row: r.row, note: "" })} style={button}>Ask for changes</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {p.changes.filter((m) => !m.agreedBy).map((m) => (
            <div key={m.id} data-change={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 10, boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
              <span style={{ ...small, flex: "1 1 200px", minWidth: 0 }}>{`${face(m.proposer)?.name ?? m.proposer} proposes row ${m.row}: ${m.feature}`}</span>
              <button type="button" onClick={() => act(home.agreeChange(m.id))} style={button}>Agree</button>
            </div>
          ))}
        </div>
      ))}
      {board.chatter.length > 0 && (
        <div aria-label="What happened" style={{ display: "grid", gap: 2 }}>
          {board.chatter.slice(-6).map((l) => (
            <span key={l.seq} style={small}>{l.text}</span>
          ))}
        </div>
      )}
      {said && <span role="status" style={small}>{said}</span>}
    </section>
  );
}
