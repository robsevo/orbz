// The game studio's room (owner, 10-18: "one of the rooms needs to be a gaming studio"; "make the game dev jobs and
// career paths more intricate. games will be huge, to industry standards"): the studio's own floor, and under it its
// team by discipline (each orb by its studio title, orb/careers.ts) and its careers (every job's ladder, Junior to
// director, what each rung owns, where it leads). `#/studio`, `#/studio/team`, `#/studio/careers`. Live by the home's
// events: its orbs' work and their promotions.
import { useEffect, useMemo, useRef, useState } from "react";
import { SPECIALTIES, type Character } from "../orb/spec.ts";
import { Orb } from "../orb/Orb.tsx";
import type { Mood } from "../orb/mood.ts";
import { idOf, type Office } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import { useCramped } from "../ui/fill.ts";
import { button, card, chip, head, small, strong, well } from "../desk/kit.ts";
import { ladderOf, movesOf, pathOf, PATHS, titleAt, TRACKS, type TrackId } from "../orb/careers.ts";
import { StudioFloor, type StudioEvent } from "./Floor.tsx";
import { podOf, PODS } from "./plan.ts";

const TABS = [["team", "Team"], ["careers", "Careers"]] as const;
type Tab = (typeof TABS)[number][0] | "floor";
/** Where each part of the studio is named on the Team tab, in its order. */
const PLACES: { id: ReturnType<typeof podOf>; name: string; hue: string }[] = [
  { id: "head", name: "Studio head", hue: "honey" },
  ...PODS.map((p) => ({ id: p.id, name: p.name, hue: p.hue })),
  { id: "audio", name: "Audio", hue: "violet" },
  { id: "qa", name: "Quality", hue: "teal" },
];
const isStudio = (c: Character): boolean => SPECIALTIES[c.specialty].family === "studio";
/** A job's focus as a sentence (spec.ts writes it as a phrase: "the player in code: ..."). */
const sentence = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
const an = (title: string): string => `${/^[AEIOU]/.test(title) ? "an" : "a"} ${title}`;

