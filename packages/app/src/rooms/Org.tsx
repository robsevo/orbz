// The org chart (PLAN 5.6): everyone in the office by the kind of work they do, the one who leads
// each kind first (its top-ranked orb; the first of a kind starts as its Senior, owner 10-02). A face is
// a press away from his career page.
// The company's shape (PLAN 5.12; owner, 10-07: "restructure it so it fits this makes things easier to see"): you, the
// Founder, at its top; then each department under its head (the Executive the CEO, Build the CTO, Think the Chief of
// Staff, Make the CMO, Finance the CFO, Business the COO, Life your personal assistant), its kinds of work inside it.
// Drawn as a tree (owner, 10-08: "Org chart needs to be nicer too lol. like a family tree or corporate latter"): you,
// a line down to the CEO, a bar to every department's head, and each head's team hanging from it by its kind of work
// (the shape is `chart.ts`'s). Where every department gets a column of its own the tree hangs down like a family tree;
// narrower (a phone), the same tree runs down the page, each rung stepped in under the one above.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import { FAMILIES, SPECIALTIES, type Character, type Family } from "../orb/spec.ts";
import { idOf, type BoardPost, type BoardState, type OrgState, type Office } from "../home/link.ts";
import { MARKS } from "../floor/plan.ts";
import { Tall } from "../ui/Balanced.tsx";
import { Balanced } from "../ui/Balanced.tsx";
import { chartOf, HEAD_OF, HUE_OF, type Kind } from "./chart.ts";
import { ReportCard, SchoolSheet } from "./School.tsx";

const small: CSSProperties = { font: "500 12px/16px var(--font)", color: "var(--text-3)", textWrap: "pretty" };
const POST: Record<BoardPost, string> = { chair: "Chairperson", vice: "Vice Chair", secretary: "Secretary", treasurer: "Treasurer", director: "Director" };
const VOTE: Record<"yes" | "no" | "abstain", string> = { yes: "Yes", no: "No", abstain: "Abstained" };
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
/** A department's sign, as on the floor: its mark and name in capitals, ringed in its colour. */
const sign: CSSProperties = { ...head, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-1)", padding: "2px 10px", borderRadius: 999, background: "var(--card)", boxShadow: "inset 0 0 0 1.5px var(--accent)", whiteSpace: "nowrap" };
/** A department's place on the tree: washed in its colour, ringed. */
const branch: CSSProperties = { display: "grid", justifyItems: "center", alignContent: "start", gap: 8, padding: "10px 8px", borderRadius: 18, background: "linear-gradient(160deg, var(--accent-wash), var(--fill) 70%)", boxShadow: "inset 0 0 0 1.5px var(--accent)", minWidth: 0 };
/** How wide a department's column must be for the tree to hang down like a family tree, every head side by side. */
const COLUMN = 150;
/** The tree's lines, in the quiet grey kept for rules. Hung down, the heads sit side by side under a bar from the CEO;
 * run down the page, each rung steps in under the one above on an elbow. Either way a team's kinds of work hang from
 * its head on elbows, the line running on to the next. */
