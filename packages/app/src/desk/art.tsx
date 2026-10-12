// The desk floor's drawings (PLAN 5.22; desk/plan.ts has the plan): the room and everything fixed in it as one
// picture, and the pieces an orb can stand behind (each desk in the pit with its three screens) on their own, so the floor
// stacks them by how near they are. The office floor's way: the theme's surfaces and the orbs' hues through data-orb,
// never a colour named here. What the market does shows on the wall (each price and its change, BTC's last hours as a
// line), on every desk's screens (its orb's own market, in its hue) and on the leaderboard.
import type { CSSProperties, ReactNode } from "react";
import type { HueName } from "../design/tokens.ts";
import type { OrbHue } from "../orb/spec.ts";
import { Clock, Plant, Window, type Sky } from "../floor/art.tsx";
import { AREAS, areaOf, H, TDESK, TDESKS, TPIECES, W, WALL, type TDesk } from "./plan.ts";

const f = (v: string): CSSProperties => ({ fill: `var(--${v})` });
const st = (v: string, w = 1): CSSProperties => ({ stroke: `var(--${v})`, strokeWidth: w, fill: "none" });
const Hue = ({ hue, children }: { hue: HueName; children: ReactNode }) => <g data-orb={hue}>{children}</g>;
const LOW = 832;

export type WallPrice = { symbol: string; up: boolean };

/** The city at the windows: towers with lit floors by night, the sun on them by day. */
function Skyline({ x, y, w, h, sky }: { x: number; y: number; w: number; h: number; sky: Sky }) {
  const towers = [0.1, 0.24, 0.36, 0.52, 0.66, 0.8].map((at, i) => ({ x: x + at * w, w: w * (0.1 + (i % 3) * 0.03), h: h * (0.45 + ((i * 37) % 40) / 100) }));
  return (
    <g>
      <Window x={x} y={y} w={w} h={h} sky={sky} />
      {towers.map((t, i) => (
        <g key={i}>
          <rect x={t.x} y={y + h - t.h} width={t.w} height={t.h} style={f("trim")} opacity={0.85} />
          {sky !== "day" &&
            Array.from({ length: 4 }, (_, k) => (
              <rect key={k} x={t.x + 2 + (k % 2) * (t.w / 2 - 1)} y={y + h - t.h + 4 + Math.floor(k / 2) * 7} width={2.5} height={3} style={f("busy")} opacity={0.75} />
            ))}
        </g>
      ))}
    </g>
  );
}

/** Everything fixed: the floor, the wall of screens, the three rooms at the back, the pit's carpet, the bell, the
 * head's glass office, the risk desk. */
