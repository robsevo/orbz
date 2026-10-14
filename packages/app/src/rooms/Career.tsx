// An orb's career page (PLAN 5.6), all of it read off the home's log: who it is and where it stands on the
// ladder, its level and the XP to the next, its traits now and the radar of what it does, the work it
// finished lately, and its life with the others (owner, 10-07: "make the career section for orbs a little
// more intricate", "its where we see the orbs growth"): the friends it made, the meetings and the ideas
// traded in them (each orb's own latest work, by code), the lessons passed; then its habits, reviews, its
// weekly card and its report card. Promote and Not yet when it is ready: only you promote.
// Its brand (PLAN 5.44; owner, 10-14: "how theyre perceived as a whole around the office"): the score and its word, the
// fortnight's line, and the five parts that make it, each a bar from the middle (yours to read, never a model's).
// And what it wants (owner, 10-07: "they also want to be the best orb also, not only the best at their
// position. Their one goal in life is to get xp and please the user"): the office by XP, where it stands.
// On a phone (owner, 10-07: "career page on mobile is not organized. organize it, put scrolls for sections that are
// too long and center the orb"): who it is in one centred column, the ladder in two rows of three, its traits two
// across, and every list that runs long (the office, its work, its meetings, its habits) scrolls inside its card.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import { sheetOf, SPECIALTIES, type Character } from "../orb/spec.ts";
import { grownOf, TOTAL } from "../orb/dna.ts";
import { idOf, type Brand, type CareerState, type Office } from "../home/link.ts";
import { span } from "../orb/age.ts";
import { Radar } from "../ui/Radar.tsx";
import { NAMES } from "../floor/props.ts";
import { Balanced, Tall } from "../ui/Balanced.tsx";
import { useCramped } from "../ui/fill.ts";
import { ReportCard } from "./School.tsx";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const body: CSSProperties = { font: "500 14px/20px var(--font)", color: "var(--text-1)", textWrap: "pretty", overflowWrap: "anywhere" };
const button: CSSProperties = { font: "600 13px/18px var(--font)", border: 0, borderRadius: 10, padding: "8px 12px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 34 };
const card: CSSProperties = { display: "grid", gap: 10, alignContent: "start", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 };
const SUGGEST: Record<string, string> = { promote: "Ready for a promotion", keep: "Keep going", retrain: "Some practice", "let go": "Give work, or let go" };
/** The ladder, as the home has it (gym/levels.ts). */
const LADDER = ["Junior", "Mid", "Senior", "Staff", "Principal", "Chief"] as const;
const PLACE: Record<string, string> = { coffee: "over a coffee", cooler: "at the water cooler", bistro1: "at the bistro table", bistro2: "at the bistro table", pingpong: "at the ping-pong table", arcade: "at the arcade", desk: "at a desk" };
const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
/** Where it stands, against the one just ahead (or, at the top, just behind). */
function standing(board: { name: string; xp: number }[], at: number): string {
  if (board.length < 2) return "The only orb in the office so far.";
  const other = board[at === 0 ? 1 : at - 1]!;
  const gap = Math.abs(board[at]!.xp - other.xp);
  return `${ordinal(at + 1)} of ${board.length}, ${gap === 0 ? `level with ${other.name}` : `${gap.toLocaleString("en-GB")} XP ${at === 0 ? "ahead of" : "behind"} ${other.name}`}.`;
}
const when = (at: number): string => new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Section({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} style={card}>
      <span style={head}>{title}</span>
      {children}
    </section>
  );
}

/** The fortnight as a line: the score each day, today's dot at its end. */
function Spark({ days }: { days: number[] }) {
  if (days.length < 2) return null;
  const w = 120, h = 34, lo = Math.min(...days, 40), hi = Math.max(...days, 60);
  const x = (i: number): number => 3 + (i / (days.length - 1)) * (w - 6);
  const y = (v: number): number => 3 + (1 - (v - lo) / Math.max(1, hi - lo)) * (h - 6);
  return (
    <svg data-brand-spark width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flex: "0 0 auto", overflow: "visible" }}>
      <line x1={0} x2={w} y1={y(50)} y2={y(50)} style={{ stroke: "var(--hairline)", strokeDasharray: "2 3" }} />
      <polyline points={days.map((v, i) => `${x(i)},${y(v)}`).join(" ")} style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} />
      <circle cx={x(days.length - 1)} cy={y(days.at(-1)!)} r={3.5} style={{ fill: "var(--accent)" }} />
    </svg>
  );
}

