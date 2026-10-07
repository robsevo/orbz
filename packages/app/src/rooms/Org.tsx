// The org chart (PLAN 5.6): everyone in the office by the kind of work they do, the one who leads
// each kind first (its top-ranked orb; the first of a kind starts as its Senior, owner 10-02), the
// Chief above them all when there is one. A face is a press away from his career page.
// The company's shape (PLAN 5.12; owner, 10-07: "restructure it so it fits this makes things easier to see"): you, the
// Founder, at its top; then each department under its head (the Executive the CEO, Build the CTO, Think the Chief of
// Staff, Make the CMO, Finance the CFO, Business the COO, Life your personal assistant), its kinds of work inside it.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import { FAMILIES, SPECIALTIES, type Character, type Family } from "../orb/spec.ts";
import { idOf, type BoardPost, type BoardState, type OrgState, type Office } from "../home/link.ts";
import { Tall } from "../ui/Balanced.tsx";
import { Balanced } from "../ui/Balanced.tsx";
import { ReportCard, SchoolSheet } from "./School.tsx";

const small: CSSProperties = { font: "500 12px/16px var(--font)", color: "var(--text-3)", textWrap: "pretty" };
const POST: Record<BoardPost, string> = { chair: "Chairperson", vice: "Vice Chair", secretary: "Secretary", treasurer: "Treasurer", director: "Director" };
const VOTE: Record<"yes" | "no" | "abstain", string> = { yes: "Yes", no: "No", abstain: "Abstained" };
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
/** Each department's head's post (home org.ts HEAD_OF). */
const HEAD_OF: Record<Family, keyof typeof SPECIALTIES> = { exec: "ceo", build: "cto", think: "chiefofstaff", make: "cmo", finance: "cfo", business: "coo", life: "assistant" };