export function Backdrop({ now, sky, prices, spark, notes, strategies, riskOn, board }: {
  now: Date; sky: Sky; prices: WallPrice[]; spark: number[]; notes: number; strategies: number; riskOn: boolean;
  board: { name: string; hue: OrbHue; bar: number; up: boolean }[];
}) {
  const research = areaOf("research").rect;
  const war = areaOf("warroom").rect;
  const coffee = areaOf("coffee").rect;
  const pit = areaOf("pit").rect;
  const { shelves, corkboard, armchair, table, whiteboard, bar, fridge, stools, headDesk, bell, board: lb, riskDesk, tv } = TPIECES;
  // the war room's screen: the last of the price line as candles, and the line over them
  const screen = (() => {
    const xs = spark.length > 1 ? spark.slice(-13) : [1, 1.02, 1.01, 1.04, 1.03, 1.06, 1.05, 1.08, 1.07, 1.1, 1.09, 1.12, 1.11];
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const y = (v: number): number => whiteboard.y + 8 - ((v - lo) / (hi - lo || 1)) * 30;
    const x = (i: number): number => whiteboard.x + 14 + i * ((148 - 14) / Math.max(1, xs.length - 1));
    const candles = xs.slice(1).map((c, i) => {
      const o = xs[i]!;
      const wick = (hi - lo || 1) * 0.06;
      return { x: x(i + 1) - 3, o: y(o), c: y(c), hi: y(Math.max(o, c) + wick), lo: y(Math.min(o, c) - wick), up: c >= o };
    });
    return { candles, line: xs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${(y(v) - 2).toFixed(1)}`).join(" ") };
  })();
  const sMin = Math.min(...spark);
  const sMax = Math.max(...spark);
  const sparkPath = spark.length > 1 ? spark.map((v, i) => `${i ? "L" : "M"}${(470 + (i / (spark.length - 1)) * 260).toFixed(1)} ${(64 - ((v - sMin) / (sMax - sMin || 1)) * 36).toFixed(1)}`).join(" ") : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" aria-hidden style={{ position: "absolute", inset: 0, display: "block" }}>
      <defs>
        <pattern id="orbs-trade-tiles" width={40} height={40} patternUnits="userSpaceOnUse">
          <rect width={40} height={40} style={f("floor")} />
          <path d="M40 0 H0 V40" style={st("sep", 1.2)} />
        </pattern>
        <pattern id="orbs-trade-carpet" width={16} height={16} patternUnits="userSpaceOnUse">
          <rect width={16} height={16} style={f("floor")} />
          <path d="M0 16 L16 0" style={st("sep", 1)} />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#orbs-trade-tiles)" />
      {/* the pit's carpet, a lime border round it */}
      <rect x={pit.x + 18} y={pit.y + 12} width={pit.w - 36} height={pit.h - 24} rx={18} fill="url(#orbs-trade-carpet)" />
      <Hue hue="lime">
        <rect x={pit.x + 18} y={pit.y + 12} width={pit.w - 36} height={pit.h - 24} rx={18} style={st("accent-fill", 3)} />
      </Hue>
      {/* the corridor and the hallway: a runner each */}
      {[300, 780].map((y) => (
        <rect key={y} x={40} y={y + 12} width={W - 80} height={28} rx={8} style={f("fill")} />
      ))}

      {/* the back wall: the city, the clock, and the wall of screens */}
      <rect width={W} height={WALL} style={f("wall")} />
      <rect y={WALL - 6} width={W} height={10} style={f("trim")} />
      <Skyline x={24} y={14} w={150} h={52} sky={sky} />
      <Clock x={210} y={40} now={now} />
      <g data-wall-screens>
        <rect x={250} y={6} width={700} height={70} rx={6} style={f("ground")} />
        <rect x={254} y={10} width={692} height={62} rx={4} style={f("card")} opacity={0.9} />
        {/* each market on its own panel, green or red as it moves (its words are the tape's, over the floor) */}
        {[...prices.slice(0, 4).map((p, i) => ({ p, x: 262 + i * 52 })), ...prices.slice(4, 8).map((p, i) => ({ p, x: 742 + i * 50 }))].map(({ p, x }, i) => (
          <g key={p.symbol} data-wall-price={p.symbol} transform={`translate(${x} 16)`}>
            <rect width={46} height={50} rx={4} style={f("raised")} />
            <rect x={6} y={8} width={22} height={5} rx={2} style={f("text-2")} opacity={0.8} />
            <rect x={6} y={20} width={34} height={6} rx={2} style={f("text-1")} opacity={0.85} />
            <path d={`M6 ${p.up ? 42 : 34} l9 ${p.up ? -4 : 3} l9 ${p.up ? 2 : -2} l9 ${p.up ? -6 : 5} l8 ${p.up ? -3 : 4}`} style={st(p.up ? "ok" : "off", 2)} />
            <circle cx={40} cy={10} r={2.4} style={f(p.up ? "ok" : "off")} className={i % 3 ? undefined : "orbs-floor-blink"} />
          </g>
        ))}
        {/* BTC's last hours, a line across the middle screen */}
        <rect x={466} y={14} width={268} height={56} rx={4} style={f("raised")} />
        <rect x={474} y={20} width={30} height={5} rx={2} style={f("text-3")} opacity={0.8} />
        {sparkPath && <path d={sparkPath} style={{ ...st(spark.at(-1)! >= spark[0]! ? "ok" : "off", 2) }} />}
        <circle cx={940} cy={16} r={3} style={f("off")} className="orbs-floor-blink" />
      </g>
      <Skyline x={986} y={14} w={190} h={52} sky={sky} />

      {/* the walls between the back rooms (glass for the war room), and their front walls with a door each */}
      <Hue hue="teal">
        {[392, 796].map((x) => (
          <g key={x}>
            <rect x={x} y={WALL} width={12} height={300 - WALL} style={f("accent-wash")} />
            <rect x={x + 5} y={WALL} width={2} height={300 - WALL} style={f("accent-fill")} />
          </g>
        ))}
      </Hue>
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

      {/* the research corner: the shelves of whitepapers, the corkboard with the desk's notes, an armchair */}
      <rect x={shelves.x} y={WALL - 30} width={shelves.w} height={shelves.y + shelves.h - WALL + 30} rx={4} style={f("wood")} />
      {[0, 1].map((row) =>
        Array.from({ length: 13 }, (_, i) => {
          const hues: HueName[] = ["violet", "cornflower", "amber", "teal", "coral", "mint"];
          return (
            <Hue key={`${row}${i}`} hue={hues[(i + row * 2) % hues.length]!}>
              <rect x={shelves.x + 8 + i * 10.6} y={WALL - 24 + row * 30 + ((i * 3 + row) % 3) * 2} width={8} height={22 - ((i * 3 + row) % 3) * 2} rx={1} style={f(i % 3 ? "accent-fill" : "accent")} />
            </Hue>
          );
        }),
      )}
      <rect x={corkboard.x} y={corkboard.y - 30} width={corkboard.w} height={corkboard.h + 24} rx={4} style={f("wood")} opacity={0.9} />
      <rect x={corkboard.x + 5} y={corkboard.y - 25} width={corkboard.w - 10} height={corkboard.h + 14} rx={2} style={f("raised")} />
      {Array.from({ length: Math.min(9, notes) }, (_, i) => {
        const hues: HueName[] = ["citron", "pink", "mint", "apricot", "cornflower"];
        return (
          <Hue key={i} hue={hues[i % hues.length]!}>
            <rect x={corkboard.x + 12 + (i % 5) * 27} y={corkboard.y - 20 + Math.floor(i / 5) * 22} width={20} height={16} rx={1.5} style={f("accent")} opacity={0.85} transform={`rotate(${((i * 29) % 11) - 5} ${corkboard.x + 22 + (i % 5) * 27} ${corkboard.y - 12 + Math.floor(i / 5) * 22})`} />
            <circle cx={corkboard.x + 22 + (i % 5) * 27} cy={corkboard.y - 19 + Math.floor(i / 5) * 22} r={1.8} style={f("off")} />
          </Hue>
        );
      })}
      <Hue hue="violet">
        <rect x={armchair.x} y={armchair.y - 12} width={armchair.w} height={28} rx={10} style={f("accent")} opacity={0.8} />
        <rect x={armchair.x - 6} y={armchair.y} width={14} height={armchair.h - 4} rx={6} style={f("accent")} />
        <rect x={armchair.x + armchair.w - 8} y={armchair.y} width={14} height={armchair.h - 4} rx={6} style={f("accent")} />
        <rect x={armchair.x + 6} y={armchair.y + 12} width={armchair.w - 12} height={armchair.h - 18} rx={6} style={f("accent-fill")} />
      </Hue>
      <Plant x={research.x + 26} y={270} s={0.95} hue="clover" />
      {/* the research corner's TV on its stand: the news, a red light on, its headlines and a ticker under them (pressed:
          the news over the floor, PLAN 5.43) */}
      <rect x={tv.x + tv.w / 2 - 5} y={tv.y + tv.h - 2} width={10} height={13} style={f("text-3")} />
      <rect x={tv.x + tv.w / 2 - 26} y={tv.y + tv.h + 10} width={52} height={5} rx={2.5} style={f("text-3")} />
      <rect x={tv.x} y={tv.y} width={tv.w} height={tv.h} rx={6} style={f("raised")} />
      <rect x={tv.x + 5} y={tv.y + 5} width={tv.w - 10} height={tv.h - 10} rx={3} style={f("ground")} />
      <Hue hue="coral">
        <circle cx={tv.x + 14} cy={tv.y + 14} r={3.5} style={f("accent")} className="orbs-floor-glow" />
        <rect x={tv.x + 5} y={tv.y + tv.h - 16} width={tv.w - 10} height={11} style={f("accent")} opacity={0.85} />
      </Hue>
      <rect x={tv.x + 22} y={tv.y + 11} width={34} height={6} rx={2} style={f("text-2")} opacity={0.85} />
      <rect x={tv.x + 12} y={tv.y + 23} width={tv.w - 24} height={5} rx={2} style={f("text-3")} opacity={0.7} />
      <rect x={tv.x + 12} y={tv.y + 32} width={tv.w - 44} height={5} rx={2} style={f("text-3")} opacity={0.5} />
      <text x={tv.x + 9} y={tv.y + tv.h - 6.5} style={{ ...f("ground"), font: "900 10px var(--font)", letterSpacing: ".1em" }}>NEWS</text>

      {/* the war room: its screen, live (press it: any token, its chart and a trade, owner 10-11), the strategies on it a
          tile each, and the table */}
      <rect x={whiteboard.x} y={whiteboard.y - 34} width={whiteboard.w} height={whiteboard.h + 30} rx={4} style={f("raised")} />
      <rect x={whiteboard.x + 5} y={whiteboard.y - 29} width={whiteboard.w - 10} height={whiteboard.h + 20} rx={2} style={f("ground")} />
      {[0, 1, 2].map((i) => (
        <line key={i} x1={whiteboard.x + 10} x2={whiteboard.x + 148} y1={whiteboard.y - 18 + i * 11} y2={whiteboard.y - 18 + i * 11} style={st("hairline", 0.6)} />
      ))}
      {screen.candles.map((c, i) => (
        <g key={i}>
          <line x1={c.x} x2={c.x} y1={c.hi} y2={c.lo} style={st(c.up ? "ok" : "off", 0.8)} />
          <rect x={c.x - 2.2} y={Math.min(c.o, c.c)} width={4.4} height={Math.max(1.2, Math.abs(c.o - c.c))} style={f(c.up ? "ok" : "off")} />
        </g>
      ))}
      <Hue hue="amber">
        <path d={screen.line} style={{ ...st("accent", 1.6), fill: "none" }} opacity={0.9} />
      </Hue>
      <circle cx={whiteboard.x + 14} cy={whiteboard.y - 23} r={2.2} style={f("ok")} />
      {Array.from({ length: Math.min(6, strategies) }, (_, i) => (
        <Hue key={i} hue={(["citron", "mint", "pink"] as HueName[])[i % 3]!}>
          <rect x={whiteboard.x + 156 + (i % 3) * 30} y={whiteboard.y - 24 + Math.floor(i / 3) * 24} width={24} height={20} rx={1.5} style={f("accent")} opacity={0.9} />
        </Hue>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={table.x + 22 + i * 60} y={table.y - 20} width={28} height={24} rx={8} style={f("raised")} />
      ))}
      <Plant x={war.x + war.w - 26} y={110} s={0.9} hue="jade" />

      {/* the coffee bar: the counter, the espresso machine (it steams), the stools, the fridge of energy drinks, the neon */}
      <rect x={bar.x} y={bar.y - 10} width={bar.w} height={bar.h + 10} rx={4} style={f("wood")} />
      <rect x={bar.x} y={bar.y - 10} width={bar.w} height={8} rx={3} style={f("fill-2")} />
      <g>
        <rect x={bar.x + 30} y={bar.y - 40} width={44} height={36} rx={5} style={f("text-3")} />
        <rect x={bar.x + 38} y={bar.y - 34} width={28} height={10} rx={2} style={f("ground")} opacity={0.7} />
        <rect x={bar.x + 46} y={bar.y - 22} width={10} height={12} rx={2} style={f("card")} />
        {[0, 1, 2].map((i) => (
          <circle key={i} cx={bar.x + 42 + i * 8} cy={bar.y - 48} r={3} style={f("text-2")} opacity={0.5} className="orbs-floor-float" />
        ))}
      </g>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={stools.x + i * 50} y={stools.y} width={6} height={22} style={f("text-3")} />
          <ellipse cx={stools.x + 3 + i * 50} cy={stools.y} rx={14} ry={5} style={f("raised")} />
        </g>
      ))}
      <rect x={fridge.x} y={fridge.y - 40} width={fridge.w} height={fridge.h + 40} rx={6} style={f("raised")} />
      <rect x={fridge.x + 5} y={fridge.y - 34} width={fridge.w - 10} height={fridge.h + 24} rx={3} style={f("ground")} opacity={0.6} />
      {Array.from({ length: 12 }, (_, i) => (
        <Hue key={i} hue={i % 3 ? "lime" : "cyan"}>
          <rect x={fridge.x + 10 + (i % 4) * 11} y={fridge.y - 28 + Math.floor(i / 4) * 22} width={7} height={16} rx={2} style={f("accent")} />
        </Hue>
      ))}
      <Hue hue="lime">
        <text x={coffee.x + 200} y={WALL + 30} textAnchor="middle" style={{ ...f("accent"), font: "900 22px var(--font)", letterSpacing: ".18em" }} className="orbs-floor-glow">HODL</text>
      </Hue>

      {/* the head's glass office */}
      <Hue hue="teal">
        <rect x={0} y={LOW} width={392} height={H - LOW} style={f("accent-wash")} opacity={0.55} />
      </Hue>
      <rect x={headDesk.x} y={headDesk.y} width={headDesk.w} height={headDesk.h - 10} rx={6} style={f("wood")} />
      <rect x={headDesk.x} y={headDesk.y + headDesk.h - 12} width={headDesk.w} height={12} rx={4} style={f("wood")} opacity={0.82} />
      <rect x={headDesk.x + 76} y={headDesk.y - 22} width={28} height={24} rx={8} style={f("raised")} />
      <rect x={headDesk.x + 20} y={headDesk.y - 30} width={40} height={30} rx={3} style={f("ground")} />
      <Hue hue="lime">
        <path d={`M${headDesk.x + 24} ${headDesk.y - 8} l8 -6 l8 4 l8 -12 l8 6`} style={st("accent", 1.6)} />
      </Hue>
      <rect x={24} y={LOW + 30} width={56} height={40} rx={3} style={f("trim")} />
      <rect x={28} y={LOW + 34} width={48} height={32} rx={2} style={f("card")} />
      <Hue hue="lime">
        <path d={`M34 ${LOW + 58} l10 -8 l8 5 l10 -12 l10 6`} style={st("accent", 2)} />
      </Hue>
      <Plant x={362} y={LOW + 200} s={0.95} />

      {/* the bell, on its stand, and the leaderboard: today's paper P&L by orb */}
      <rect x={bell.x + bell.w / 2 - 3} y={bell.y + 10} width={6} height={bell.h - 6} style={f("wood")} />
      <rect x={bell.x + 4} y={bell.y + bell.h} width={bell.w - 8} height={6} rx={2} style={f("wood")} />
      <rect x={lb.x} y={lb.y - 60} width={lb.w} height={lb.h + 56} rx={6} style={f("ground")} />
      <rect x={lb.x + 4} y={lb.y - 56} width={lb.w - 8} height={lb.h + 48} rx={4} style={f("card")} />
      <rect x={lb.x + 14} y={lb.y - 46} width={70} height={6} rx={3} style={f("text-3")} opacity={0.8} />
      {board.slice(0, 4).map((b, i) => (
        <g key={b.name} data-board-row={b.name} transform={`translate(${lb.x + 14 + (i % 2) * 150} ${lb.y - 30 + Math.floor(i / 2) * 22})`}>
          <g data-orb={b.hue}>
            <circle cx={5} cy={0} r={5} style={f("accent")} />
          </g>
          <rect x={16} y={-3} width={Math.max(8, Math.min(110, b.bar))} height={6} rx={3} style={f(b.up ? "ok" : "off")} />
        </g>
      ))}

      {/* the risk desk: its lamp says whether real trades are on */}
      <Hue hue="coral">
        <rect x={808} y={LOW} width={392} height={H - LOW} style={f("accent-wash")} opacity={0.45} />
      </Hue>
      <rect x={riskDesk.x} y={riskDesk.y} width={riskDesk.w} height={riskDesk.h - 10} rx={6} style={f("wood")} />
      <rect x={riskDesk.x} y={riskDesk.y + riskDesk.h - 12} width={riskDesk.w} height={12} rx={4} style={f("wood")} opacity={0.82} />
      <g data-risk={riskOn ? "on" : "off"}>
        <rect x={riskDesk.x + riskDesk.w - 56} y={riskDesk.y - 64} width={44} height={44} rx={22} style={f("ground")} />
        <circle cx={riskDesk.x + riskDesk.w - 34} cy={riskDesk.y - 42} r={16} style={f(riskOn ? "ok" : "off")} className="orbs-floor-glow" />
      </g>
      <rect x={riskDesk.x + 30} y={riskDesk.y - 30} width={44} height={32} rx={3} style={f("ground")} />
      <Hue hue="coral">
        <path d={`M${riskDesk.x + 34} ${riskDesk.y - 22} h36 M${riskDesk.x + 34} ${riskDesk.y - 14} h24`} style={st("accent", 2)} />
      </Hue>
      <Plant x={W - 30} y={LOW + 200} s={0.95} hue="jade" />
      {/* the plants of the pit */}
      <Plant x={22} y={pit.y + 200} s={1.05} hue="leaf" />
      <Plant x={W - 22} y={pit.y + 200} s={1.05} hue="clover" />
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

/** A desk in the pit: its top and front, three screens (each seat's two of its orb's market, in its hue; the middle the
 * desk's), keyboards and two mugs. `flash` lights a seat's screens green or red for a moment (a fill). */
export function Station({ d, seats, flash }: { d: TDesk; seats: [{ hue: OrbHue; working: boolean } | null, { hue: OrbHue; working: boolean } | null]; flash: [("ok" | "off") | null, ("ok" | "off") | null] }) {
  const r = d.rect;
  const screen = (x: number, s: { hue: OrbHue; working: boolean } | null, fl: "ok" | "off" | null, k: number) => (
    <g key={k}>
      <rect x={x + 26} y={r.y + 2} width={4} height={8} style={f("ground")} />
      <rect x={x} y={r.y - 32} width={56} height={34} rx={4} style={f("ground")} />
      <g data-orb={s?.hue}>
        <rect x={x + 3} y={r.y - 29} width={50} height={28} rx={2} style={f(fl ? fl : s ? "accent-wash" : "card")} opacity={fl ? 0.55 : 1} />
        {s &&
          [0, 1, 2, 3, 4, 5, 6].map((i) => {
            const hgt = [8, 12, 6, 14, 10, 16, 12][(i + k) % 7]!;
            const up = (i + k) % 3 !== 1;
            return <rect key={i} x={x + 7 + i * 6.4} y={r.y - 6 - hgt - ((i * 5 + k) % 6)} width={3.4} height={hgt} rx={0.8} style={f(up ? "ok" : "off")} opacity={0.9} className={s.working ? "orbs-floor-type" : undefined} />;
          })}
      </g>
    </g>
  );
  return (
    <Piece x={r.x} y={r.y} w={r.w} h={r.h} up={36}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h - 10} rx={4} style={f("wood")} />
      <rect x={r.x} y={r.y} width={r.w} height={3} rx={1.5} style={f("fill-2")} />
      <rect x={r.x} y={r.y + r.h - 12} width={r.w} height={12} rx={3} style={f("wood")} opacity={0.82} />
      <rect x={r.x + 6} y={r.y + r.h} width={5} height={6} style={f("wood")} />
      <rect x={r.x + r.w - 11} y={r.y + r.h} width={5} height={6} style={f("wood")} />
      {screen(r.x + 12, seats[0], flash[0], 0)}
      {screen(r.x + TDESK.w / 2 - 28, seats[0] ?? seats[1], null, 1)}
      {screen(r.x + r.w - 68, seats[1], flash[1], 2)}
      {[0, 1].map((k) => (
        <g key={k}>
          <rect x={r.x + (k ? r.w - 92 : 40)} y={r.y + 8} width={44} height={8} rx={2} style={f("card")} />
          <rect x={r.x + (k ? r.w - 30 : 16)} y={r.y + 6} width={10} height={11} rx={2.5} style={f("text-2")} />
        </g>
      ))}
    </Piece>
  );
}

/** The bell's body, swinging when it is rung (the floor's moving parts are CSS: FLOOR_CSS and these). */
export function Bell({ ringing }: { ringing: boolean }) {
  const b = TPIECES.bell;
  return (
    <Piece x={b.x} y={b.y} w={b.w} h={b.h} up={8}>
      <g style={{ transformOrigin: `${b.x + b.w / 2}px ${b.y + 4}px`, transformBox: "view-box", animation: ringing ? "orbs-trade-ring 260ms ease-in-out 6" : undefined }} data-bell={ringing ? "ringing" : "still"}>
        <Hue hue="honey">
          <path d={`M${b.x + 8} ${b.y + 34} Q${b.x + 10} ${b.y + 4} ${b.x + b.w / 2} ${b.y + 2} Q${b.x + b.w - 10} ${b.y + 4} ${b.x + b.w - 8} ${b.y + 34} Z`} style={f("accent")} />
          <rect x={b.x + 4} y={b.y + 32} width={b.w - 8} height={6} rx={3} style={f("accent")} />
        </Hue>
        <circle cx={b.x + b.w / 2} cy={b.y + 41} r={4} style={f("text-3")} />
      </g>
    </Piece>
  );
}

export const TRADE_CSS = `
@keyframes orbs-war-pulse { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 2px var(--accent-fill), 0 0 16px var(--accent-glow); } }
.orbs-war-screen { animation: orbs-war-pulse 2.8s ease-in-out infinite; }
.orbs-war-screen:hover, .orbs-war-screen:focus-visible { animation: none; box-shadow: 0 0 0 2px var(--accent), 0 0 20px var(--accent-glow); outline: 0; }
@media (prefers-reduced-motion: reduce) { .orbs-war-screen { animation: none; } }
@keyframes orbs-trade-ring { 0%, 100% { transform: rotate(0deg) } 25% { transform: rotate(18deg) } 75% { transform: rotate(-18deg) } }
@keyframes orbs-trade-tape { from { transform: translateX(0) } to { transform: translateX(-50%) } }
.orbs-trade-tape { animation: orbs-trade-tape 40s linear infinite; }
.orbs-trade-tape:hover, .orbs-trade-tape:focus-within { animation-play-state: paused; }
.orbs-floor-float { animation: orbs-floor-float 2.4s ease-out infinite; transform-box: fill-box; }
.orbs-floor-float:nth-child(2) { animation-delay: .8s } .orbs-floor-float:nth-child(3) { animation-delay: 1.6s }
@media (prefers-reduced-motion: reduce) { [class^="orbs-trade-"], [data-bell] { animation: none !important; } }
`;
export { TDESKS };
