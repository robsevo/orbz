// The game studio floor's drawings (studio/plan.ts has the plan): the room and everything fixed in it as one picture,
// and the pieces an orb can stand behind (each desk with its two screens, the gong) on their own, so the floor stacks
// them by how near they are. The office floor's way: the theme's surfaces and the orbs' hues through data-orb, never a
// colour named here. What the studio does shows: the build runs on the wall's big screen, the milestone board fills with
// cards as the studio works, every desk's screens show its discipline's work (a blockout for design, code for code, a
// canvas for art, a schedule for production, a waveform in the booth, a test pass on the QA bench), in its orb's hue.
import type { CSSProperties, ReactNode } from "react";
import type { HueName } from "../design/tokens.ts";
import type { OrbHue } from "../orb/spec.ts";
import { Clock, Plant, Window, type Sky } from "../floor/art.tsx";
import { AREAS, areaOf, H, LOW, PODS, SPIECES, TOP, W, WALL, type SDesk } from "./plan.ts";

const f = (v: string): CSSProperties => ({ fill: `var(--${v})` });
const st = (v: string, w = 1): CSSProperties => ({ stroke: `var(--${v})`, strokeWidth: w, fill: "none" });
const Hue = ({ hue, children }: { hue: HueName; children: ReactNode }) => <g data-orb={hue}>{children}</g>;