export function StudioRoom({ home, office, moods, go, tab: opening = null }: { home: Office | null; office: Character[]; moods: Record<string, Mood>; go: (r: Route) => void; tab?: string | null }) {
  const crew = useMemo(() => office.filter(isStudio), [office]);
  const phone = useCramped("(max-width: 760px)");
  const [tab, setTab] = useState<Tab | null>(opening === "team" || opening === "careers" ? opening : null);
  const shown: Tab = tab === "floor" && !phone ? "team" : tab ?? (phone ? "floor" : "team");
  const tabs: readonly (readonly [Tab, string])[] = phone ? [["floor", "Floor"], ...TABS] : TABS;
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [shipped, setShipped] = useState(0);
  const seq = useRef(0);
  const ids = useMemo(() => new Set(crew.map((c) => idOf(c.name))), [crew]);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.org().then((o) => setLevels(Object.fromEntries(o.orbs.map((x) => [x.id, x.level]))), () => {});
    load();
    return home.watch({
      event: (e) => {
        if (!e.orb || !ids.has(e.orb)) return;
        if (e.type === "orb.promoted") load();
        if (!/^(run\.started|run\.finished|card\.opened|orb\.promoted)$/.test(e.type)) return;
        const outcome = e.data?.outcome;
        if (e.type === "run.finished" && outcome === "ok") setShipped((n) => n + 1);
        setEvents((x) => [...x.slice(-40), { seq: ++seq.current, type: e.type, orb: e.orb!, outcome }]);
      },
    });
  }, [home, ids]);
  const levelOf = (c: Character): string => levels[idOf(c.name)] ?? "Junior";
  const working = crew.filter((c) => ["working", "thinking"].includes(moods[idOf(c.name)] ?? "idle")).length;
  const hasHead = crew.some((c) => c.specialty === "studiohead");
  const hire = (): void => go({ room: "recruiter", family: "studio" });

  const floor = <StudioFloor crew={crew} moods={moods} events={events} levels={levels} shipped={shipped} go={go} />;
  const empty = !crew.length && (
    <div data-studio-empty style={{ ...well, justifyItems: "start" }}>
      <span style={{ font: "700 15px/21px var(--font)", color: "var(--text-1)" }}>The studio is empty.</span>
      <span style={small}>Hire a Studio Head first: a department opens with its head. Then designers, programmers, artists, audio, producers, QA and live ops, each in its own place on the floor.</span>
      <button type="button" onClick={hire} style={strong}>Hire a Studio Head</button>
    </div>
  );
  return (
    <div data-studio-room style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: "var(--s3)", minWidth: 0 }}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span style={head}>Where the games are made</span>
          <h2 style={{ margin: 0, font: "800 26px/32px var(--font)", color: "var(--text-1)" }}>Game Studio</h2>
        </div>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "var(--s3)", minWidth: 0 }}>
          <span data-studio-status style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "700 12px/16px var(--font)", color: "var(--text-2)" }}>
            <i aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: working ? "var(--ok)" : "var(--text-3)" }} />
            {crew.length ? `${crew.length} on the team · ${working} at work` : "No one yet"}
          </span>
          {hasHead && <button type="button" data-studio-hire onClick={hire} style={button}>Hire</button>}
        </span>
      </div>
      {!phone && floor}
      {!phone && empty}
      <div data-studio-tabs style={{ minWidth: 0, ...(phone && { position: "sticky", top: 0, zIndex: 20, background: "var(--ground)", padding: "6px 0", margin: "-6px 0" }) }}>
        <OneLine gap={6}>
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={shown === k} data-studio-tab={k} onClick={() => setTab(k)} style={chip(shown === k)}>
              {label}
            </button>
          ))}
        </OneLine>
      </div>
      {shown === "floor" ? (
        <div style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
          {floor}
          {empty}
        </div>
      ) : shown === "team" ? (
        <Team crew={crew} levelOf={levelOf} moods={moods} go={go} hire={hasHead ? hire : null} />
      ) : (
        <Careers hire={hire} />
      )}
    </div>
  );
}

