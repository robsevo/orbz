// The board's daily report (PLAN 5.18; owner, 10-07: "The board also sends you a status report every day about ideas
// they think are great for the startup to make money, news around the world, news around the office, if we feel like
// someones not a fit or if theyre doing good. best new candidates to hire for the day ... we need to know where the idea
// comes from too as well(which orb in the office, so they get xp if we approve it)"): `#/report`. The ideas first, each
// with the orb whose idea it is and what approving it gives that orb; then who to hire today (ranked by fit, orb/fit.ts,
// as the Recruiter ranks them), the people, the office, the world and the money. Earlier days a press away.
//
// Since 10-08 (PLAN 5.20; owner: "we have to keep in mind that the user may not have any money to start with. so ask how
// much they are willing to spend on infrastructure etc."; "Lets be able to change the budget as well"): the page asks
// what the company can spend until you have said, says what the ideas fit after, with Change; each idea says who pays,
// which orbs do it, the Founder's part, what it costs and the first step. Ideas that need the Founder to work, an
// outside hire, risky money, physical stock, a licence, or more than the budget are asked again, then left out.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import { applicant, SPECIALTIES, type Character } from "../orb/spec.ts";
import { fitOf, ranked } from "../orb/fit.ts";
import { idOf, type Office, type RecruiterState, type Report } from "../home/link.ts";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import type { Route } from "../ui/nav.ts";
import type { Person } from "../onboarding/story.ts";
import { BudgetChoice } from "../ui/Budget.tsx";
import { budgetWords, costWords, type Budget } from "../ui/budget.ts";