/** The build on the wall's big screen: a level of the game being made, its hero mid-jump, coins, a foe, the HUD. */
function Build({ x, y, w, h, frame }: { x: number; y: number; w: number; h: number; frame: number }) {
  const ground = y + h - 10;
  const hop = Math.abs(Math.sin(frame / 3)) * 10;
  return (
    <g data-build>
      <rect x={x} y={y} width={w} height={h} rx={3} style={f("ground")} />
      <Hue hue="cornflower">
        <rect x={x} y={y} width={w} height={h} rx={3} style={f("accent-wash")} />
      </Hue>
      {/* far hills, then the ground and two platforms */}
      <Hue hue="clover">
        <path d={`M${x} ${ground - 8} q${w * 0.12} -22 ${w * 0.25} 0 t${w * 0.25} 0 t${w * 0.25} 0 t${w * 0.25} 0 V${ground} H${x} Z`} style={f("accent-fill")} />
        <rect x={x} y={ground} width={w} height={10} style={f("accent")} opacity={0.8} />
        <rect x={x + w * 0.3} y={ground - 22} width={w * 0.16} height={6} rx={2} style={f("accent")} />
        <rect x={x + w * 0.62} y={ground - 34} width={w * 0.14} height={6} rx={2} style={f("accent")} />
      </Hue>
      <Hue hue="honey">
        {[0.34, 0.38, 0.42, 0.66, 0.7].map((at, i) => (
          <circle key={i} cx={x + w * at} cy={ground - (at > 0.6 ? 44 : 32)} r={2.6} style={f("accent")} className={i % 2 ? "orbs-floor-blink" : undefined} />
        ))}
      </Hue>
      {/* the hero, mid-jump, and a foe pacing the far platform */}
      <Hue hue="azure">
        <ellipse cx={x + w * 0.18} cy={ground - 9 - hop} rx={7} ry={8.5} style={f("accent")} />
        <circle cx={x + w * 0.18 + 2.5} cy={ground - 11 - hop} r={1.4} style={f("ground")} />
      </Hue>
      <Hue hue="coral">
        <rect x={x + w * 0.66} y={ground - 44} width={10} height={9} rx={4} style={f("accent")} />
      </Hue>
      {/* the HUD: three hearts, a score */}
      <Hue hue="rose">
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M${x + 10 + i * 12} ${y + 10} l3 -3 a2 2 0 0 1 3 3 l-6 6 l-6 -6 a2 2 0 0 1 3 -3 Z`} transform={`translate(3 1)`} style={f("accent")} />
        ))}
      </Hue>
      <rect x={x + w - 46} y={y + 6} width={38} height={6} rx={2} style={f("text-1")} opacity={0.8} />
    </g>
  );
}

/** The milestone board: three columns, to do, doing, done, each card a piece of the game in a discipline's colour. */
function Milestones({ x, y, w, h, todo, doing, done }: { x: number; y: number; w: number; h: number; todo: number; doing: number; done: number }) {
  const col = (w - 16) / 3;
  const hues: HueName[] = ["iris", "cornflower", "coral", "amber", "violet", "teal"];
  return (
    <g data-milestones>
      <rect x={x} y={y} width={w} height={h} rx={4} style={f("raised")} />
      {[todo, doing, done].map((n, c) => (
        <g key={c}>
          <rect x={x + 4 + c * (col + 4)} y={y + 4} width={col} height={6} rx={2} style={f(c === 2 ? "ok" : "text-3")} opacity={0.8} />
          {Array.from({ length: Math.min(8, n) }, (_, i) => (
            <Hue key={i} hue={hues[(i + c * 2) % hues.length]!}>
              <rect x={x + 6 + c * (col + 4) + (i % 2) * (col / 2 - 1)} y={y + 14 + Math.floor(i / 2) * 12} width={col / 2 - 4} height={9} rx={1.5} style={f("accent")} opacity={c === 2 ? 0.55 : 0.9} />
            </Hue>
          ))}
        </g>
      ))}
    </g>
  );
}

/** Everything fixed: the floor and the pods' rugs, the wall with the build and the milestones, the three rooms at the
 * back (the booth, the stage, the lounge), the head's office, the QA lab and the arcade. */
export function Backdrop({ now, sky, frame, todo, doing, done, bugs, shipped }: {
  now: Date; sky: Sky; frame: number; todo: number; doing: number; done: number; bugs: number; shipped: number;
}) {
  const audio = areaOf("audio").rect;
  const play = areaOf("playtest").rect;
  const { booth, speakerL, rack, camA, camB, camC, tv, couch, beanbag, headDesk, awards, bugs: bugBoard, cabA, cabB, pinball, snacks } = SPIECES;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" aria-hidden style={{ position: "absolute", inset: 0, display: "block" }}>
      <defs>
        <pattern id="orbs-studio-tiles" width={40} height={40} patternUnits="userSpaceOnUse">
          <rect width={40} height={40} style={f("floor")} />
          <path d="M40 0 H0 V40" style={st("sep", 1.2)} />
        </pattern>
        <pattern id="orbs-studio-foam" width={14} height={14} patternUnits="userSpaceOnUse">
          <rect width={14} height={14} style={f("trim")} />
          <path d="M0 14 L7 0 L14 14 Z" style={f("wall")} opacity={0.6} />
        </pattern>
        <pattern id="orbs-studio-grid" width={20} height={20} patternUnits="userSpaceOnUse">
          <path d="M20 0 H0 V20" style={st("hairline", 1)} />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#orbs-studio-tiles)" />
      {/* each pod's rug, in its discipline's hue */}
      {PODS.map((p) => (
        <Hue key={p.id} hue={p.hue}>
          <rect x={p.x + 16} y={376} width={268} height={386} rx={18} style={f("accent-wash")} opacity={0.7} />
          <rect x={p.x + 16} y={376} width={268} height={386} rx={18} style={st("accent-fill", 2.5)} />
        </Hue>
      ))}
      {/* the corridor and the hallway: a runner each */}
      {[300, 780].map((y) => (
        <rect key={y} x={40} y={y + 12} width={W - 80} height={28} rx={8} style={f("fill")} />
      ))}

      {/* the back wall: the city, the clock, the build on the big screen, the milestone board */}
      <rect width={W} height={WALL} style={f("wall")} />
      <rect y={WALL - 6} width={W} height={10} style={f("trim")} />
      <Window x={24} y={14} w={150} h={52} sky={sky} />
      <Clock x={210} y={40} now={now} />
      <rect x={246} y={6} width={468} height={70} rx={6} style={f("ground")} />
      <Build x={252} y={12} w={456} h={58} frame={frame} />
      <circle cx={706} cy={14} r={2.6} style={f("off")} className="orbs-floor-blink" />
      <Milestones x={732} y={8} w={236} h={66} todo={todo} doing={doing} done={done} />
      <Window x={986} y={14} w={190} h={52} sky={sky} />

      {/* the walls between the back rooms, and their front walls with a door each */}
      {[392, 796].map((x) => (
        <rect key={x} x={x} y={WALL} width={12} height={TOP - WALL} style={f("wall")} />
      ))}
      {AREAS.filter((a) => a.door).map((a) => {
        const y = a.rect.y === WALL ? 288 : LOW - 4;
        return [
          { x: a.rect.x, w: a.door!.x - a.rect.x },
          { x: a.door!.x + a.door!.w, w: a.rect.x + a.rect.w - a.door!.x - a.door!.w },
        ].map((p, i) => (
          <g key={`${a.id}${i}`}>
            <rect x={p.x} y={y} width={p.w} height={14} rx={3} style={f("wall")} />
            <rect x={p.x} y={y} width={p.w} height={4} rx={2} style={f("fill-2")} />
          </g>
        ));
      })}
      {[392, 796].map((x) => (
        <rect key={`l${x}`} x={x} y={LOW} width={12} height={H - LOW} style={f("wall")} />
      ))}
      <rect y={H - 8} width={W} height={8} style={f("wall")} />

      {/* on the corridor's side of the front walls: the build on a screen, the concept wall, the milestone cards */}
      <rect x={250} y={304} width={100} height={22} rx={3} style={f("ground")} />
      <Hue hue="cornflower">
        <rect x={253} y={307} width={94} height={16} rx={2} style={f("accent-wash")} />
        <circle cx={268} cy={318} r={4} style={f("accent")} />
      </Hue>
      {[0, 1, 2, 3].map((i) => (
        <Hue key={i} hue={(["coral", "apricot", "rose", "plum"] as HueName[])[i]!}>
          <rect x={676 + i * 23} y={305 + (i % 2) * 2} width={19} height={18} rx={1.5} style={f("accent-wash")} transform={`rotate(${(i % 2 ? 4 : -3)} ${686 + i * 23} 314)`} />
          <path d={`M${680 + i * 23} ${319} q5 -9 10 -2 t6 -3`} style={st("accent", 1.4)} />
        </Hue>
      ))}
      <rect x={1058} y={304} width={112} height={22} rx={3} style={f("raised")} />
      {Array.from({ length: 6 }, (_, i) => (
        <Hue key={i} hue={(["iris", "amber", "mint"] as HueName[])[i % 3]!}>
          <rect x={1064 + i * 17} y={309} width={13} height={12} rx={1.5} style={f("accent")} opacity={0.85} />
        </Hue>
      ))}

      {/* the audio booth: foam on its walls, the vocal booth (glass, a mic inside), a speaker, the mixing desk's lamp */}
      <rect x={audio.x} y={WALL} width={audio.w} height={52} fill="url(#orbs-studio-foam)" opacity={0.8} />
      <Hue hue="violet">
        <rect x={audio.x} y={WALL} width={audio.w} height={TOP - WALL} style={f("accent-wash")} opacity={0.35} />
        <rect x={booth.x} y={booth.y - 20} width={booth.w} height={booth.h + 20} rx={6} style={f("accent-wash")} />
        <rect x={booth.x} y={booth.y - 20} width={booth.w} height={booth.h + 20} rx={6} style={st("accent-fill", 2)} />
      </Hue>
      <line x1={booth.x + booth.w / 2} x2={booth.x + booth.w / 2} y1={booth.y + 30} y2={booth.y + booth.h - 6} style={st("text-3", 2)} />
      <rect x={booth.x + booth.w / 2 - 6} y={booth.y + 16} width={12} height={18} rx={6} style={f("text-2")} />
      <circle cx={booth.x + booth.w / 2} cy={booth.y + 25} r={9} style={st("text-3", 1.5)} />
      <rect x={booth.x + 10} y={booth.y - 12} width={18} height={7} rx={2} style={f("off")} className="orbs-floor-glow" />
      <rect x={speakerL.x} y={speakerL.y - 20} width={speakerL.w} height={speakerL.h + 20} rx={3} style={f("text-3")} />
      {[0, 1].map((i) => (
        <circle key={i} cx={speakerL.x + speakerL.w / 2} cy={speakerL.y - 8 + i * 24} r={i ? 7 : 4} style={f("ground")} />
      ))}
      <rect x={58} y={WALL + 58} width={200} height={34} rx={4} style={f("ground")} />
      <Hue hue="violet">
        <path d={Array.from({ length: 48 }, (_, i) => `${i ? "L" : "M"}${62 + i * 4} ${WALL + 75 - Math.sin(i * 0.9 + frame * 0.5) * (4 + (i * 7) % 9)}`).join(" ")} style={st("accent", 1.5)} />
      </Hue>

      {/* the mocap stage: its taped floor, three cameras on their poles, the suits on their rack */}
      <Hue hue="cyan">
        <rect x={470} y={110} width={260} height={140} rx={6} style={f("accent-wash")} />
        <rect x={470} y={110} width={260} height={140} rx={6} fill="url(#orbs-studio-grid)" />
        <rect x={470} y={110} width={260} height={140} rx={6} style={st("accent", 2)} strokeDasharray="10 6" />
        <circle cx={600} cy={180} r={30} style={st("accent-fill", 2)} />
      </Hue>
      {[camA, camB, camC].map((c, i) => (
        <g key={i}>
          <rect x={c.x + 3} y={c.y - 26} width={4} height={30} style={f("text-3")} />
          <rect x={c.x - 4} y={c.y - 34} width={18} height={11} rx={2} style={f("text-2")} />
          <circle cx={c.x + (c.x < 600 ? 14 : -4)} cy={c.y - 28} r={2.4} style={f("off")} className="orbs-floor-blink" />
        </g>
      ))}
      <rect x={rack.x} y={rack.y - 24} width={rack.w} height={rack.h + 24} rx={3} style={f("wood")} />
      {[0, 1].map((i) => (
        <g key={i}>
          <rect x={rack.x + 4 + i * 15} y={rack.y - 16} width={12} height={46} rx={5} style={f("text-1")} opacity={0.82} />
          {[0, 1, 2].map((k) => <circle key={k} cx={rack.x + 10 + i * 15} cy={rack.y - 8 + k * 14} r={1.6} style={f("ground")} />)}
        </g>
      ))}

      {/* the playtest lounge: the TV with a match on it, the couch, a beanbag, controllers */}
      <Hue hue="pink">
        <rect x={play.x} y={WALL} width={play.w} height={TOP - WALL} style={f("accent-wash")} opacity={0.35} />
      </Hue>
      <rect x={tv.x} y={tv.y - 6} width={tv.w} height={tv.h + 6} rx={5} style={f("text-3")} />
      <rect x={tv.x + 5} y={tv.y - 1} width={tv.w - 10} height={tv.h - 4} rx={2} style={f("ground")} />
      <Hue hue="pink">
        <rect x={tv.x + 5} y={tv.y - 1} width={(tv.w - 10) / 2 - 1} height={tv.h - 4} style={f("accent-wash")} />
        <path d={`M${tv.x + 12} ${tv.y + 40} q20 -26 50 -8`} style={st("accent", 2.5)} />
      </Hue>
      <Hue hue="cyan">
        <rect x={tv.x + tv.w / 2 + 1} y={tv.y - 1} width={(tv.w - 10) / 2 - 1} height={tv.h - 4} style={f("accent-wash")} />
        <path d={`M${tv.x + tv.w / 2 + 8} ${tv.y + 18} q24 30 52 6`} style={st("accent", 2.5)} />
      </Hue>
      <Hue hue="pink">
        <rect x={couch.x} y={couch.y - 16} width={couch.w} height={26} rx={10} style={f("accent")} opacity={0.75} />
        <rect x={couch.x - 8} y={couch.y - 4} width={16} height={couch.h} rx={6} style={f("accent")} />
        <rect x={couch.x + couch.w - 8} y={couch.y - 4} width={16} height={couch.h} rx={6} style={f("accent")} />
        <rect x={couch.x + 8} y={couch.y + 8} width={couch.w - 16} height={couch.h - 12} rx={6} style={f("accent-fill")} />
      </Hue>
      {[0, 1].map((i) => (
        <rect key={i} x={couch.x + 50 + i * 64} y={couch.y + 14} width={18} height={9} rx={4} style={f("text-2")} />
      ))}
      <Hue hue="lavender">
        <ellipse cx={beanbag.x + beanbag.w / 2} cy={beanbag.y + beanbag.h / 2} rx={beanbag.w / 2 + 2} ry={beanbag.h / 2 + 4} style={f("accent")} opacity={0.85} />
      </Hue>
      <Plant x={play.x + 30} y={276} s={0.9} hue="jade" />

      {/* the head's office: the awards on their shelf, the game's key art framed, its desk */}
      <Hue hue="honey">
        <rect x={0} y={LOW} width={392} height={H - LOW} style={f("accent-wash")} opacity={0.5} />
      </Hue>
      <rect x={awards.x} y={awards.y - 24} width={awards.w} height={awards.h + 24} rx={4} style={f("wood")} />
      {Array.from({ length: Math.min(5, 1 + shipped) }, (_, i) => (
        <Hue key={i} hue={i % 2 ? "marigold" : "honey"}>
          <path d={`M${awards.x + 12 + i * 22} ${awards.y - 16} h12 l-2 9 h-8 Z`} style={f("accent")} />
          <rect x={awards.x + 15 + i * 22} y={awards.y - 7} width={6} height={6} style={f("accent")} />
          <rect x={awards.x + 12 + i * 22} y={awards.y - 1} width={12} height={4} rx={1} style={f("accent")} />
        </Hue>
      ))}
      <rect x={176} y={LOW + 18} width={84} height={52} rx={3} style={f("trim")} />
      <rect x={180} y={LOW + 22} width={76} height={44} rx={2} style={f("ground")} />
      <Hue hue="azure">
        <ellipse cx={218} cy={LOW + 48} rx={13} ry={15} style={f("accent")} />
      </Hue>
      <Hue hue="clover">
        <rect x={180} y={LOW + 58} width={76} height={8} style={f("accent")} opacity={0.8} />
      </Hue>
      <rect x={headDesk.x} y={headDesk.y} width={headDesk.w} height={headDesk.h - 10} rx={6} style={f("wood")} />
      <rect x={headDesk.x} y={headDesk.y + headDesk.h - 12} width={headDesk.w} height={12} rx={4} style={f("wood")} opacity={0.82} />
      <rect x={headDesk.x + 20} y={headDesk.y - 30} width={44} height={30} rx={3} style={f("ground")} />
      <Hue hue="honey">
        {[0, 1, 2].map((i) => <rect key={i} x={headDesk.x + 24} y={headDesk.y - 25 + i * 8} width={[30, 22, 34][i]} height={4} rx={1.5} style={f("accent")} opacity={0.85} />)}
      </Hue>
      <Plant x={362} y={LOW + 200} s={0.95} />

      {/* the QA lab: the bug board (as many bugs as are open), the devkits' rack */}
      <Hue hue="teal">
        <rect x={404} y={LOW} width={392} height={H - LOW} style={f("accent-wash")} opacity={0.45} />
      </Hue>
      <rect x={bugBoard.x} y={bugBoard.y - 24} width={bugBoard.w} height={bugBoard.h + 24} rx={4} style={f("raised")} />
      <rect x={bugBoard.x + 6} y={bugBoard.y - 18} width={30} height={5} rx={2} style={f("text-3")} />
      {Array.from({ length: Math.min(12, bugs) }, (_, i) => (
        <g key={i} transform={`translate(${bugBoard.x + 10 + (i % 6) * 13} ${bugBoard.y - 6 + Math.floor(i / 6) * 13})`}>
          <ellipse rx={4} ry={3.2} style={f(i % 4 === 0 ? "off" : i % 4 === 1 ? "alert" : "ok")} />
          <path d="M-5 -2 l2 1 M-5 2 l2 -1 M5 -2 l-2 1 M5 2 l-2 -1" style={st("text-2", 0.8)} />
        </g>
      ))}
      <rect x={430} y={LOW + 20} width={56} height={56} rx={4} style={f("text-3")} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={434} y={LOW + 24 + i * 13} width={48} height={10} rx={2} style={f("ground")} />
          <circle cx={476} cy={LOW + 29 + i * 13} r={1.8} style={f(i === 2 ? "off" : "ok")} className={i === 1 ? "orbs-floor-blink" : undefined} />
        </g>
      ))}
      <Plant x={770} y={LOW + 200} s={0.9} hue="clover" />

      {/* the arcade: two cabinets, the pinball, the snacks, its neon */}
      <Hue hue="lime">
        <rect x={808} y={LOW} width={392} height={H - LOW} style={f("accent-wash")} opacity={0.35} />
      </Hue>
      {[cabA, cabB].map((c, i) => (
        <g key={i}>
          <rect x={c.x} y={c.y - 30} width={c.w} height={c.h + 30} rx={5} style={f("text-3")} />
          <rect x={c.x + 5} y={c.y - 24} width={c.w - 10} height={30} rx={2} style={f("ground")} />
          <Hue hue={i ? "orchid" : "cyan"}>
            <rect x={c.x + 5} y={c.y - 24} width={c.w - 10} height={30} rx={2} style={f("accent-wash")} />
            <rect x={c.x + 12} y={c.y - 14} width={8} height={8} rx={1} style={f("accent")} className="orbs-floor-blink" />
            <rect x={c.x + 24} y={c.y - 8} width={10} height={4} rx={1} style={f("accent")} />
          </Hue>
          <rect x={c.x + 4} y={c.y + 12} width={c.w - 8} height={14} rx={3} style={f("raised")} />
          <circle cx={c.x + 14} cy={c.y + 19} r={3} style={f("off")} />
          <circle cx={c.x + 28} cy={c.y + 19} r={2.4} style={f("ok")} />
        </g>
      ))}
      <rect x={pinball.x} y={pinball.y - 26} width={pinball.w} height={26} rx={4} style={f("text-3")} />
      <rect x={pinball.x} y={pinball.y} width={pinball.w} height={pinball.h} rx={6} style={f("wood")} />
      <rect x={pinball.x + 5} y={pinball.y + 5} width={pinball.w - 10} height={pinball.h - 14} rx={4} style={f("ground")} />
      <Hue hue="pink">
        {[[14, 18], [34, 24], [24, 36]].map(([dx, dy], i) => (
          <circle key={i} cx={pinball.x + dx!} cy={pinball.y + dy!} r={4.5} style={f("accent")} className="orbs-floor-glow" />
        ))}
      </Hue>
      <circle cx={pinball.x + 22} cy={pinball.y + 48} r={2.5} style={f("text-1")} />
      <rect x={snacks.x} y={snacks.y - 30} width={snacks.w} height={snacks.h + 30} rx={6} style={f("raised")} />
      <rect x={snacks.x + 5} y={snacks.y - 24} width={snacks.w - 20} height={snacks.h + 14} rx={3} style={f("ground")} opacity={0.6} />
      {Array.from({ length: 12 }, (_, i) => (
        <Hue key={i} hue={(["marigold", "coral", "lime", "cornflower"] as HueName[])[i % 4]!}>
          <rect x={snacks.x + 9 + (i % 3) * 13} y={snacks.y - 18 + Math.floor(i / 3) * 21} width={9} height={14} rx={2} style={f("accent")} />
        </Hue>
      ))}
      <Hue hue="lime">
        <text x={1061} y={LOW + 52} textAnchor="middle" style={{ ...f("accent"), font: "900 22px var(--font)", letterSpacing: ".18em" }} className="orbs-floor-glow">GG</text>
      </Hue>
      {/* the plants of the pods */}
      <Plant x={22} y={760} s={1.05} hue="leaf" />
      <Plant x={W - 22} y={760} s={1.05} hue="clover" />
    </svg>
  );
}

/** A piece drawn on its own, its box on the plan, a little taller for what stands on it. */
function Piece({ x, y, w, h, up = 0, children }: { x: number; y: number; w: number; h: number; up?: number; children: ReactNode }) {
  return (
    <svg aria-hidden viewBox={`${x - 6} ${y - up} ${w + 12} ${h + up + 6}`}
      style={{ position: "absolute", left: `${((x - 6) / W) * 100}%`, top: `${((y - up) / H) * 100}%`, width: `${((w + 12) / W) * 100}%`, height: `${((h + up + 6) / H) * 100}%`, zIndex: y + h, pointerEvents: "none", overflow: "visible" }}>
      {children}
    </svg>
  );
}

/** What a screen shows, by where its desk is: each discipline's own work, in its orb's hue. */
function Screen({ x, y, w, pod, k, hue, working }: { x: number; y: number; w: number; pod: SDesk["pod"]; k: number; hue: OrbHue | null; working: boolean }) {
  const h = 30;
  const type = working ? "orbs-floor-type" : undefined;
  const inner = (() => {
    if (!hue) return null;
    switch (pod) {
      case "design":
        // a level's blockout from above, and its flow
        return k ? (
          <g>{[0, 1, 2].map((i) => <rect key={i} x={x + 6 + i * 13} y={y + 8 + (i % 2) * 8} width={9} height={7} rx={1.5} style={f("accent")} className={type} />)}<path d={`M${x + 15} ${y + 12} h4 M${x + 28} ${y + 20} h4`} style={st("text-2", 1)} /></g>
        ) : (
          <g><rect x={x + 5} y={y + 5} width={w - 10} height={h - 10} fill="url(#orbs-studio-grid)" /><path d={`M${x + 8} ${y + 22} h10 v-10 h12 v6 h10`} style={st("accent", 2.4)} className={type} /></g>
        );
      case "code":
        // code, and the game running in its viewport
        return k ? (
          <g><rect x={x + 5} y={y + 5} width={w - 10} height={h - 10} rx={1} style={f("accent-wash")} /><circle cx={x + w / 2} cy={y + h / 2 + 2} r={5} style={f("accent")} className={type} /><rect x={x + 5} y={y + h - 9} width={w - 10} height={3} style={f("ok")} opacity={0.7} /></g>
        ) : (
          <g>{[0, 1, 2, 3].map((i) => <rect key={i} x={x + 6 + (i % 2) * 6} y={y + 6 + i * 5} width={[22, 16, 26, 12][i]} height={2.6} rx={1} style={f(i === 2 ? "accent" : "text-2")} opacity={0.85} className={i === 3 ? type : undefined} />)}</g>
        );
      case "art":
        // a character on the canvas, and the palette
        return k ? (
          <g>{[0, 1, 2, 3].map((i) => <rect key={i} x={x + 6 + i * 9} y={y + 10} width={7} height={10} rx={1.5} style={f(i === 0 ? "accent" : i === 1 ? "accent-fill" : i === 2 ? "text-2" : "text-3")} />)}</g>
        ) : (
          <g><ellipse cx={x + w / 2} cy={y + 16} rx={7} ry={9} style={f("accent")} className={type} /><path d={`M${x + w / 2 - 12} ${y + 26} q12 -6 24 0`} style={st("text-2", 1.2)} /></g>
        );
      case "production":
        // the schedule's bars, and the burndown
        return k ? (
          <g><path d={`M${x + 6} ${y + 8} L${x + w - 8} ${y + h - 8}`} style={st("text-3", 1)} strokeDasharray="3 2" /><path d={`M${x + 6} ${y + 8} l8 3 l8 6 l8 1 l8 6`} style={st("accent", 2)} className={type} /></g>
        ) : (
          <g>{[0, 1, 2, 3].map((i) => <rect key={i} x={x + 6 + i * 5} y={y + 6 + i * 5} width={[16, 20, 12, 18][i]} height={3.4} rx={1} style={f(i % 2 ? "accent" : "accent-fill")} className={i === 1 ? type : undefined} />)}</g>
        );
      case "audio":
        // a waveform, and the faders
        return k ? (
          <g>{[0, 1, 2, 3, 4].map((i) => <g key={i}><line x1={x + 8 + i * 8} x2={x + 8 + i * 8} y1={y + 6} y2={y + 24} style={st("text-3", 1)} /><rect x={x + 5 + i * 8} y={y + 8 + ((i * 7) % 12)} width={6} height={4} rx={1} style={f("accent")} className={i === 2 ? type : undefined} /></g>)}</g>
        ) : (
          <path d={Array.from({ length: 12 }, (_, i) => `${i ? "L" : "M"}${x + 5 + i * 4} ${y + 15 + (i % 2 ? -1 : 1) * ((i * 5) % 9)}`).join(" ")} style={st("accent", 1.6)} className={type} />
        );
      case "qa":
        // the test pass: ticks, one failure
        return (
          <g>{[0, 1, 2].map((i) => <g key={i}><path d={`M${x + 7} ${y + 9 + i * 7} l2 2 l4 -4`} style={st(i === 1 && k ? "off" : "ok", 1.6)} /><rect x={x + 17} y={y + 8 + i * 7} width={w - 26} height={3} rx={1} style={f("text-2")} opacity={0.7} /></g>)}</g>
        );
    }
  })();
  return (
    <g>
      <rect x={x + w / 2 - 2} y={y + h} width={4} height={8} style={f("ground")} />
      <rect x={x} y={y} width={w} height={h} rx={3} style={f("ground")} />
      <g data-orb={hue ?? undefined}>
        <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx={2} style={f(hue ? "accent-wash" : "card")} />
        {inner}
      </g>
    </g>
  );
}

/** A desk: its top and front, two screens of its discipline's work in its orb's hue, a keyboard and a mug; the QA bench's
 * a devkit with a controller; the mixing desk's a board of faders. */
export function Station({ d, seat }: { d: SDesk; seat: { hue: OrbHue; working: boolean } | null }) {
  const r = d.rect;
  const sw = Math.min(42, (r.w - 14) / 2);
  return (
    <Piece x={r.x} y={r.y} w={r.w} h={r.h} up={40}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h - 10} rx={4} style={f("wood")} />
      <rect x={r.x} y={r.y} width={r.w} height={3} rx={1.5} style={f("fill-2")} />
      <rect x={r.x} y={r.y + r.h - 12} width={r.w} height={12} rx={3} style={f("wood")} opacity={0.82} />
      <rect x={r.x + 6} y={r.y + r.h} width={5} height={6} style={f("wood")} />
      <rect x={r.x + r.w - 11} y={r.y + r.h} width={5} height={6} style={f("wood")} />
      <Screen x={r.x + 5} y={r.y - 36} w={sw} pod={d.pod} k={0} hue={seat?.hue ?? null} working={seat?.working ?? false} />
      <Screen x={r.x + r.w - sw - 5} y={r.y - 36} w={sw} pod={d.pod} k={1} hue={seat?.hue ?? null} working={seat?.working ?? false} />
      {d.pod === "audio" ? (
        <g>{Array.from({ length: 8 }, (_, i) => <g key={i}><line x1={r.x + 12 + i * 10} x2={r.x + 12 + i * 10} y1={r.y + 6} y2={r.y + 22} style={st("text-3", 1.2)} /><rect x={r.x + 9 + i * 10} y={r.y + 8 + ((i * 5) % 10)} width={6} height={4} rx={1} style={f("text-1")} /></g>)}</g>
      ) : d.pod === "qa" ? (
        <g><rect x={r.x + r.w / 2 - 14} y={r.y + 6} width={28} height={10} rx={3} style={f("text-3")} /><rect x={r.x + r.w / 2 - 8} y={r.y + 18} width={16} height={7} rx={3} style={f("text-2")} /></g>
      ) : (
        <g><rect x={r.x + 20} y={r.y + 8} width={44} height={8} rx={2} style={f("card")} /><rect x={r.x + r.w - 22} y={r.y + 6} width={10} height={11} rx={2.5} style={f("text-2")} /></g>
      )}
    </Piece>
  );
}

/** The ship gong on its frame, swinging when it is rung (the floor's moving parts are CSS: STUDIO_CSS). */
export function Gong({ ringing }: { ringing: boolean }) {
  const g = SPIECES.gong;
  return (
    <Piece x={g.x} y={g.y} w={g.w} h={g.h} up={20}>
      <rect x={g.x + 2} y={g.y - 16} width={5} height={g.h + 14} style={f("wood")} />
      <rect x={g.x + g.w - 7} y={g.y - 16} width={5} height={g.h + 14} style={f("wood")} />
      <rect x={g.x} y={g.y - 18} width={g.w} height={6} rx={2} style={f("wood")} />
      <g style={{ transformOrigin: `${g.x + g.w / 2}px ${g.y - 12}px`, transformBox: "view-box", animation: ringing ? "orbs-studio-gong 300ms ease-in-out 6" : undefined }} data-gong={ringing ? "ringing" : "still"}>
        <line x1={g.x + g.w / 2} x2={g.x + g.w / 2} y1={g.y - 12} y2={g.y - 2} style={st("text-3", 1.5)} />
        <Hue hue="honey">
          <circle cx={g.x + g.w / 2} cy={g.y + 16} r={18} style={f("accent")} />
          <circle cx={g.x + g.w / 2} cy={g.y + 16} r={11} style={st("accent-fill", 2)} />
        </Hue>
      </g>
    </Piece>
  );
}

export const STUDIO_CSS = `
@keyframes orbs-studio-gong { 0%, 100% { transform: rotate(0deg) } 25% { transform: rotate(12deg) } 75% { transform: rotate(-12deg) } }
@media (prefers-reduced-motion: reduce) { [data-gong] { animation: none !important; } }
`;
