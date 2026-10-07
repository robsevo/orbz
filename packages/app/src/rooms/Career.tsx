// An orb's career page (PLAN 5.6), all of it read off the home's log: who it is and where it stands on the
// ladder, its level and the XP to the next, its traits now and the radar of what it does, the work it
// finished lately, and its life with the others (owner, 10-07: "make the career section for orbs a little
// more intricate", "its where we see the orbs growth"): the friends it made, the meetings and the ideas
// traded in them (each orb's own latest work, by code), the lessons passed; then its habits, reviews, its
// weekly card and its report card. Promote and Not yet when it is ready: only you promote.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import { sheetOf, SPECIALTIES, type Character } from "../orb/spec.ts";
import { grownOf, TOTAL } from "../orb/dna.ts";
import { idOf, type CareerState, type Office } from "../home/link.ts";
import { span } from "../orb/age.ts";
import { Radar } from "../ui/Radar.tsx";
import { Balanced } from "../ui/Balanced.tsx";
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
const when = (at: number): string => new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Section({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} style={card}>
      <span style={head}>{title}</span>
      {children}
    </section>
  );
}

export function CareerRoom({ home, orb }: { home: Office | null; orb: Character }) {
  const [c, setC] = useState<CareerState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.career(orb).then(setC, (e: Error) => setSaid(e.message));
    load();
    // its work, its level, and its life with the others: a meeting, a friendship, a lesson
    return home.watch({ event: (e) => void ((e.orb === idOf(orb.name) || /^social\./.test(e.type)) && /^(xp\.|orb\.|promotion\.|habit\.|performance\.|board\.|run\.finished|social\.)/.test(e.type) && load()) });
  }, [home, orb.name]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>Careers are the home's: open the app from your home to see one.</p>;
  if (!c) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading…"}</p>;
  const sh = sheetOf(orb);
  const grown = grownOf(orb, sh.leans, c.radar, c.niches, sh.dna, c.xp);
  const areas = Object.entries(c.radar);
  const top = Math.max(1, ...areas.map(([, a]) => a.xp));
  const toNext = c.next ? Math.min(1, c.next.evidence.xp.has / Math.max(1, c.next.evidence.xp.needs)) : 1;
  const rung = LADDER.indexOf(c.level as (typeof LADDER)[number]);
  const peak = Math.max(...grown.traits.map((t) => t.value), TOTAL / 7);
  const meetings = c.meetings ?? [];
  return (
    <div data-career={idOf(orb.name)} data-orb={orb.hue} style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      {/* who, and where it stands: the whole orb, its hat and all (10-07: the close-up cut its top off) */}
      <header style={{ ...card, gap: "var(--s3)", background: "linear-gradient(160deg, var(--accent-wash), var(--fill) 60%)" }}>
        <div style={{ display: "flex", gap: "var(--s4)", alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <div data-career-portrait style={{ flex: "0 0 auto" }}>
            {/* the whole orb on its stage, its hat with it (a close-up cut the hat off, 10-07) */}
            <Orb character={orb} size={136} poke={false} />
          </div>
          <div style={{ display: "grid", gap: 2, minWidth: 0, flex: "1 1 200px" }}>
            <h2 style={{ margin: 0, font: "800 26px/32px var(--font)", color: "var(--accent)" }}>{orb.name}</h2>
            <span style={{ font: "600 15px/20px var(--font)", color: "var(--text-1)" }}>{`${c.level} ${SPECIALTIES[orb.specialty].title}`}</span>
            <span data-tenure style={small}>{`Age ${span(c.born, c.now)} · ${c.left === null ? `${span(c.hired, c.now)} in the company` : `${span(c.hired, c.left)} in the company, then let go`}`}</span>
          </div>
          <div style={{ display: "grid", justifyItems: "end", gap: 2, flex: "0 0 auto" }}>
            <span data-level style={{ font: "800 22px/26px var(--font)", color: "var(--text-1)" }}>{`Lv. ${grown.level.level}`}</span>
            <span style={small}>{`${c.xp.toLocaleString("en-GB")} XP`}</span>
          </div>
        </div>
        {/* the ladder, Junior to Chief: where it is, and what the next rung asks */}
        <ol aria-label="The ladder" style={{ display: "flex", gap: 4, margin: 0, padding: 0, listStyle: "none", flexWrap: "wrap" }}>
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

      <div className="orbs-pair" style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
        <Section title={`${orb.name}'s traits`} label="Traits">
          {grown.traits.map((t) => (
            <div key={t.name} data-trait={t.name} style={{ display: "grid", gap: 3 }}>
              <span style={{ ...small, color: "var(--text-2)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                {t.name}
                <b style={{ fontWeight: 700, color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>{t.value}</b>
              </span>
              <div style={{ height: 6, borderRadius: 3, background: "var(--fill-2)", overflow: "hidden" }}>
                <i style={{ display: "block", height: "100%", width: `${(t.value / peak) * 100}%`, background: "var(--accent)", opacity: 0.85 }} />
              </div>
            </div>
          ))}
          <span style={small}>{`${TOTAL} points for every orb, moved by what it is made of and by its work, one more each level.`}</span>
        </Section>
        <Section title={`What ${orb.name} does`}>
          <Radar items={areas.map(([name, a]) => ({ name, value: Math.round((a.xp / top) * 5) }))} />
          {areas.every(([, a]) => a.xp === 0) ? <span style={small}>Nothing yet: finished work you approve fills this in, by the kind of work it was.</span> : c.niches.length > 0 && <span style={small}>{`Its work leans on ${c.niches.map((n) => n.word).join(" · ")}.`}</span>}
        </Section>
      </div>

      <Section title="Lately" label="Its latest work">
        {c.work?.length ? (
          <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
            {c.work.map((w) => (
              <li key={w.at} data-work style={{ display: "grid", gap: 1 }}>
                <span style={body}>{w.summary}</span>
                <span style={small}>{`${when(w.at)}${w.conversation?.startsWith("team:") ? " · in a session" : ""}`}</span>
              </li>
            ))}
          </ul>
        ) : <span style={small}>Nothing finished yet.</span>}
      </Section>

      {/* its life with the others: who it gets on with, what they traded, what it learned from whom */}
      <Section title="With the others" label="With the others">
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
      </Section>

      <div className="orbs-pair" style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
        <Section title="Habits">
          {c.habits.length ? c.habits.map((h) => (
            <span key={h.task} style={small}>{`${h.task.split("|").slice(1).join(" ")} (v${h.version})${h.shared ? `, from ${h.shared.from}` : ""}`}</span>
          )) : <span style={small}>None yet: a job it does on a schedule, done the same way and approved three times, becomes one, night by night.</span>}
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