export const TREE_CSS = `
.orbs-tree { --line: var(--quiet); --w: 2px; display: grid; min-width: 0; }
.orbs-tree ul { list-style: none; margin: 0; padding: 0; min-width: 0; }
.orbs-tree li { position: relative; min-width: 0; }
.orbs-tree-stem { display: block; width: var(--w); height: 22px; background: var(--line); }
.orbs-tree-team { display: grid; gap: 12px; padding-top: 12px; margin-left: 12px; }
.orbs-tree-team > li { display: grid; gap: 6px; padding-left: 16px; }
.orbs-tree-team > li::before { content: ""; position: absolute; left: 0; top: -12px; width: 11px; height: 20px; border-left: var(--w) solid var(--line); border-bottom: var(--w) solid var(--line); border-bottom-left-radius: 8px; }
.orbs-tree-team > li:not(:last-child)::after { content: ""; position: absolute; left: 0; top: 6px; bottom: -12px; border-left: var(--w) solid var(--line); }
.orbs-tree[data-layout="down"] { justify-items: center; }
.orbs-tree[data-layout="down"] .orbs-tree-rung { display: flex; justify-content: center; align-items: flex-start; width: 100%; }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li { flex: 1 1 0; max-width: 240px; display: grid; align-content: start; padding: 22px 5px 0; }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li::before,
.orbs-tree[data-layout="down"] .orbs-tree-rung > li::after { content: ""; position: absolute; top: 0; height: 22px; border-top: var(--w) solid var(--line); }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li::before { left: 0; width: 50%; }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li::after { left: calc(50% - var(--w) / 2); right: 0; border-left: var(--w) solid var(--line); }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li:first-child::before { border-top: 0; }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li:first-child::after { border-top-left-radius: 12px; }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li:last-child::before { width: calc(50% + var(--w) / 2); border-right: var(--w) solid var(--line); border-top-right-radius: 12px; }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li:last-child::after { border: 0; }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li:only-child::before { border: 0; }
.orbs-tree[data-layout="down"] .orbs-tree-rung > li:only-child::after { border-top: 0; border-left: var(--w) solid var(--line); border-radius: 0; }
.orbs-tree[data-layout="side"] { justify-items: stretch; --trunk: 28px; }
.orbs-tree[data-layout="side"] .orbs-tree-stem { margin-left: calc(var(--trunk) - var(--w) / 2); height: 14px; }
.orbs-tree[data-layout="side"] .orbs-tree-rung { display: grid; gap: 14px; margin-left: calc(var(--trunk) - var(--w) / 2); }
.orbs-tree[data-layout="side"] .orbs-tree-rung > li { display: grid; padding-left: 18px; }
.orbs-tree[data-layout="side"] .orbs-tree-rung > li::before { content: ""; position: absolute; left: 0; top: -14px; width: 14px; height: 36px; border-left: var(--w) solid var(--line); border-bottom: var(--w) solid var(--line); border-bottom-left-radius: 10px; }
.orbs-tree[data-layout="side"] .orbs-tree-rung > li:not(:last-child)::after { content: ""; position: absolute; left: 0; top: 20px; bottom: -14px; border-left: var(--w) solid var(--line); }
`;

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
  // how wide the tree has to hang in, measured before it is painted, so it never flashes the other way first
  const tree = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = tree.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [org === null]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>The org chart is the home's: open the app from your home to see it.</p>;
  if (!org) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading the office…"}</p>;
  const face = (id: string): Character | undefined => office.find((c) => idOf(c.name) === id);
  const chart = chartOf(org);
  const down = width >= Math.max(1, chart.branches.length) * COLUMN;
  /** An orb on the tree, a press from its career page, its face close up as on any org chart: a kind's lead ringed in
   * its colour and marked Lead; a head (`post`) bare on its department's branch, its post beside its level. Hung down
   * each stands up in its column; on a phone each lies on its side, its face by its name. */
  const card = (id: string, o: { lead?: boolean; post?: string; size?: number } = {}): ReactNode => {
    const m = org.orbs.find((x) => x.id === id);
    const c = face(id);
    if (!m || !c) return null;
    const title = SPECIALTIES[m.specialty as keyof typeof SPECIALTIES]?.title ?? m.specialty;
    const side = !down;
    return (
      <button key={id} type="button" data-org-orb={id} data-orb={c.hue} onClick={() => open(c)} aria-label={o.post ? `${m.name}, ${m.level}, ${title}` : `${m.name}, ${m.level}${o.lead ? `, leads ${title} work` : ""}`}
        style={{ display: "grid", ...(side ? { gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 10, alignItems: "center", justifyItems: "start", textAlign: "start" } : { justifyItems: "center", textAlign: "center" }), gap: 2, width: "100%", padding: o.post ? 0 : "8px 6px", border: 0, borderRadius: 14, cursor: "pointer", background: o.post ? "transparent" : o.lead ? "var(--accent-fill)" : "var(--fill)", ...(side && !o.post && { padding: "6px 8px" }), boxShadow: o.lead ? "inset 0 0 0 1.5px var(--accent)" : "none", minWidth: 0 }}>
        <Orb character={c} size={(o.size ?? 48) - (side ? 8 : 0)} poke={false} still framing="portrait" />
        <span style={{ display: "grid", gap: 2, justifyItems: side ? "start" : "center", minWidth: 0 }}>
          <span style={{ font: "700 13px/18px var(--font)", color: "var(--text-1)" }}>{m.name}</span>
          <span style={{ display: "flex", flexWrap: "wrap", justifyContent: side ? "start" : "center", alignItems: "center", gap: "2px 6px", minWidth: 0 }}>
            {o.post && <span style={{ font: "700 12px/16px var(--font)", color: "var(--text-2)" }}>{o.post}</span>}
            <span style={small}>{m.level}</span>
            {o.lead && <span data-lead style={{ font: "800 10px/14px var(--font)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-1)", padding: "0 6px", borderRadius: 6, boxShadow: "inset 0 0 0 1px var(--accent)" }}>Lead</span>}
          </span>
        </span>
      </button>
    );
  };
  /** A team's kind of work: its name, its lead first, then the rest; one under another in a column, side by side on
   * a phone. */
  const kind = (t: Kind): ReactNode => {
    const title = SPECIALTIES[t.kind as keyof typeof SPECIALTIES]?.title ?? t.kind;
    const cards = [t.lead ? card(t.lead, { lead: true }) : null, ...t.rest.map((id) => card(id))].filter(Boolean);
    return (
      <li key={t.kind} data-kind={t.kind} aria-label={title}>
        <span style={{ ...head, textWrap: "pretty" }}>{title}</span>
        {down ? <div style={{ display: "grid", gap: 6 }}>{cards}</div> : <Balanced min={132} gap={6}>{cards}</Balanced>}
      </li>
    );
  };
  /** A department's branch: its sign, then its head (or the post still empty), its team hanging under it. */
  const department = (f: Family, headId: string | null, team: Kind[], size: number): ReactNode => (
    <>
      <section aria-label={`${FAMILIES[f]}'s head`} data-orb={HUE_OF[f]} style={{ ...branch, ...(!down && { justifyItems: "stretch" }) }}>
        <span style={{ ...sign, justifySelf: down ? "center" : "start" }}><span aria-hidden>{MARKS[f]}</span>{FAMILIES[f]}</span>
        {headId ? (
          <div data-head={headId} style={{ display: "grid", minWidth: 0 }}>{card(headId, { post: SPECIALTIES[HEAD_OF[f]].label, size })}</div>
        ) : (
          <span data-head="none" style={{ ...small, color: "var(--text-2)", textAlign: down ? "center" : "start", textWrap: "balance", padding: "10px 6px", borderRadius: 12, boxShadow: "inset 0 0 0 1.5px var(--hairline)" }}>{`No ${SPECIALTIES[HEAD_OF[f]].label} yet`}</span>
        )}
      </section>
      {team.length > 0 && <ul className="orbs-tree-team">{team.map(kind)}</ul>}
    </>
  );
  return (
    <div data-org style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <h2 style={{ margin: 0, font: "800 22px/28px var(--font)", color: "var(--text-1)" }}>The org chart</h2>
      <style>{TREE_CSS}</style>
      {/* the tree: you at its root (owner, 10-07: "You are the Founder of a brand new Orb startup"), the CEO under you,
          every department's head under the CEO, each team under its head */}
      <div ref={tree} className="orbs-tree" data-org-tree data-layout={down ? "down" : "side"}>
        <section aria-label="Founder" data-founder data-orb="honey" style={{ display: "grid", ...(down ? { justifyItems: "center", textAlign: "center", minWidth: 200 } : { gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 12, alignItems: "center" }), gap: 2, padding: "12px 18px", borderRadius: 18, background: "linear-gradient(165deg, var(--raised), var(--card))", boxShadow: "0 0 0 2px var(--accent), 0 0 0 5px var(--accent-fill), 0 10px 28px var(--shadow)", minWidth: 0 }}>
          {/* the crown of the Founder's badge (the first open's), in its gold */}
          <svg aria-hidden viewBox="0 0 48 34" width={34} height={24} style={{ fill: "var(--accent)" }}>
            <path d="M5 27 L2 8 L14 17 L24 3 L34 17 L46 8 L43 27 Z" />
            <rect x="5" y="28" width="38" height="5" rx="2" />
            <circle cx="2.5" cy="7" r="2.5" />
            <circle cx="24" cy="3" r="3" />
            <circle cx="45.5" cy="7" r="2.5" />
          </svg>
          <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
            {org.company && <span style={{ ...head, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{org.company}</span>}
            <span style={{ font: "800 12px/16px var(--font)", letterSpacing: ".2em", color: "var(--accent)" }}>FOUNDER</span>
            <span style={{ font: "800 18px/24px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{org.founder ?? "You"}</span>
          </span>
        </section>
        <span aria-hidden className="orbs-tree-stem" />
        {chart.ceo ? (
          <div data-department="exec" aria-label={FAMILIES.exec} style={{ display: "grid", minWidth: down ? 220 : 0 }}>{department("exec", chart.ceo, chart.executive, 64)}</div>
        ) : (
          <div style={{ display: "grid", minWidth: down ? 220 : 0 }}>{department("exec", null, chart.executive, 64)}</div>
        )}
        {chart.branches.length > 0 && <span aria-hidden className="orbs-tree-stem" />}
        {chart.branches.length > 0 && (
          <ul className="orbs-tree-rung">
            {chart.branches.map((b) => (
              <li key={b.family} data-department={b.family} aria-label={FAMILIES[b.family]}>
                {department(b.family, b.head, b.team, 56)}
              </li>
            ))}
          </ul>
        )}
      </div>
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
                    {c && <Orb character={c} size={48} poke={false} still framing="portrait" />}
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
    </div>
  );
}