/** What an approved idea gives its orb (the home's gym/xp.ts XP.ideaApproved; test/report-view.test.ts holds them alike). */
export const IDEA_XP = 30;

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const panel: CSSProperties = { display: "grid", gap: 10, alignContent: "start", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0, height: "100%" };
const button: CSSProperties = { font: "700 13px/18px var(--font)", color: "var(--text-1)", background: "var(--card)", border: 0, borderRadius: 10, padding: "7px 12px", cursor: "pointer", boxShadow: "inset 0 0 0 1px var(--hairline)" };
const dayWords = (r: Report): string => new Date(r.at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const fact: CSSProperties = { font: "500 14px/20px var(--font)", color: "var(--text-2)", textWrap: "pretty", overflowWrap: "anywhere" };
const factHead: CSSProperties = { font: "700 11px/20px var(--font)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-3)", whiteSpace: "nowrap" };
const usd = (n: number): string => (n === 0 ? "nothing" : n < 0.01 ? "under a cent" : `$${n.toFixed(2)}`);
type Kind = keyof typeof SPECIALTIES;

export function ReportRoom({ home, office, go, person, keep }: { home: Office | null; office: Character[]; go: (r: Route) => void; person: Person | null; keep: (p: Person) => void }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [choosing, setChoosing] = useState(false); // Change, pressed: the budget's choices again
  const [hiring, setHiring] = useState<RecruiterState | null>(null);
  const [at, setAt] = useState(0); // which report, newest first
  const [said, setSaid] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.reports().then((r) => (setReports(r), setSaid(null), r.length && setAsking(false)), (e: Error) => setSaid(e.message));
    const hires = (): void => void home.recruiting().then(setHiring, () => setHiring(null));
    load();
    hires();
    return home.watch({ event: (e) => void (/^report\./.test(e.type) ? load() : /^(applicant|position)\./.test(e.type) && hires()) });
  }, [home]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>The board's report is the home's: open the app from your home to read it.</p>;
  if (!reports) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading the report…"}</p>;
  const face = (id: string | null): Character | undefined => (id ? office.find((c) => idOf(c.name) === id) : undefined);
  const r = reports[at] ?? null;
  const today = new Date().toDateString();
  const ask = (): void => {
    setAsking(true);
    void home.makeReport().catch((e: Error) => (setSaid(e.message), setAsking(false)));
  };
  const askButton = (r === null || new Date(reports[0]!.at).toDateString() !== today) && (
    <button data-make-report disabled={asking} onClick={ask} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", opacity: asking ? 0.6 : 1 }}>
      {asking ? "The board is writing it…" : "Ask for today's report"}
    </button>
  );
  const judge = (id: string, verdict: "approve" | "pass"): void => void home.judgeIdea(id, verdict).catch((e: Error) => setSaid(e.message));
  // what the company can spend: asked until you have said (the board takes it as nothing till then), then a line
  const budget = person?.budget ?? null;
  const pick = (b: Budget): void => {
    if (person) keep({ ...person, budget: b });
    setChoosing(false);
  };
  const company = person?.company ?? "your company";
  const who = (orb: string | null, name: string, size = 30): ReactNode => {
    const c = face(orb);
    return c ? <Orb character={c} size={size} poke={false} still /> : <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: "var(--card)" }} title={name} />;
  };

  // who to hire today: the report's applicants still applying, ranked by fit as the Recruiter ranks them
  const taken = (n: string): boolean => office.some((c) => c.name.toLowerCase() === n.toLowerCase());
  const best = r && hiring
    ? ranked(hiring.applicants.filter((a) => r.hiring.applicants.includes(a.id) && SPECIALTIES[a.specialty as Kind]).map((a) => ({ a, c: applicant(a.seed, a.specialty as Kind, taken) })), (x) => fitOf(x.c, office, x.a.startsAs)).slice(0, 3)
    : [];

  return (
    <div data-report-room style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: "var(--s3)" }}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <h2 style={{ margin: 0, font: "800 22px/28px var(--font)", color: "var(--text-1)" }}>The board's report</h2>
          <span style={small}>{r ? `${dayWords(r)} · from ${r.chair ? `${r.chair.name}, the Chairperson` : "the board"}` : "Every morning at 08:00, from the board"}</span>
        </div>
        {askButton}
      </div>
      {said && <p role="alert" style={{ ...small, margin: 0, color: "var(--alert)" }}>{said}</p>}
      {person && (!budget || choosing ? (
        <section aria-label="What the company can spend" data-report-budget={budget ? "change" : "ask"} style={{ ...panel, height: "auto" }}>
          <span style={head}>Budget</span>
          <span style={{ font: "700 16px/22px var(--font)", color: "var(--text-1)", textWrap: "balance" }}>{`What can ${company} spend, for hosting, tools and ads?`}</span>
          {!budget && <span style={small}>The board's ideas to make money fit what you say. Until you say, it takes it as nothing, and every idea starts free.</span>}
          <BudgetChoice value={budget} onPick={pick} />
        </section>
      ) : (
        <div data-report-budget="fits" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", minWidth: 0 }}>
          <span style={{ ...small, color: "var(--text-2)" }}>{`The board's ideas fit what ${company} can spend: ${budgetWords(budget)}.`}</span>
          <button data-budget-change onClick={() => setChoosing(true)} style={{ ...button, padding: "4px 10px" }}>Change</button>
        </div>
      ))}
      {reports.length > 1 && (
        <OneLine style={{ justifyContent: "flex-start" }} gap={6}>
          {reports.map((x, i) => (
            <button key={x.id} data-report-day={x.day} aria-pressed={i === at} onClick={() => setAt(i)}
              style={{ ...button, flex: "0 0 auto", fontWeight: 600, color: i === at ? "var(--text-1)" : "var(--text-3)", background: i === at ? "var(--accent-fill)" : "var(--fill)", boxShadow: i === at ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)" }}>
              {i === 0 ? "Latest" : new Date(x.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            </button>
          ))}
        </OneLine>
      )}
      {!r ? (
        <p style={{ ...small, margin: 0 }}>No report yet: the board sends its first at 08:00, or ask for one now.</p>
      ) : (
        <>
          {/* the ideas, each an orb's: approving one gives that orb XP */}
          <section aria-label="Ideas to make money" data-report-ideas style={{ ...panel, height: "auto" }}>
            <span style={head}>Ideas to make money</span>
            {!r.ideas.length && !r.left && <span style={small}>No ideas today: no brain answered the board. They come again tomorrow.</span>}
            {r.ideas.map((x) => (
              <article key={x.id} data-idea={x.id} data-idea-by={x.orb} data-verdict={x.verdict ?? "open"} data-orb={face(x.orb)?.hue}
                style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 12px", alignItems: "start", padding: "12px", borderRadius: 14, background: "var(--card)", boxShadow: x.verdict === "approved" ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--hairline)" }}>
                {who(x.orb, x.name, 40)}
                <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <span style={{ font: "800 14px/19px var(--font)", color: "var(--accent)" }}>
                    {x.name}
                    <span style={{ fontWeight: 600, color: "var(--text-3)" }}>{face(x.orb) ? ` · ${SPECIALTIES[face(x.orb)!.specialty].title}` : ""}</span>
                  </span>
                  <span style={{ font: "500 15px/21px var(--font)", color: "var(--text-1)", textWrap: "pretty" }}>{x.text}</span>
                  {/* a feasible pitch's facts: a label beside each, never in its line; old reports have fewer */}
                  {(x.who || x.does || x.yours || x.start !== undefined || x.first) && (
                    <span data-idea-facts style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "2px 10px", alignItems: "start" }}>
                      {x.who && <><span style={factHead}>Who pays</span><span data-idea-who style={fact}>{x.who}</span></>}
                      {x.does && <><span style={factHead}>Who does it</span><span data-idea-does style={fact}>{x.does}</span></>}
                      {x.yours && <><span style={factHead}>Your part</span><span data-idea-yours style={fact}>{x.yours}</span></>}
                      {x.start !== undefined && <><span style={factHead}>Costs</span><span data-idea-costs style={fact}>{costWords(x.start, x.month ?? 0)}</span></>}
                      {x.first && <><span style={factHead}>First step</span><span data-idea-first style={fact}>{x.first}</span></>}
                    </span>
                  )}
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {x.verdict === null ? (
                      <>
                        <button data-sound="pick" data-approve={x.id} onClick={() => judge(x.id, "approve")} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
                          {`Approve · +${IDEA_XP} XP to ${x.name}`}
                        </button>
                        <button data-pass={x.id} onClick={() => judge(x.id, "pass")} style={button}>Pass</button>
                      </>
                    ) : (
                      <span style={{ ...small, fontWeight: 700, color: x.verdict === "approved" ? "var(--accent)" : "var(--text-3)" }}>
                        {x.verdict === "approved" ? `Approved · ${x.name} earned ${IDEA_XP} XP, and the office works toward it` : "Passed"}
                      </span>
                    )}
                  </span>
                </span>
              </article>
            ))}
            {r.left ? (
              <span data-report-left style={small}>
                {r.left === 1 ? "1 idea was left out: it did not fit your budget, your office, or the work they can safely do." : `${r.left} ideas were left out: they did not fit your budget, your office, or the work they can safely do.`}
              </span>
            ) : null}
          </section>

          <Balanced min={300} gap={12}>
            <section aria-label="Hire today" data-report-hiring style={panel}>
              <span style={head}>Best to hire today</span>
              {!best.length && !r.hiring.returning.length && <span style={small}>{r.hiring.positions.length ? "No one new applied for your positions." : "You are not hiring: open a position in the Recruiter."}</span>}
              {best.map(({ item, fit }) => (
                <button key={item.a.id} data-best-hire={item.a.id} data-orb={item.c.hue} onClick={() => go({ room: "recruiter", family: SPECIALTIES[item.a.specialty as Kind].family })}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left", color: "inherit", minWidth: 0 }}>
                  <Orb character={item.c} size={34} poke={false} still />
                  <span style={{ display: "grid", minWidth: 0 }}>
                    <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)" }}>{`${item.c.name} · ${SPECIALTIES[item.a.specialty as Kind].title}`}</span>
                    <span style={{ ...small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`Fit ${fit.score} · ${fit.why[0] ?? ""}`}</span>
                  </span>
                </button>
              ))}
              {r.hiring.returning.map((x) => <span key={x.id} style={small}>{`${x.name} would come back as ${SPECIALTIES[x.specialty as Kind]?.title ?? x.specialty}`}</span>)}
            </section>

            <section aria-label="The people" data-report-people style={panel}>
              <span style={head}>The people</span>
              {!r.people.well.length && !r.people.fit.length && <span style={small}>Nothing to say yet: a week of work tells.</span>}
              {[...r.people.well.map((p) => ({ ...p, good: true })), ...r.people.fit.map((p) => ({ ...p, good: false }))].map((p) => (
                <button key={`${p.good}${p.orb}`} data-person={p.good ? "well" : "fit"} onClick={() => face(p.orb) && go({ room: "career", orb: face(p.orb)!.name })}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left", color: "inherit", minWidth: 0 }}>
                  {who(p.orb, p.name)}
                  <span style={{ display: "grid", minWidth: 0 }}>
                    <span style={{ font: "700 14px/19px var(--font)", color: p.good ? "var(--text-1)" : "var(--alert)" }}>{p.good ? `${p.name} is doing well` : `${p.name} may not be a fit`}</span>
                    <span style={small}>{p.why}</span>
                  </span>
                </button>
              ))}
            </section>

            <section aria-label="Around the office" data-report-office style={panel}>
              <span style={head}>Around the office</span>
              {!r.office.length && <span style={small}>A quiet day in the office.</span>}
              {r.office.slice(0, 8).map((x, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 8, font: "500 14px/19px var(--font)", color: "var(--text-2)", minWidth: 0 }}>
                  {x.orb ? who(x.orb, x.text, 22) : <span aria-hidden style={{ width: 22, textAlign: "center", color: "var(--accent)" }}>❖</span>}
                  <span style={{ minWidth: 0, textWrap: "pretty" }}>{x.text}</span>
                </span>
              ))}
            </section>

            <section aria-label="Around the world" data-report-world style={panel}>
              <span style={head}>Around the world</span>
              {!r.world.length && <span style={small}>Nothing new from the reading library. A research orb can follow a news site for you: ask one to.</span>}
              {r.world.map((x) => (
                <span key={x.url} style={{ display: "grid", minWidth: 0 }}>
                  <a href={x.url} target="_blank" rel="noreferrer noopener" style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", textDecoration: "none", overflowWrap: "anywhere" }}>{x.title}</a>
                  <span style={small}>{`${x.host} · found by ${x.name}`}</span>
                </span>
              ))}
            </section>

            <section aria-label="Money" data-report-money style={panel}>
              <span style={head}>{r.money.treasurer ? `Money · from ${r.money.treasurer}, the Treasurer` : "Money"}</span>
              <span style={{ font: "600 14px/19px var(--font)", color: "var(--text-2)" }}>{`The brain cost ${usd(r.money.yesterdayUsd)} yesterday, ${usd(r.money.weekUsd)} this week`}</span>
              {r.money.bills.length ? r.money.bills.map((b) => <span key={`${b.title}${b.due}`} style={small}>{`${b.title}${b.amount ? `, ${b.amount}` : ""}: due ${b.due.slice(0, 10)}`}</span>) : <span style={small}>No bills in the next week.</span>}
              {!r.money.treasurer && <span style={small}>A CFO would keep the books: hire one to open Finance.</span>}
            </section>
          </Balanced>
        </>
      )}
    </div>
  );
}