/** The team by where it sits: each orb by its studio title, pressed for its career page. */
function Team({ crew, levelOf, moods, go, hire }: { crew: Character[]; levelOf: (c: Character) => string; moods: Record<string, Mood>; go: (r: Route) => void; hire: (() => void) | null }) {
  if (!crew.length) return <p style={small}>No one in the studio yet.</p>;
  return (
    <div data-studio-team style={{ display: "grid", gap: "var(--s3)", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", alignItems: "start", minWidth: 0 }}>
      {PLACES.map((p) => {
        const here = crew.filter((c) => podOf(c.specialty) === p.id);
        if (!here.length) return null;
        return (
          <section key={p.id} data-team-place={p.id} data-orb={p.hue} aria-label={p.name} style={{ ...card, background: "linear-gradient(160deg, var(--accent-wash), var(--card) 55%)" }}>
            <span style={{ ...head, color: "var(--accent)" }}>{p.name}</span>
            <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
              {here.map((c) => {
                const m = moods[idOf(c.name)] ?? "idle";
                return (
                  <li key={c.name}>
                    <button type="button" data-team-orb={c.name} onClick={() => go({ room: "career", orb: c.name })} data-orb={c.hue}
                      style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto", gap: 10, alignItems: "center", width: "100%", textAlign: "left", border: 0, borderRadius: 12, padding: "4px 8px 4px 4px", background: "var(--fill)", cursor: "pointer", color: "var(--text-1)" }}>
                      <Orb character={c} size={44} still light={false} poke={false} />
                      <span style={{ display: "grid", minWidth: 0 }}>
                        <span style={{ font: "800 14px/20px var(--font)", color: "var(--accent)" }}>{c.name}</span>
                        <span data-studio-title style={{ font: "600 13px/18px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleAt(c.specialty, levelOf(c))}</span>
                      </span>
                      <i aria-label={m} style={{ width: 8, height: 8, borderRadius: "50%", background: m === "working" || m === "thinking" ? "var(--ok)" : m === "waiting" ? "var(--alert)" : "var(--text-3)" }} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {hire && (
        <section style={{ ...card, alignContent: "center", justifyItems: "start" }}>
          <span style={head}>Grow the studio</span>
          <span style={small}>Every studio job has its own place on the floor and its own ladder to director.</span>
          <button type="button" onClick={hire} style={strong}>See who applied</button>
        </section>
      )}
    </div>
  );
}

/** Every studio job's ladder: chosen by track, each rung's title and what it owns, and where the job leads. */
function Careers({ hire }: { hire: () => void }) {
  const [job, setJob] = useState<string>("gameplay");
  const tracks = useMemo(() => {
    const by = new Map<TrackId, string[]>();
    for (const [s, p] of Object.entries(PATHS)) by.set(p.track, [...(by.get(p.track) ?? []), s]);
    return [...by.entries()];
  }, []);
  const p = pathOf(job)!;
  const ladder = ladderOf(job)!;
  const moves = movesOf(job, "Senior");
  return (
    <div data-studio-careers style={{ display: "grid", gap: "var(--s4)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", alignItems: "start", minWidth: 0 }}>
      <section aria-label="Jobs" style={card}>
        <span style={head}>{`${Object.keys(PATHS).length} jobs, ${tracks.length} tracks`}</span>
        {tracks.map(([t, jobs]) => (
          <div key={t} style={{ display: "grid", gap: 6 }}>
            <span style={{ ...small, fontWeight: 700, color: "var(--text-2)" }}>{TRACKS[t].name}</span>
            <Balanced min={168} gap={6}>
              {jobs.map((s) => (
                <button key={s} type="button" data-career-job={s} aria-pressed={s === job} onClick={() => setJob(s)} style={chip(s === job)}>{SPECIALTIES[s as keyof typeof SPECIALTIES].title}</button>
              ))}
            </Balanced>
          </div>
        ))}
      </section>
      <section aria-label={`${SPECIALTIES[job as keyof typeof SPECIALTIES].title}: the ladder`} data-career-ladder={job} style={card}>
        <span style={head}>{`${TRACKS[p.track].name} · ${SPECIALTIES[job as keyof typeof SPECIALTIES].title}`}</span>
        <span style={small}>{sentence(SPECIALTIES[job as keyof typeof SPECIALTIES].focus)}</span>
        <ol style={{ display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
          {ladder.map((r, i) => (
            <li key={r.level} data-ladder-rung={r.level} style={{ display: "grid", gridTemplateColumns: "26px minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
              <b style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "50%", font: "800 12px/1 var(--font)", color: i === 5 ? "var(--ground)" : "var(--text-1)", background: i === 5 ? "var(--accent)" : "var(--fill-2)" }}>{i + 1}</b>
              <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
                  <span style={{ font: "800 14px/20px var(--font)", color: "var(--text-1)" }}>{r.title}</span>
                  <span style={{ ...small, fontWeight: 700 }}>{r.level}</span>
                </span>
                <span style={small}>{r.scope}</span>
              </span>
            </li>
          ))}
        </ol>
        <div style={{ display: "grid", gap: 6 }}>
          <span style={head}>Where it leads</span>
          <Balanced min={168} gap={6}>
            {moves.map((m) => (
              <button key={m.specialty} type="button" data-career-move={m.specialty} onClick={() => m.specialty in PATHS && setJob(m.specialty)} disabled={!(m.specialty in PATHS)} style={{ ...chip(false), cursor: m.specialty in PATHS ? "pointer" : "default" }}>{SPECIALTIES[m.specialty as keyof typeof SPECIALTIES].title}</button>
            ))}
          </Balanced>
        </div>
        <button type="button" onClick={hire} style={{ ...button, justifySelf: "start" }}>{`Hire ${an(SPECIALTIES[job as keyof typeof SPECIALTIES].title)}`}</button>
      </section>
    </div>
  );
}