export function OrgRoom({ home, office, open, rehired, school = null }: { home: Office | null; office: Character[]; open: (c: Character) => void; rehired: () => void; school?: string | null }) {
  const [org, setOrg] = useState<OrgState | null>(null);
  const [board, setBoard] = useState<BoardState | null>(null);
  const [motion, setMotion] = useState(""); // a proposal being written
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.board().then(setBoard, () => setBoard(null));
    load();
    return home.watch({ event: (e) => void (/^(board\.|orb\.)/.test(e.type) && load()) }); // a vote, an election, a hire
  }, [home]);
  const [said, setSaid] = useState<string | null>(null);
  // whose school sheet is open (PLAN 5.7): the orb you let go to send to school, from its profile (owner, 10-06)
  const [sending, setSending] = useState<string | null>(school);
  useEffect(() => setSending(school), [school]);
  // that orb's place on the chart, in view once it is there (it arrives a moment after it is let go)
  const away = org?.away.some((o) => o.id === sending) ?? false;
  // a block, not an arrow's value: Chromium's scrollIntoView returns a Promise, and an effect that returns
  // one has React take it for its clean-up, which throws when the effect is torn down
  useEffect(() => {
    if (away && sending) document.querySelector(`[data-away="${CSS.escape(sending)}"]`)?.scrollIntoView({ block: "center" });
  }, [away, sending]);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.org().then(setOrg, (e: Error) => setSaid(e.message));
    load();
    return home.watch({ event: (e) => void (/^(orb\.|promotion\.|school\.(enrolled|ended|graduated))/.test(e.type) && load()) }); // a hire, a let-go, a rehire, a promotion, school
  }, [home]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>The org chart is the home's: open the app from your home to see it.</p>;
  if (!org) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading the office…"}</p>;
  const face = (id: string): Character | undefined => office.find((c) => idOf(c.name) === id);
  const kinds = [...new Set(org.orbs.map((o) => o.specialty))];
  const familyOf = (k: string): Family => (SPECIALTIES[k as keyof typeof SPECIALTIES]?.family ?? "think") as Family;
  const card = (id: string, lead: boolean): ReactNode => {
    const o = org.orbs.find((x) => x.id === id);
    const c = face(id);
    if (!o || !c) return null;
    return (
      <button key={id} data-org-orb={id} data-orb={c.hue} onClick={() => open(c)} aria-label={`${o.name}, ${o.level}${lead ? `, leads ${SPECIALTIES[o.specialty as keyof typeof SPECIALTIES]?.title ?? o.specialty} work` : ""}`}
        style={{ display: "grid", justifyItems: "center", gap: 2, padding: "10px 8px", border: 0, borderRadius: 14, cursor: "pointer", background: lead ? "var(--accent-fill)" : "var(--fill)", boxShadow: lead ? "inset 0 0 0 1.5px var(--accent)" : "none", minWidth: 0 }}>
        <Orb character={c} size={56} poke={false} still />
        <span style={{ font: "700 13px/18px var(--font)", color: "var(--text-1)" }}>{o.name}</span>
        <span style={small}>{lead ? `${o.level} · leads` : o.level}</span>
      </button>
    );
  };
  return (
    <div data-org style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <h2 style={{ margin: 0, font: "800 22px/28px var(--font)", color: "var(--text-1)" }}>The org chart</h2>
      {/* you, at its top (owner, 10-07: "You are the Founder of a brand new Orb startup") */}
      {org.founder && (
        <section aria-label="Founder" data-founder style={{ display: "grid", justifyItems: "center", gap: 2 }}>
          <span style={head}>{org.company ? `Founder of ${org.company}` : "Founder"}</span>
          <span style={{ font: "800 18px/24px var(--font)", color: "var(--text-1)" }}>{org.founder}</span>
        </section>
      )}
      {org.chief && (
        <section aria-label="Chief" style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>Chief</span>
          {card(org.chief, true)}
        </section>
      )}
      {/* the board (PLAN 5.16; owner, 10-07): always odd, its officers by their posts, the rest elected by everyone; a
          proposal put to it is read and voted on by each member */}
      {board && (
        <section aria-label="The board" data-board style={{ display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "linear-gradient(160deg, var(--accent-wash), var(--fill) 60%)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 }} data-orb="honey">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
            <span style={{ font: "800 17px/22px var(--font)", color: "var(--text-1)" }}>The board</span>
            <span data-board-size style={small}>{board.size ? `${board.size} ${board.size === 1 ? "seat" : "seats"}, always an odd number` : "No board yet"}</span>
          </div>
          {board.size < 3 ? (
            <span style={small}>The board sits once the company has three orbs. Until then your CEO decides alone.</span>
          ) : (
            <Balanced min={130}>
              {board.seats.map((st) => {
                const c = face(st.orb);
                const votes = board.election?.votes.filter((v) => v.for === st.orb).length ?? 0;
                return (
                  <button key={st.orb} type="button" data-seat={st.post} data-orb={c?.hue} onClick={() => c && open(c)} style={{ display: "grid", justifyItems: "center", gap: 2, padding: "10px 8px", border: 0, borderRadius: 14, cursor: "pointer", background: st.post === "chair" ? "var(--accent-fill)" : "var(--fill)", boxShadow: st.post === "chair" ? "inset 0 0 0 1.5px var(--accent)" : "none", minWidth: 0 }}>
                    {c && <Orb character={c} size={52} poke={false} still />}
                    <span style={{ font: "700 13px/18px var(--font)", color: "var(--text-1)" }}>{st.name}</span>
                    <span style={small}>{(st.post === "vice" || st.post === "director") && votes ? `${POST[st.post]} · ${votes} ${votes === 1 ? "vote" : "votes"}` : POST[st.post]}</span>
                  </button>
                );
              })}
            </Balanced>
          )}
          {board.size >= 3 && (
            <form
              data-propose
              onSubmit={(e) => {
                e.preventDefault();
                const t = motion.trim();
                if (t) void home.propose(t).then(() => setMotion(""), (err: Error) => setSaid(err.message));
              }}
              style={{ display: "grid", gap: 6 }}
            >
              <label style={head} htmlFor="board-motion">Put a proposal to the board</label>
              <textarea id="board-motion" value={motion} onChange={(e) => setMotion(e.target.value)} maxLength={600} rows={2} placeholder="Hire a CFO and open Finance this month" style={{ font: "500 15px/21px var(--font)", color: "var(--text-1)", background: "var(--card)", border: 0, borderRadius: 12, padding: "10px 12px", resize: "vertical", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span style={small}>Each member reads it and votes, with a line why; a majority carries it, and every orb follows it.</span>
                <button type="submit" disabled={!motion.trim()} style={{ font: "700 13px/18px var(--font)", border: 0, borderRadius: 10, padding: "8px 14px", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", color: "var(--text-1)", cursor: "pointer", opacity: motion.trim() ? 1 : 0.5 }}>Put it to the vote</button>
              </div>
            </form>
          )}
          {board.proposals.length > 0 && (
            <Tall max="40dvh" label="The board's proposals">
              <ul style={{ display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
                {board.proposals.map((p) => {
                  const yes = p.votes.filter((v) => v.vote === "yes").length;
                  const no = p.votes.filter((v) => v.vote === "no").length;
                  return (
                    <li key={p.id} data-proposal={p.carried === null ? "voting" : p.carried ? "carried" : "rejected"} style={{ display: "grid", gap: 4, padding: "10px 12px", borderRadius: 12, background: "var(--card)", boxShadow: "inset 0 0 0 .5px var(--hairline)" }}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ font: "600 14px/20px var(--font)", color: "var(--text-1)", minWidth: 0, overflowWrap: "anywhere" }}>{p.text}</span>
                        <b style={{ font: "800 12px/16px var(--font)", color: p.carried === null ? "var(--text-3)" : p.carried ? "var(--accent)" : "var(--alert)", whiteSpace: "nowrap" }}>{p.carried === null ? "Voting…" : `${p.carried ? "Carried" : "Rejected"} ${yes}–${no}`}</b>
                      </span>
                      {p.votes.map((v) => (
                        <span key={v.orb} data-vote={v.vote} style={small}>{`${v.name} (${POST[v.post]}): ${VOTE[v.vote]}${v.why ? `, ${v.why}` : ""}`}</span>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </Tall>
          )}
        </section>
      )}
      {/* let go (PLAN 5.5): out of the office, still learning, a press from coming back */}
      {org.away.length > 0 && (
        <section aria-label="Away" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>Away</span>
          {org.away.map((o) => (
            <div key={o.id} data-away={o.id} style={{ display: "grid", gap: 8, padding: "8px 10px", borderRadius: 12, background: "var(--fill)", minWidth: 0 }}>
              {/* who, then what you can do: the two never wrap into one row with a button left alone under it */}
              <span style={{ minWidth: 0, display: "grid" }}>
                <span style={{ font: "600 13px/18px var(--font)", color: "var(--text-1)" }}>{`${o.name}, ${o.level}`}</span>
                {(o.atSchool || o.diplomas.length > 0) && <span style={small}>{[o.atSchool ? "At school" : null, ...o.diplomas.map((d) => `🎓 ${d}`)].filter(Boolean).join(" · ")}</span>}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                {!o.atSchool && (
                  <button type="button" aria-expanded={sending === o.id} onClick={() => setSending(sending === o.id ? null : o.id)} style={{ font: "600 12px/16px var(--font)", border: 0, borderRadius: 8, padding: "5px 10px", background: "var(--raised)", color: "var(--text-1)", cursor: "pointer", flex: "0 0 auto" }}>
                    {`Send ${o.name} to school`}
                  </button>
                )}
                <button type="button" onClick={() => void home.rehire(o.id).then(() => rehired(), (e: Error) => setSaid(e.message))} style={{ font: "600 12px/16px var(--font)", border: 0, borderRadius: 8, padding: "5px 10px", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", color: "var(--text-1)", cursor: "pointer", flex: "0 0 auto" }}>
                  Rehire {o.name}
                </button>
              </div>
              {sending === o.id && !o.atSchool && <SchoolSheet home={home} orb={o.id} name={o.name} sent={() => setSending(null)} />}
              <ReportCard home={home} orb={o.id} name={o.name} />
            </div>
          ))}
        </section>
      )}
      {/* each department under its head, its kinds of work inside it */}
      {(Object.keys(FAMILIES) as Family[]).filter((f) => kinds.some((k) => familyOf(k) === f) || org.heads?.[f]).map((f) => {
        const headId = org.heads?.[f] ?? null;
        const headPost = SPECIALTIES[HEAD_OF[f]].title;
        const headName = headId ? org.orbs.find((o) => o.id === headId)?.name : null;
        return (
          <section key={f} data-department={f} aria-label={FAMILIES[f]} style={{ display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
              <span style={{ font: "800 17px/22px var(--font)", color: "var(--text-1)" }}>{FAMILIES[f]}</span>
              <span data-head={headId ?? "none"} style={small}>{headName ? `Headed by ${headName}, ${headPost}` : `No ${headPost} yet`}</span>
            </div>
            {kinds.filter((k) => familyOf(k) === f).map((k) => {
              const lead = org.leads[k];
              const rest = org.orbs.filter((o) => o.specialty === k && o.id !== lead && o.id !== org.chief).map((o) => o.id);
              return (
                <section key={k} data-kind={k} aria-label={SPECIALTIES[k as keyof typeof SPECIALTIES]?.title ?? k} style={{ display: "grid", gap: 8, minWidth: 0 }}>
                  <span style={head}>{SPECIALTIES[k as keyof typeof SPECIALTIES]?.title ?? k}</span>
                  <Balanced min={120}>
                    {[lead && lead !== org.chief ? card(lead, true) : null, ...rest.map((id) => card(id, false))].filter(Boolean)}
                  </Balanced>
                </section>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