/** Its brand: how the office as a whole sees it. */
export function BrandCard({ brand, name, phone }: { brand: Brand; name: string; phone: boolean }) {
  const week = brand.week ?? (brand.history.length > 7 ? brand.score - brand.history[brand.history.length - 8]! : 0);
  const REACH: Record<string, number> = { people: 25, work: 25, ideas: 10, helping: 10, record: 15 };
  return (
    <Section title="Brand" label="Brand">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", flexWrap: "wrap", minWidth: 0 }}>
        <div role="meter" aria-label={`${name}'s brand`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={brand.score} data-brand={brand.score} style={{ position: "relative", width: 64, height: 64, flex: "0 0 auto", borderRadius: "50%", background: `conic-gradient(var(--accent) ${brand.score * 3.6}deg, var(--fill-2) 0)` }}>
          <span style={{ position: "absolute", inset: 6, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--fill)", font: "800 22px/1 var(--font)", color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>{brand.score}</span>
        </div>
        <div style={{ display: "grid", gap: 2, flex: "1 1 140px", minWidth: 0 }}>
          <span data-brand-word style={{ font: "800 18px/24px var(--font)", color: "var(--accent)" }}>{brand.word}</span>
          <span style={small}>{week === 0 ? "Level with a week ago." : `${week > 0 ? "Up" : "Down"} ${Math.abs(week)} since a week ago.`}</span>
        </div>
        {!phone && <Spark days={brand.history} />}
      </div>
      <span style={small}>{`How the whole office sees ${name}, from 0 to 100. Everyone starts at 50.`}</span>
      {/* what it changes (home: social/rules.ts pickPair and pickMoment, the board's votes, who fits a team's row) */}
      <span data-brand-effect style={{ ...small, color: "var(--text-2)" }}>
        {brand.score >= 65
          ? `The office seeks ${name} out: its moments land warmer, and the board's votes and team picks lean its way.`
          : brand.score < 40
            ? `The office keeps its distance: its moments land flatter, and the board's votes and team picks lean away.`
            : "Work you approve, ideas you take, helping out and good friendships raise it."}
      </span>
      <ul aria-label="What makes it" style={{ display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
        {brand.parts.map((p) => {
          const reach = REACH[p.key] ?? 25;
          const share = Math.min(1, Math.abs(p.points) / reach) * 50;
          return (
            <li key={p.key} data-brand-part={p.key} style={{ display: "grid", gap: 3, minWidth: 0 }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                <span style={{ ...small, color: "var(--text-2)", fontWeight: 700 }}>{p.label}</span>
                <b style={{ font: "800 13px/18px var(--font)", color: p.points > 0 ? "var(--accent)" : p.points < 0 ? "var(--off)" : "var(--text-3)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{p.points > 0 ? `+${p.points}` : p.points}</b>
              </span>
              <span style={{ position: "relative", display: "block", height: 6, borderRadius: 3, background: "var(--fill-2)", overflow: "hidden" }}>
                <i style={{ position: "absolute", top: 0, bottom: 0, left: p.points < 0 ? `${50 - share}%` : "50%", width: `${share}%`, background: p.points < 0 ? "var(--off)" : "var(--accent)" }} />
                <i style={{ position: "absolute", top: 0, bottom: 0, left: "calc(50% - .5px)", width: 1, background: "var(--text-3)", opacity: 0.5 }} />
              </span>
              <span style={small}>{p.why}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function CareerRoom({ home, orb }: { home: Office | null; orb: Character }) {
  const [c, setC] = useState<CareerState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const phone = useCramped("(max-width: 760px)");
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.career(orb).then(setC, (e: Error) => setSaid(e.message));
    load();
    // its work, its level, and its life with the others: a meeting, a friendship, a lesson
    // (anyone's XP moves the office's table)
    return home.watch({ event: (e) => void ((e.orb === idOf(orb.name) || /^(social|xp)\./.test(e.type)) && /^(xp\.|orb\.|promotion\.|habit\.|performance\.|board\.|run\.finished|social\.|brand\.|report\.idea_|card\.resolved|trace\.feedback)/.test(e.type) && load()) });
  }, [home, orb.name]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>Careers are the home's: open the app from your home to see one.</p>;
  if (!c) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading…"}</p>;
  const sh = sheetOf(orb);
  const grown = grownOf(orb, sh.leans, c.radar, c.niches, sh.dna, c.xp);
  // an area no one in the office works in yet stays off every radar until it has work in it (the desk's)
  const areas = Object.entries(c.radar).filter(([name, a]) => name !== "desk" || a.xp > 0 || a.runs > 0);
  const top = Math.max(1, ...areas.map(([, a]) => a.xp));
  const toNext = c.next ? Math.min(1, c.next.evidence.xp.has / Math.max(1, c.next.evidence.xp.needs)) : 1;
  const rung = LADDER.indexOf(c.level as (typeof LADDER)[number]);
  const peak = Math.max(...grown.traits.map((t) => t.value), TOTAL / 7);
  const meetings = c.meetings ?? [];
  const board = c.ranking ?? [];
  const at = board.findIndex((r) => r.orb === idOf(orb.name));
  const most = Math.max(1, ...board.map((r) => r.xp));
  return (
    <div data-career={idOf(orb.name)} data-orb={orb.hue} style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      {/* who, and where it stands: the whole orb, its hat and all (10-07: the close-up cut its top off) */}
      <header style={{ ...card, gap: "var(--s3)", background: "linear-gradient(160deg, var(--accent-wash), var(--fill) 60%)" }}>
        {/* a phone: one centred column, the orb at its top (it sat alone at the left when the row wrapped, 10-07) */}
        <div data-career-head style={{ display: "flex", flexDirection: phone ? "column" : "row", gap: phone ? "var(--s2)" : "var(--s4)", alignItems: "center", textAlign: phone ? "center" : undefined, flexWrap: phone ? "nowrap" : "wrap", minWidth: 0 }}>
          <div data-career-portrait style={{ flex: "0 0 auto" }}>
            {/* the whole orb on its stage, its hat with it (a close-up cut the hat off, 10-07) */}
            <Orb character={orb} size={phone ? 120 : 136} poke={false} />
          </div>
          <div style={{ display: "grid", gap: 2, minWidth: 0, flex: phone ? "0 0 auto" : "1 1 200px", justifyItems: phone ? "center" : undefined }}>
            <h2 style={{ margin: 0, font: "800 26px/32px var(--font)", color: "var(--accent)" }}>{orb.name}</h2>
            <span style={{ font: "600 15px/20px var(--font)", color: "var(--text-1)" }}>{`${c.level} ${SPECIALTIES[orb.specialty].title}`}</span>
            <span data-tenure style={small}>{`Age ${span(c.born, c.now)} · ${c.left === null ? `${span(c.hired, c.now)} in the company` : `${span(c.hired, c.left)} in the company, then let go`}`}</span>
          </div>
          <div style={phone ? { display: "flex", alignItems: "baseline", gap: 8 } : { display: "grid", justifyItems: "end", gap: 2, flex: "0 0 auto" }}>
            <span data-level style={{ font: "800 22px/26px var(--font)", color: "var(--text-1)" }}>{`Lv. ${grown.level.level}`}</span>
            <span style={small}>{`${c.xp.toLocaleString("en-GB")} XP`}</span>
          </div>
        </div>
        {/* the ladder, Junior to Chief: where it is, and what the next rung asks */}
        <ol aria-label="The ladder" style={{ display: phone ? "grid" : "flex", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4, margin: 0, padding: 0, listStyle: "none", flexWrap: "wrap" }}>
          {LADDER.map((l, i) => (
            <li key={l} data-rung={l} aria-current={i === rung ? "step" : undefined} style={{ flex: "1 1 70px", textAlign: "center", padding: "6px 4px", borderRadius: 10, font: `${i === rung ? 800 : 600} 12px/16px var(--font)`, color: i <= rung ? "var(--text-1)" : "var(--text-3)", background: i === rung ? "var(--accent-fill)" : i < rung ? "var(--fill-2)" : "transparent", boxShadow: i === rung ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)" }}>
              {l}
            </li>
          ))}
        </ol>
        <div role="progressbar" aria-label={c.next ? `Toward ${c.next.to}` : "At the top"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(toNext * 100)} style={{ height: 8, borderRadius: 4, background: "var(--fill-2)", overflow: "hidden" }}>
          <i style={{ display: "block", height: "100%", width: `${toNext * 100}%`, background: "var(--accent)" }} />
        </div>
        <span style={small}>{c.next ? (c.next.ready ? `Ready for ${c.next.to}.` : `Toward ${c.next.to}: ${c.next.missing.join("; ")}.`) : "At the top of the ladder."}</span>
        {c.next?.ready && (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void home.promote(orb, c.next!.to).catch((e: Error) => setSaid(e.message))} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>Promote</button>
            <button type="button" onClick={() => void home.notYet(orb, c.next!.to).catch((e: Error) => setSaid(e.message))} style={button}>Not yet</button>
          </div>
        )}
      </header>

      {c.brand && <BrandCard brand={c.brand} name={orb.name} phone={phone} />}

      {/* what it wants most: the top of the office's XP table, and your approval */}
      {at >= 0 && (
        <Section title="In the office" label="The office by XP">
          <span data-ambition style={body}>{`${orb.name} wants to be the best orb in the office, not only the best ${SPECIALTIES[orb.specialty].title}: the most XP, and your approval.`}</span>
          <span data-standing style={{ font: "800 16px/22px var(--font)", color: "var(--text-1)" }}>
            {standing(board, at)}
          </span>
          {board.length > 1 && (
            <Tall max="30dvh" label="The office by XP, every orb">
            <ol aria-label="The office by XP" style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
              {board.map((r, i) => (
                <li key={r.orb} data-rank-orb={r.orb} aria-current={i === at ? "true" : undefined} style={{ display: "grid", gridTemplateColumns: "2ch minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
                  <b style={{ ...small, fontWeight: 800, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</b>
                  <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                    <span style={{ ...small, fontWeight: i === at ? 800 : 600, color: i === at ? "var(--accent)" : "var(--text-2)" }}>{r.name}</span>
                    <span style={{ display: "block", height: 6, borderRadius: 3, background: "var(--fill-2)", overflow: "hidden" }}>
                      <i style={{ display: "block", height: "100%", width: `${(r.xp / most) * 100}%`, background: i === at ? "var(--accent)" : "var(--text-3)", opacity: i === at ? 0.9 : 0.5 }} />
                    </span>
                  </span>
                  <span style={{ ...small, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{`${r.xp.toLocaleString("en-GB")} XP`}</span>
                </li>
              ))}
            </ol>
            </Tall>
          )}
        </Section>
      )}

      <div className="orbs-pair" style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
        <Section title={`${orb.name}'s traits`} label="Traits">
          {/* two across: seven bars under one another were most of a phone's screen */}
          <Balanced min={140} gap={10}>
          {grown.traits.map((t) => (
            <div key={t.name} data-trait={t.name} style={{ display: "grid", gap: 3, minWidth: 0 }}>
              <span style={{ ...small, color: "var(--text-2)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                {t.name}
                <b style={{ fontWeight: 700, color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>{t.value}</b>
              </span>
              <div style={{ height: 6, borderRadius: 3, background: "var(--fill-2)", overflow: "hidden" }}>
                <i style={{ display: "block", height: "100%", width: `${(t.value / peak) * 100}%`, background: "var(--accent)", opacity: 0.85 }} />
              </div>
            </div>
          ))}
          </Balanced>
          <span style={small}>{`${TOTAL} points for every orb, moved by what it is made of and by its work, one more each level.`}</span>
        </Section>
        <Section title={`What ${orb.name} does`}>
          <Radar items={areas.map(([name, a]) => ({ name: name === "desk" ? NAMES.dept.toLowerCase() : name, value: Math.round((a.xp / top) * 5) }))} />
          {areas.every(([, a]) => a.xp === 0) ? <span style={small}>Nothing yet: finished work you approve fills this in, by the kind of work it was.</span> : c.niches.length > 0 && <span style={small}>{`Its work leans on ${c.niches.map((n) => n.word).join(" · ")}.`}</span>}
        </Section>
      </div>

      <Section title="Lately" label="Its latest work">
        {c.work?.length ? (
          <Tall max="34dvh" label="Its latest work, every piece">
          <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
            {c.work.map((w) => (
              <li key={w.at} data-work style={{ display: "grid", gap: 1 }}>
                <span style={body}>{w.summary}</span>
                <span style={small}>{`${when(w.at)}${w.conversation?.startsWith("team:") ? " · in a session" : ""}`}</span>
              </li>
            ))}
          </ul>
          </Tall>
        ) : <span style={small}>Nothing finished yet.</span>}
      </Section>

      {/* its life with the others: who it gets on with, what they traded, what it learned from whom */}
      <Section title="With the others" label="With the others">
        {/* This whole history is one bounded scroll, on a desk as well as a phone: separate friend and meeting
            scrollers still let their combined card grow taller than the screen (owner, 10-10). */}
        <Tall max="48dvh" label="With the others, every friend, meeting and lesson" style={{ display: "grid", gap: 10, maxHeight: "48dvh", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", scrollbarWidth: "thin", scrollbarGutter: "stable", paddingRight: 8 }}>
        {c.friends?.length ? (
          // a balanced grid: never one friend alone on a row (a wrapping row left one at 768 px, 10-07)
          <Balanced min={170} gap={6}>
            {c.friends.map((f) => (
              <span key={f.name} data-friend={f.name} style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0, padding: "4px 10px", borderRadius: 999, background: "var(--fill-2)" }}>
                <b style={{ font: "700 13px/18px var(--font)", color: "var(--text-1)", flexShrink: 0 }}>{f.name}</b>
                <span style={{ ...small, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${f.word.toLowerCase()} · ${f.meetings} met`}</span>
              </span>
            ))}
          </Balanced>
        ) : <span style={small}>It has not met the others yet: free orbs meet through the office's day.</span>}
        {meetings.length > 0 && (
          <ul style={{ display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
            {meetings.map((m) => (
              <li key={m.at} data-meeting={m.kind} style={{ display: "grid", gap: 3, paddingLeft: 12, boxShadow: "inset 2px 0 0 var(--accent)" }}>
                <span style={body}>
                  {m.kind === "ideas" ? `Traded ideas with ${m.with} ${PLACE[m.place] ?? ""}` : m.kind === "game" ? `${m.won ? "Beat" : "Lost to"} ${m.with} ${PLACE[m.place] ?? ""}` : m.kind === "lesson" ? `A lesson with ${m.with}` : `Talked with ${m.with} ${PLACE[m.place] ?? ""}`}
                </span>
                {m.kind === "ideas" && (m.brought || m.heard) ? (
                  <>
                    {m.brought && <span data-brought style={small}>{`${orb.name} brought: ${m.brought}`}</span>}
                    {m.heard && <span data-heard style={small}>{`${m.with} brought: ${m.heard}`}</span>}
                  </>
                ) : m.kind === "ideas" ? <span style={small}>Their kinds of work, before either had finished any to talk about.</span> : null}
                <span style={small}>{`${when(m.at)} · ${m.delta > 0 ? `+${m.delta}` : m.delta} · now ${m.word.toLowerCase()}`}</span>
              </li>
            ))}
          </ul>
        )}
        {c.lessons?.length ? (
          <div style={{ display: "grid", gap: 4 }}>
            {c.lessons.map((l) => (
              <span key={`${l.at}${l.line}`} data-lesson={l.state} style={small}>{`${l.from} taught ${l.to}: "${l.line}" (${l.state === "waiting" ? "waiting for your yes" : l.state === "kept" ? "kept" : "not kept"})`}</span>
            ))}
          </div>
        ) : null}
        </Tall>
      </Section>

      <div className="orbs-pair" style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
        <Section title="Habits">
          {c.habits.length ? (
            <Tall max="30dvh" label="Its habits, every one">
              <div style={{ display: "grid", gap: 6 }}>
                {c.habits.map((h) => (
                  <span key={h.task} style={small}>{`${h.task.split("|").slice(1).join(" ")} (v${h.version})${h.shared ? `, from ${h.shared.from}` : ""}`}</span>
                ))}
              </div>
            </Tall>
          ) : <span style={small}>None yet: a job it does on a schedule, done the same way and approved three times, becomes one, night by night.</span>}
        </Section>
        <Section title="Reviews">
          <span style={small}>{`${c.reviews.given} given · ${c.reviews.received} asked of others`}</span>
          {c.performance && <span style={small}>{`This week: ${SUGGEST[c.performance.suggest] ?? c.performance.suggest}. ${c.performance.why}`}</span>}
        </Section>
      </div>
      {/* school (PLAN 5.7): its report card, when it has been */}
      <ReportCard home={home} orb={idOf(orb.name)} name={orb.name} />
      {said && <span role="status" style={small}>{said}</span>}
    </div>
  );
}
