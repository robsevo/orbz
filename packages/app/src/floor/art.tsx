// The office floor's drawings (floor/plan.ts has the plan): the room and everything fixed in it as one
// picture behind the orbs, and the pieces an orb can be behind (a desk, the meeting table, the ping-pong
// table) each on its own, so the floor can stack them by how near they are. Colours are the theme's own
// (the surfaces, the lines) and the orbs' hues, worn through data-orb as each orb wears its own: nothing
// here names a colour (design/tokens.ts is the only place one is written).
import type { CSSProperties, ReactNode } from "react";
import type { HueName } from "../design/tokens.ts";
import { CLASS_DESKS, CORRIDOR, DESK, DESKS, H, HALL, LOW, PIECES, POIS, ROOMS, W, WAITING, WALL, ZONES, type Desk, type Rect, type Room as Place } from "./plan.ts";

const f = (v: string): CSSProperties => ({ fill: `var(--${v})` });
const st = (v: string, w = 1): CSSProperties => ({ stroke: `var(--${v})`, strokeWidth: w, fill: "none" });
const Hue = ({ hue, children }: { hue: HueName; children: ReactNode }) => <g data-orb={hue}>{children}</g>;

/** The time of day the windows show. */
export type Sky = "day" | "dusk" | "night";
export const skyAt = (h: number): Sky => (h >= 7 && h < 18 ? "day" : h >= 18 && h < 20 ? "dusk" : "night");

function Window({ x, y, w, h, sky }: { x: number; y: number; w: number; h: number; sky: Sky }) {
  const hue: HueName = sky === "dusk" ? "apricot" : "cornflower";
  return (
    <g>
      <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={5} style={f("trim")} />
      <Hue hue={hue}>
        <rect x={x} y={y} width={w} height={h} rx={3} style={sky === "night" ? f("ground") : f("accent")} opacity={sky === "night" ? 1 : 0.62} />
        {sky !== "night" && <rect x={x} y={y + h * 0.55} width={w} height={h * 0.45} rx={3} style={f("text-1")} opacity={0.16} />}
        {sky === "day" && <circle cx={x + w * 0.72} cy={y + h * 0.3} r={6} style={f("text-1")} opacity={0.9} />}
        {sky === "day" && <ellipse cx={x + w * 0.32} cy={y + h * 0.42} rx={11} ry={4} style={f("text-1")} opacity={0.55} />}
        {sky === "dusk" && <circle cx={x + w * 0.5} cy={y + h * 0.78} r={9} style={f("accent")} opacity={0.9} />}
      </Hue>
      {sky === "night" && (
        <g style={f("text-2")}>
          <circle cx={x + w * 0.74} cy={y + h * 0.3} r={5} />
          {[0.2, 0.42, 0.3, 0.58, 0.86].map((a, i) => (
            <circle key={i} cx={x + w * a} cy={y + h * [0.25, 0.6, 0.78, 0.35, 0.7][i]!} r={0.9} className="orbs-floor-twinkle" style={{ animationDelay: `${i * 0.7}s` }} />
          ))}
        </g>
      )}
      {/* the frame's cross */}
      <rect x={x + w / 2 - 1.5} y={y} width={3} height={h} style={f("trim")} />
      <rect x={x} y={y + h / 2 - 1.5} width={w} height={3} style={f("trim")} />
    </g>
  );
}

function Plant({ x, y, s = 1, hue = "leaf" }: { x: number; y: number; s?: number; hue?: HueName }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <Hue hue={hue}>
        {[-38, -12, 14, 40, 0].map((a, i) => (
          <ellipse key={i} cx={0} cy={-16} rx={5} ry={15} transform={`rotate(${a} 0 0)`} style={f(i === 4 ? "accent" : "accent-fill")} />
        ))}
        {[-24, 26].map((a, i) => (
          <ellipse key={i} cx={0} cy={-20} rx={4.5} ry={13} transform={`rotate(${a} 0 0)`} style={f("accent")} opacity={0.85} />
        ))}
      </Hue>
      <path d="M-10 -2 L10 -2 L7 14 L-7 14 Z" style={f("raised")} />
      <rect x={-11} y={-4} width={22} height={4} rx={1.5} style={f("fill-2")} />
    </g>
  );
}

function Clock({ x, y, now }: { x: number; y: number; now: Date }) {
  const m = now.getMinutes();
  const h = (now.getHours() % 12) + m / 60;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={17} style={f("raised")} />
      <circle r={14} style={f("text-2")} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={-0.6} y={-12.5} width={1.2} height={i % 3 ? 1.6 : 3} transform={`rotate(${i * 30})`} style={f("ground")} />
      ))}
      <rect x={-1.1} y={-7.5} width={2.2} height={8} rx={1} transform={`rotate(${h * 30})`} style={f("ground")} />
      <rect x={-0.7} y={-11} width={1.4} height={11.5} rx={0.7} transform={`rotate(${m * 6})`} style={f("ground")} />
      <circle r={1.6} style={f("alert")} />
    </g>
  );
}

/** A department's partition: a low wall in its colour, with a gap to walk in by. */
function Partition({ r, door, hue }: { r: Rect; door: { x: number; w: number }; hue: HueName }) {
  const parts = [{ x: r.x, w: door.x - r.x }, { x: door.x + door.w, w: r.x + r.w - door.x - door.w }];
  return (
    <Hue hue={hue}>
      {parts.map((p, i) => (
        <g key={i}>
          <rect x={p.x} y={r.y - 8} width={p.w} height={20} rx={4} style={f("wall")} />
          <rect x={p.x} y={r.y - 8} width={p.w} height={5} rx={2.5} style={f("accent")} />
          <rect x={p.x} y={r.y + 8} width={p.w} height={4} style={f("ground")} opacity={0.35} />
        </g>
      ))}
    </Hue>
  );
}

/** What stands on each department's partition, so you know it from across the floor. */
function Fixture({ id, r }: { id: string; r: Rect }) {
  const x = r.x + r.w - 128;
  const y = r.y - 54;
  if (id === "think")
    // a whiteboard, a plan sketched on it
    return (
      <g>
        <rect x={x} y={y} width={104} height={50} rx={4} style={f("raised")} />
        <rect x={x + 4} y={y + 4} width={96} height={42} rx={2} style={f("text-2")} />
        <Hue hue="violet">
          <rect x={x + 12} y={y + 12} width={20} height={11} rx={2} style={st("accent", 1.6)} />
          <rect x={x + 44} y={y + 22} width={20} height={11} rx={2} style={st("accent", 1.6)} />
          <rect x={x + 74} y={y + 10} width={18} height={11} rx={2} style={st("accent", 1.6)} />
          <path d={`M${x + 32} ${y + 17} L${x + 44} ${y + 27} M${x + 64} ${y + 27} L${x + 74} ${y + 16}`} style={st("accent", 1.4)} />
        </Hue>
        <path d={`M${x + 12} ${y + 36} h40 M${x + 12} ${y + 40} h28`} style={st("ground", 1.2)} opacity={0.6} />
      </g>
    );
  if (id === "make")
    // a moodboard: swatches pinned up, in every colour
    return (
      <g>
        <rect x={x} y={y} width={104} height={50} rx={4} style={f("raised")} />
        <rect x={x + 4} y={y + 4} width={96} height={42} rx={2} style={f("fill-2")} />
        {(["coral", "amber", "mint", "cornflower", "violet", "pink", "citron", "teal"] as HueName[]).map((h, i) => (
          <Hue key={h} hue={h}>
            <rect x={x + 9 + (i % 4) * 23} y={y + 9 + Math.floor(i / 4) * 18} width={17} height={13} rx={2} style={f("accent")} transform={`rotate(${((i * 37) % 9) - 4} ${x + 17 + (i % 4) * 23} ${y + 15 + Math.floor(i / 4) * 18})`} />
          </Hue>
        ))}
      </g>
    );
  if (id === "business")
    // the chart board: the numbers going up
    return (
      <g>
        <rect x={x} y={y} width={104} height={50} rx={4} style={f("raised")} />
        <rect x={x + 4} y={y + 4} width={96} height={42} rx={2} style={f("ground")} />
        <Hue hue="amber">
          {[14, 20, 17, 26, 30, 36].map((v, i) => (
            <rect key={i} x={x + 12 + i * 14} y={y + 42 - v} width={9} height={v} rx={1.5} style={f(i === 5 ? "accent" : "accent-fill")} />
          ))}
          <path d={`M${x + 14} ${y + 30} L${x + 40} ${y + 24} L${x + 62} ${y + 18} L${x + 90} ${y + 9}`} style={st("accent", 1.6)} />
        </Hue>
      </g>
    );
  if (id === "life")
    // the family calendar: today's date is written on it by the floor
    return (
      <g>
        <rect x={x} y={y} width={104} height={50} rx={4} style={f("raised")} />
        <rect x={x + 4} y={y + 4} width={96} height={42} rx={2} style={f("text-2")} />
        <Hue hue="mint">
          <rect x={x + 4} y={y + 4} width={96} height={11} rx={2} style={f("accent")} />
        </Hue>
        {Array.from({ length: 14 }, (_, i) => (
          <rect key={i} x={x + 10 + (i % 7) * 12.5} y={y + 20 + Math.floor(i / 7) * 11} width={8} height={7} rx={1} style={f("ground")} opacity={i === 9 ? 0.9 : 0.18} />
        ))}
      </g>
    );
  if (id === "play")
    // a dartboard
    return (
      <g transform={`translate(${x + 80} ${y + 26})`}>
        <circle r={19} style={f("raised")} />
        <Hue hue="rose">
          <circle r={15} style={f("accent")} />
        </Hue>
        <circle r={10} style={f("text-2")} />
        <Hue hue="rose">
          <circle r={5} style={f("accent")} />
        </Hue>
        <circle r={1.8} style={f("ground")} />
      </g>
    );
  return null;
}

/** Everything fixed: the floor, the walls and windows, the rooms' furniture, the departments' floors and
 * partitions, the chairs. */
export function Room({ now, sky }: { now: Date; sky: Sky }) {
  const lounge = ROOMS[0]!.rect;
  const meeting = ROOMS[1]!.rect;
  const kitchen = ROOMS[2]!.rect;
  const sofa = PIECES.sofa;
  const shelf = PIECES.bookshelf;
  const counter = PIECES.counter;
  const fridge = PIECES.fridge;
  const cooler = PIECES.cooler;
  const vending = PIECES.vending;
  const bean = PIECES.beanbag;
  const rack = PIECES.rack;
  const arcade = PIECES.arcade;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" aria-hidden style={{ position: "absolute", inset: 0, display: "block" }}>
      <defs>
        <pattern id="orbs-floor-tiles" width={40} height={40} patternUnits="userSpaceOnUse">
          <rect width={40} height={40} style={f("floor")} />
          <path d="M40 0 H0 V40" style={st("sep", 1.2)} />
        </pattern>
        <pattern id="orbs-floor-checks" width={24} height={24} patternUnits="userSpaceOnUse">
          <rect width={24} height={24} style={f("floor")} />
          <rect width={12} height={12} style={f("fill")} />
          <rect x={12} y={12} width={12} height={12} style={f("fill")} />
        </pattern>
        <linearGradient id="orbs-floor-wallshade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--ground)", stopOpacity: 0.5 }} />
          <stop offset="1" style={{ stopColor: "var(--ground)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {/* the floor */}
      <rect width={W} height={H} fill="url(#orbs-floor-tiles)" />
      <rect x={kitchen.x} y={WALL} width={kitchen.w} height={kitchen.h} fill="url(#orbs-floor-checks)" />
      <Hue hue="teal">
        <rect x={meeting.x + 6} y={WALL + 6} width={meeting.w - 12} height={meeting.h - 14} rx={10} style={f("accent-wash")} />
      </Hue>
      <Hue hue="iris">
        <rect x={64} y={160} width={236} height={110} rx={22} style={f("accent-wash")} />
        <rect x={74} y={168} width={216} height={94} rx={18} style={st("accent-fill", 2)} />
      </Hue>
      {/* the hallways: a runner rug down each (owner, 10-08: "why is the space betwene top and bottom rooms is a street? lol.
          its an office"; a dashed line down the middle made it a road) */}
      {[CORRIDOR, HALL].map((c) => (
        <g key={c.y} data-hallway>
          <rect x={40} y={c.y + 12} width={W - 80} height={c.h - 24} rx={8} style={f("fill")} />
          <rect x={48} y={c.y + 16} width={W - 96} height={c.h - 32} rx={5} style={st("hairline", 1.5)} />
        </g>
      ))}

      {/* the departments' floors */}
      {ZONES.map((z) => (
        <Hue key={z.id} hue={z.hue}>
          <rect x={z.rect.x} y={z.rect.y} width={z.rect.w} height={z.rect.h} rx={16} style={f("accent-wash")} />
          <rect x={z.rect.x + 1} y={z.rect.y + 1} width={z.rect.w - 2} height={z.rect.h - 2} rx={15} style={st("accent-fill", 2)} />
        </Hue>
      ))}

      {/* the back wall */}
      <rect width={W} height={WALL} style={f("wall")} />
      <rect y={WALL - 6} width={W} height={10} style={f("trim")} />
      <rect y={WALL + 4} width={W} height={18} fill="url(#orbs-floor-wallshade)" />
      <Window x={30} y={14} w={74} h={50} sky={sky} />
      <Window x={128} y={14} w={74} h={50} sky={sky} />
      <Clock x={234} y={40} now={now} />
      {/* the meeting room's screen: the floor writes what is on it */}
      <rect x={meeting.x + 106} y={10} width={180} height={62} rx={6} style={f("trim")} />
      <Hue hue="teal">
        <rect x={meeting.x + 111} y={15} width={170} height={52} rx={3} style={f("accent-wash")} />
      </Hue>
      <Window x={meeting.x + 20} y={14} w={60} h={50} sky={sky} />
      <Window x={meeting.x + meeting.w - 80} y={14} w={60} h={50} sky={sky} />
      {/* the kitchen's cupboards and its window */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={counter.x + i * 59} y={12} width={55} height={40} rx={4} style={f("wood")} />
          <rect x={counter.x + i * 59 + 24} y={38} width={8} height={3} rx={1.5} style={f("fill-2")} />
        </g>
      ))}
      <Window x={kitchen.x + kitchen.w - 112} y={14} w={66} h={50} sky={sky} />

      {/* the walls between the rooms: glass, for the meeting room */}
      <Hue hue="teal">
        {[392, 796].map((x) => (
          <g key={x}>
            <rect x={x} y={WALL} width={12} height={300 - WALL} style={f("accent-wash")} />
            <rect x={x + 5} y={WALL} width={2} height={300 - WALL} style={f("accent-fill")} />
          </g>
        ))}
      </Hue>
      {/* the rooms' front walls, a door in each */}
      {ROOMS.map((r) =>
        [
          { x: r.rect.x, w: r.door.x - r.rect.x },
          { x: r.door.x + r.door.w, w: r.rect.x + r.rect.w - r.door.x - r.door.w },
        ].map((p, i) => (
          <g key={`${r.id}${i}`}>
            <rect x={p.x} y={288} width={p.w} height={14} rx={3} style={f("wall")} />
            <rect x={p.x} y={288} width={p.w} height={4} rx={2} style={f("fill-2")} />
          </g>
        )),
      )}

      {/* the lounge: a sofa, a bookshelf, a beanbag, plants */}
      <Hue hue="iris">
        <rect x={sofa.x} y={sofa.y - 18} width={sofa.w} height={34} rx={12} style={f("accent")} opacity={0.75} />
        <rect x={sofa.x - 10} y={sofa.y - 6} width={22} height={sofa.h + 2} rx={9} style={f("accent")} />
        <rect x={sofa.x + sofa.w - 12} y={sofa.y - 6} width={22} height={sofa.h + 2} rx={9} style={f("accent")} />
        {[0, 1, 2].map((i) => (
          <rect key={i} x={sofa.x + 10 + i * 61} y={sofa.y + 10} width={58} height={sofa.h - 12} rx={8} style={f("accent-fill")} />
        ))}
        <rect x={sofa.x + 6} y={sofa.y + 6} width={sofa.w - 12} height={6} rx={3} style={f("accent")} opacity={0.5} />
      </Hue>
      <Hue hue="amber">
        <rect x={sofa.x + 22} y={sofa.y - 6} width={20} height={16} rx={5} style={f("accent")} transform={`rotate(-10 ${sofa.x + 32} ${sofa.y + 2})`} />
      </Hue>
      <g>
        <rect x={shelf.x} y={WALL - 52} width={shelf.w} height={shelf.h + 52 + (shelf.y - WALL)} rx={4} style={f("wood")} />
        {[0, 1, 2].map((row) => (
          <g key={row}>
            <rect x={shelf.x + 5} y={WALL - 46 + row * 32} width={shelf.w - 10} height={26} style={f("ground")} opacity={0.6} />
            {Array.from({ length: 9 }, (_, i) => {
              const hues: HueName[] = ["coral", "cornflower", "amber", "mint", "violet", "pink", "teal", "citron", "rose"];
              return (
                <Hue key={i} hue={hues[(i + row * 4) % hues.length]!}>
                  <rect x={shelf.x + 8 + i * 9.4} y={WALL - 44 + row * 32 + ((i * 7 + row) % 3) * 2} width={7} height={24 - ((i * 7 + row) % 3) * 2} rx={1} style={f(i % 3 ? "accent-fill" : "accent")} />
                </Hue>
              );
            })}
          </g>
        ))}
      </g>
      <Hue hue="coral">
        <ellipse cx={bean.x + bean.w / 2} cy={bean.y + bean.h / 2 + 4} rx={bean.w / 2 + 2} ry={bean.h / 2} style={f("accent")} opacity={0.85} />
        <ellipse cx={bean.x + bean.w / 2 - 6} cy={bean.y + bean.h / 2 - 2} rx={12} ry={7} style={f("accent-fill")} />
      </Hue>
      <Plant x={18} y={128} s={1.15} />
      <Plant x={364} y={270} s={0.95} hue="clover" />
      <Plant x={meeting.x + 26} y={110} s={0.9} />
      <Plant x={meeting.x + meeting.w - 26} y={110} s={0.9} hue="jade" />
      {/* a floor lamp */}
      <g>
        <rect x={252} y={112} width={3} height={60} style={f("raised")} />
        <Hue hue="honey">
          <path d="M240 112 L268 112 L262 96 L246 96 Z" style={f("accent")} />
          <ellipse cx={254} cy={180} rx={22} ry={8} style={f("accent-wash")} />
        </Hue>
        <ellipse cx={254} cy={172} rx={9} ry={3} style={f("raised")} />
      </g>

      {/* the kitchen: the counter and what is on it, the fridge, the water cooler, the vending machine */}
      <rect x={counter.x} y={counter.y - 10} width={counter.w} height={counter.h + 10} rx={4} style={f("wood")} />
      <rect x={counter.x} y={counter.y - 10} width={counter.w} height={8} rx={3} style={f("fill-2")} />
      <rect x={counter.x + 120} y={counter.y - 6} width={34} height={14} rx={3} style={f("ground")} opacity={0.6} />
      <g>
        <rect x={counter.x + 40} y={counter.y - 34} width={30} height={34} rx={4} style={f("card")} />
        <Hue hue="apricot">
          <circle cx={counter.x + 55} cy={counter.y - 24} r={4} style={f("accent")} className="orbs-floor-blink" />
        </Hue>
        <rect x={counter.x + 49} y={counter.y - 12} width={12} height={10} rx={2} style={f("text-2")} />
      </g>
      <Hue hue="mint">
        <rect x={counter.x + 180} y={counter.y - 22} width={22} height={18} rx={4} style={f("accent")} />
      </Hue>
      <g>
        <rect x={fridge.x} y={fridge.y - 40} width={fridge.w} height={fridge.h + 40} rx={6} style={f("text-3")} opacity={0.85} />
        <rect x={fridge.x + 3} y={fridge.y - 6} width={fridge.w - 6} height={2} style={f("ground")} opacity={0.4} />
        <rect x={fridge.x + fridge.w - 10} y={fridge.y - 28} width={3} height={14} rx={1.5} style={f("ground")} opacity={0.5} />
        <rect x={fridge.x + fridge.w - 10} y={fridge.y + 6} width={3} height={18} rx={1.5} style={f("ground")} opacity={0.5} />
        <Hue hue="pink">
          <circle cx={fridge.x + 14} cy={fridge.y - 26} r={4} style={f("accent")} />
        </Hue>
        <Hue hue="citron">
          <rect x={fridge.x + 22} y={fridge.y - 30} width={8} height={8} rx={1} style={f("accent")} transform={`rotate(8 ${fridge.x + 26} ${fridge.y - 26})`} />
        </Hue>
      </g>
      <g>
        <rect x={cooler.x + 4} y={cooler.y + 8} width={cooler.w - 8} height={cooler.h - 8} rx={4} style={f("text-3")} opacity={0.85} />
        <Hue hue="cyan">
          <rect x={cooler.x + 6} y={cooler.y - 24} width={cooler.w - 12} height={32} rx={10} style={f("accent")} opacity={0.7} />
          <rect x={cooler.x + 9} y={cooler.y - 18} width={5} height={20} rx={2.5} style={f("accent-fill")} />
        </Hue>
      </g>
      <Hue hue="pink">
        <rect x={vending.x} y={vending.y - 30} width={vending.w} height={vending.h + 30} rx={5} style={f("accent")} opacity={0.85} />
        <rect x={vending.x + 4} y={vending.y - 24} width={vending.w - 12} height={vending.h - 4} rx={2} style={f("ground")} opacity={0.75} />
      </Hue>
      {Array.from({ length: 12 }, (_, i) => {
        const hues: HueName[] = ["amber", "mint", "cornflower", "coral"];
        return (
          <Hue key={i} hue={hues[i % 4]!}>
            <rect x={vending.x + 7 + (i % 3) * 8} y={vending.y - 20 + Math.floor(i / 3) * 16} width={5} height={10} rx={1} style={f("accent")} />
          </Hue>
        );
      })}
      <Plant x={kitchen.x + 24} y={270} s={0.9} hue="clover" />

      {/* the departments: a partition each, and what stands on it */}
      {ZONES.map((z) => (
        <g key={z.id}>
          <Partition r={z.rect} door={z.door} hue={z.hue} />
          <Fixture id={z.id} r={z.rect} />
        </g>
      ))}
      <LowRooms />
      {/* the server rack in Build, its lights blinking */}
      <g>
        <rect x={rack.x} y={rack.y - 16} width={rack.w} height={rack.h + 16} rx={3} style={f("ground")} />
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect x={rack.x + 3} y={rack.y - 12 + i * 13} width={rack.w - 6} height={10} rx={1.5} style={f("raised")} />
            <Hue hue={i % 2 ? "mint" : "cornflower"}>
              <circle cx={rack.x + rack.w - 7} cy={rack.y - 7 + i * 13} r={1.6} style={f("accent")} className="orbs-floor-blink" />
            </Hue>
          </g>
        ))}
      </g>
      {/* the arcade cabinet in the games corner */}
      <g>
        <rect x={arcade.x} y={arcade.y - 24} width={arcade.w} height={arcade.h + 24} rx={5} style={f("raised")} />
        <Hue hue="violet">
          <rect x={arcade.x + 5} y={arcade.y - 18} width={arcade.w - 10} height={30} rx={3} style={f("accent")} className="orbs-floor-glow" />
        </Hue>
        <rect x={arcade.x + 4} y={arcade.y + 18} width={arcade.w - 8} height={10} rx={2} style={f("card")} />
        <Hue hue="rose">
          <circle cx={arcade.x + 16} cy={arcade.y + 23} r={3} style={f("accent")} />
        </Hue>
        <Hue hue="citron">
          <circle cx={arcade.x + 30} cy={arcade.y + 23} r={2.5} style={f("accent")} />
        </Hue>
      </g>
      {/* plants in the aisles */}
      {POIS.filter((p) => p.id.startsWith("plant")).map((p, i) => (
        <Plant key={p.id} x={p.approach.x} y={p.approach.y - 30} s={1.05} hue={(["leaf", "jade", "clover"] as HueName[])[i]!} />
      ))}
      {/* the chairs behind the desks */}
      {DESKS.map((d) => (
        <g key={`${d.zone}${d.n}`}>
          <rect x={d.seat.x - 15} y={d.rect.y - 22} width={30} height={26} rx={8} style={f("raised")} />
          <rect x={d.seat.x - 12} y={d.rect.y - 19} width={24} height={6} rx={3} style={f("fill-2")} />
        </g>
      ))}
      {/* the meeting table's chairs on its far side */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={PIECES.meetingTable.x + 26 + i * 62} y={PIECES.meetingTable.y - 20} width={28} height={24} rx={8} style={f("raised")} />
      ))}
    </svg>
  );
}

/** A piece drawn on its own: its box on the plan, a little taller for what stands on it. */
function Piece({ r, up = 0, z, children, label }: { r: Rect; up?: number; z: number; children: ReactNode; label?: string }) {
  return (
    <svg
      aria-hidden={!label}
      aria-label={label}
      viewBox={`${r.x - 6} ${r.y - up} ${r.w + 12} ${r.h + up + 6}`}
      style={{ position: "absolute", left: `${((r.x - 6) / W) * 100}%`, top: `${((r.y - up) / H) * 100}%`, width: `${((r.w + 12) / W) * 100}%`, height: `${((r.h + up + 6) / H) * 100}%`, zIndex: z, pointerEvents: "none", overflow: "visible" }}
    >
      {children}
    </svg>
  );
}

export type Screen = "work" | "think" | "wait" | "gym" | "idle" | "off";

/** A desk: its top, its front, a monitor showing what its orb is doing, a keyboard, a mug. */
export function DeskPiece({ d, screen, hue }: { d: Desk; screen: Screen; hue: HueName | null }) {
  const r = d.rect;
  const mx = d.monitor === "left" ? r.x + 6 : r.x + r.w - 40;
  return (
    <Piece r={r} up={34} z={r.y + r.h}>
      {/* the top and its front */}
      <rect x={r.x} y={r.y} width={r.w} height={r.h - 10} rx={4} style={f("wood")} />
      <rect x={r.x} y={r.y} width={r.w} height={3} rx={1.5} style={f("fill-2")} />
      <rect x={r.x} y={r.y + r.h - 12} width={r.w} height={12} rx={3} style={f("wood")} opacity={0.82} />
      <rect x={r.x + 4} y={r.y + r.h} width={4} height={6} style={f("wood")} />
      <rect x={r.x + r.w - 8} y={r.y + r.h} width={4} height={6} style={f("wood")} />
      {/* the monitor */}
      <rect x={mx + 15} y={r.y + 2} width={4} height={8} style={f("ground")} />
      <rect x={mx + 9} y={r.y + 8} width={16} height={3} rx={1.5} style={f("ground")} />
      <rect x={mx} y={r.y - 30} width={34} height={34} rx={4} style={f("ground")} />
      <g data-orb={hue ?? undefined}>
        {screen === "off" ? (
          <rect x={mx + 3} y={r.y - 27} width={28} height={26} rx={2} style={f("card")} />
        ) : (
          <>
            <rect x={mx + 3} y={r.y - 27} width={28} height={26} rx={2} style={f(screen === "idle" ? "fill-2" : "accent-fill")} />
            {screen === "work" &&
              [0, 1, 2, 3, 4].map((i) => (
                <rect key={i} x={mx + 6 + (i % 2) * 4} y={r.y - 24 + i * 5} width={[16, 10, 18, 8, 14][i]!} height={2.4} rx={1.2} style={f("accent")} className="orbs-floor-type" />
              ))}
            {screen === "think" && [0, 1, 2].map((i) => <circle key={i} cx={mx + 10 + i * 7} cy={r.y - 14} r={2.2} style={{ ...f("accent"), animationDelay: `${i * 0.2}s` }} className="orbs-floor-dots" />)}
            {screen === "gym" && [0, 1, 2, 3].map((i) => <rect key={i} x={mx + 7 + i * 6} y={r.y - 6 - [8, 13, 18, 22][i]!} width={4} height={[8, 13, 18, 22][i]!} rx={1} style={f("accent")} />)}
            {screen === "idle" && <circle cx={mx + 17} cy={r.y - 14} r={4} style={f("accent")} opacity={0.6} className="orbs-floor-drift" />}
          </>
        )}
        {screen === "wait" && (
          <g>
            <rect x={mx + 3} y={r.y - 27} width={28} height={26} rx={2} style={f("alert")} opacity={0.35} />
            <rect x={mx + 15.5} y={r.y - 23} width={3} height={11} rx={1.5} style={f("alert")} />
            <circle cx={mx + 17} cy={r.y - 7} r={1.8} style={f("alert")} />
          </g>
        )}
      </g>
      {/* a keyboard and a mug (or a plant) */}
      <rect x={r.x + r.w / 2 - 16} y={r.y + 8} width={32} height={8} rx={2} style={f("card")} />
      {d.n % 2 ? (
        <g>
          <rect x={d.monitor === "left" ? r.x + r.w - 20 : r.x + 8} y={r.y + 5} width={10} height={11} rx={2.5} style={f("text-2")} />
          <rect x={d.monitor === "left" ? r.x + r.w - 11 : r.x + 17} y={r.y + 7} width={3.5} height={6} rx={1.75} style={st("text-2", 1.5)} />
        </g>
      ) : (
        <g data-orb="leaf">
          <circle cx={d.monitor === "left" ? r.x + r.w - 14 : r.x + 14} cy={r.y + 6} r={6} style={f("accent")} />
          <rect x={d.monitor === "left" ? r.x + r.w - 19 : r.x + 9} y={r.y + 8} width={10} height={8} rx={2} style={f("card")} />
        </g>
      )}
    </Piece>
  );
}

export function MeetingTable() {
  const r = PIECES.meetingTable;
  return (
    <Piece r={r} up={4} z={r.y + r.h}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h - 12} rx={12} style={f("wood")} />
      <rect x={r.x} y={r.y} width={r.w} height={3} rx={1.5} style={f("fill-2")} />
      <rect x={r.x} y={r.y + r.h - 14} width={r.w} height={14} rx={6} style={f("wood")} opacity={0.82} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={r.x + 30 + i * 62} y={r.y + 10} width={22} height={14} rx={2} style={f("text-2")} opacity={0.75} transform={`rotate(${(i % 2 ? 1 : -1) * 6} ${r.x + 41 + i * 62} ${r.y + 17})`} />
      ))}
      <g data-orb="teal">
        <circle cx={r.x + r.w / 2} cy={r.y + 20} r={7} style={f("accent")} opacity={0.6} />
      </g>
    </Piece>
  );
}

export function PingPong({ rally }: { rally: boolean }) {
  const r = PIECES.pingpong;
  return (
    <Piece r={r} up={10} z={r.y + r.h}>
      <rect x={r.x + 8} y={r.y + r.h - 10} width={5} height={14} style={f("wood")} />
      <rect x={r.x + r.w - 13} y={r.y + r.h - 10} width={5} height={14} style={f("wood")} />
      <g data-orb="jade">
        <rect x={r.x} y={r.y} width={r.w} height={r.h - 12} rx={4} style={f("accent")} />
      </g>
      <rect x={r.x + 3} y={r.y + 3} width={r.w - 6} height={r.h - 18} rx={2} style={st("text-1", 1.5)} opacity={0.8} />
      <rect x={r.x + r.w / 2 - 1} y={r.y - 6} width={2} height={r.h - 6} style={f("text-1")} opacity={0.9} />
      <rect x={r.x} y={r.y + r.h - 12} width={r.w} height={6} rx={2} style={f("card")} />
      {rally && <circle cx={r.x + 18} cy={r.y + 14} r={3.4} style={f("text-1")} className="orbs-floor-ball" />}
    </Piece>
  );
}

/** The classroom's desks, the lectern by its board and the library's reading table: what an orb sits or stands behind. */
export function RoomPieces() {
  const l = PIECES.lectern;
  const t = PIECES.readingTable;
  return (
    <>
      {CLASS_DESKS.map((d, i) => (
        <Piece key={i} r={d.rect} up={4} z={d.rect.y + d.rect.h}>
          <rect x={d.rect.x} y={d.rect.y} width={d.rect.w} height={d.rect.h - 8} rx={3} style={f("wood")} />
          <rect x={d.rect.x} y={d.rect.y + d.rect.h - 10} width={d.rect.w} height={10} rx={3} style={f("wood")} opacity={0.82} />
          <rect x={d.rect.x + 10} y={d.rect.y + 3} width={16} height={11} rx={1.5} style={f("text-2")} opacity={0.8} transform={`rotate(${i % 2 ? 5 : -4} ${d.rect.x + 18} ${d.rect.y + 8})`} />
          <g data-orb={(["violet", "coral", "mint"] as HueName[])[i % 3]}>
            <rect x={d.rect.x + 34} y={d.rect.y + 5} width={12} height={3} rx={1.5} style={f("accent")} />
          </g>
        </Piece>
      ))}
      <Piece r={l} up={12} z={l.y + l.h}>
        <path d={`M${l.x + 2} ${l.y} L${l.x + l.w - 2} ${l.y} L${l.x + l.w - 6} ${l.y + l.h} L${l.x + 6} ${l.y + l.h} Z`} style={f("wood")} />
        <rect x={l.x - 2} y={l.y - 6} width={l.w + 4} height={8} rx={2} style={f("wood")} opacity={0.9} />
        <rect x={l.x + 8} y={l.y - 9} width={18} height={5} rx={1} style={f("text-2")} />
      </Piece>
      <Piece r={t} up={16} z={t.y + t.h}>
        <rect x={t.x} y={t.y} width={t.w} height={t.h - 10} rx={6} style={f("wood")} />
        <rect x={t.x} y={t.y + t.h - 12} width={t.w} height={12} rx={4} style={f("wood")} opacity={0.82} />
        <rect x={t.x + 14} y={t.y + 6} width={22} height={14} rx={1.5} style={f("text-2")} opacity={0.85} transform={`rotate(-6 ${t.x + 25} ${t.y + 13})`} />
        <rect x={t.x + 70} y={t.y + 6} width={22} height={14} rx={1.5} style={f("text-2")} opacity={0.85} transform={`rotate(5 ${t.x + 81} ${t.y + 13})`} />
        {/* a reading lamp */}
        <rect x={t.x + t.w / 2 - 1.5} y={t.y - 12} width={3} height={18} style={f("raised")} />
        <g data-orb="honey">
          <path d={`M${t.x + t.w / 2 - 10} ${t.y - 12} L${t.x + t.w / 2 + 10} ${t.y - 12} L${t.x + t.w / 2 + 6} ${t.y - 22} L${t.x + t.w / 2 - 6} ${t.y - 22} Z`} style={f("accent")} />
          <ellipse cx={t.x + t.w / 2} cy={t.y + 4} rx={16} ry={5} style={f("accent-wash")} />
        </g>
      </Piece>
    </>
  );
}

/** The bottom row (owner, 10-08): the gym, the classroom, the library and the interview room, each walled, its door on
 * the second hallway; what an orb sits or stands behind is drawn on its own (RoomPieces). */
function LowRooms() {
  const room = (id: Place["id"]): Place => ROOMS.find((r) => r.id === id)!;
  const gym = room("gym").rect;
  const cls = room("classroom").rect;
  const lib = room("library").rect;
  const iv = room("interview").rect;
  const { tread1, tread2, bench, weights, shelfL, shelfR, armchair, interviewTable: table } = PIECES;
  return (
    <g data-low-rooms>
      {/* their floors */}
      <Hue hue="coral">
        <rect x={gym.x} y={LOW} width={gym.w} height={gym.h} style={f("accent-wash")} opacity={0.6} />
      </Hue>
      <Hue hue="amber">
        <rect x={lib.x + 70} y={LOW + 96} width={154} height={104} rx={14} style={f("accent-wash")} />
        <rect x={lib.x + 76} y={LOW + 102} width={142} height={92} rx={11} style={st("accent-fill", 2)} />
      </Hue>
      <Hue hue="teal">
        <rect x={iv.x} y={LOW} width={iv.w} height={iv.h} style={f("accent-wash")} opacity={0.5} />
      </Hue>
      {/* the walls between them, and the floor's near edge */}
      {[gym, cls, lib].map((r) => (
        <g key={r.x}>
          <rect x={r.x + r.w} y={LOW} width={12} height={H - LOW} style={f("wall")} />
          <rect x={r.x + r.w + 4} y={LOW} width={4} height={H - LOW} style={f("fill-2")} opacity={0.6} />
        </g>
      ))}
      <rect y={H - 8} width={W} height={8} style={f("wall")} />
      {/* each room's wall on the hallway, a door in it */}
      {ROOMS.filter((r) => r.wall === LOW).map((r) =>
        [
          { x: r.rect.x, w: r.door.x - r.rect.x },
          { x: r.door.x + r.door.w, w: r.rect.x + r.rect.w - r.door.x - r.door.w },
        ].map((p, i) => (
          <g key={`${r.id}${i}`}>
            <rect x={p.x} y={LOW - 4} width={p.w} height={14} rx={3} style={f("wall")} />
            <rect x={p.x} y={LOW - 4} width={p.w} height={4} rx={2} style={f("fill-2")} />
          </g>
        )),
      )}

      {/* the gym: two treadmills, the mat, a bench, the weights and a mirror */}
      {[tread1, tread2].map((t) => (
        <g key={t.x}>
          <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={6} style={f("raised")} />
          <rect x={t.x + 5} y={t.y + 16} width={t.w - 10} height={t.h - 22} rx={3} style={f("ground")} opacity={0.75} />
          <rect x={t.x + 3} y={t.y - 14} width={4} height={18} style={f("text-3")} />
          <rect x={t.x + t.w - 7} y={t.y - 14} width={4} height={18} style={f("text-3")} />
          <rect x={t.x + 2} y={t.y - 20} width={t.w - 4} height={10} rx={3} style={f("card")} />
          <Hue hue="coral">
            <rect x={t.x + t.w / 2 - 7} y={t.y - 18} width={14} height={6} rx={1.5} style={f("accent")} className="orbs-floor-blink" />
          </Hue>
        </g>
      ))}
      <Hue hue="mint">
        <rect x={104} y={LOW + 150} width={104} height={38} rx={8} style={f("accent-fill")} />
        <rect x={110} y={LOW + 154} width={92} height={30} rx={6} style={st("accent", 1.5)} opacity={0.6} />
      </Hue>
      <rect x={bench.x + 6} y={bench.y + bench.h - 6} width={5} height={10} style={f("text-3")} />
      <rect x={bench.x + bench.w - 11} y={bench.y + bench.h - 6} width={5} height={10} style={f("text-3")} />
      <Hue hue="coral">
        <rect x={bench.x} y={bench.y} width={bench.w} height={bench.h - 6} rx={8} style={f("accent")} />
        <rect x={bench.x + 4} y={bench.y + 3} width={bench.w - 8} height={5} rx={2.5} style={f("accent-fill")} />
      </Hue>
      <rect x={weights.x} y={weights.y} width={weights.w} height={weights.h} rx={4} style={f("raised")} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={weights.x + 8} y={weights.y + 6 + i * 11} width={weights.w - 16} height={3} rx={1.5} style={f("text-3")} />
          <circle cx={weights.x + 9} cy={weights.y + 7.5 + i * 11} r={4.5 - i * 0.6} style={f("ground")} />
          <circle cx={weights.x + weights.w - 9} cy={weights.y + 7.5 + i * 11} r={4.5 - i * 0.6} style={f("ground")} />
        </g>
      ))}
      <Plant x={gym.x + gym.w - 22} y={LOW + 206} s={0.85} hue="jade" />

      {/* the classroom: the board by its door, the desks' chairs, a globe */}
      <rect x={cls.x + 200} y={LOW + 8} width={84} height={44} rx={4} style={f("raised")} />
      <rect x={cls.x + 204} y={LOW + 12} width={76} height={36} rx={2} style={f("text-2")} />
      <Hue hue="violet">
        <path d={`M${cls.x + 212} ${LOW + 22} h26 M${cls.x + 212} ${LOW + 30} h40 M${cls.x + 212} ${LOW + 38} h18`} style={st("accent", 2)} />
        <circle cx={cls.x + 262} cy={LOW + 26} r={7} style={st("accent", 1.8)} />
      </Hue>
      {CLASS_DESKS.map((d, i) => (
        <g key={i}>
          <rect x={d.seat.x - 13} y={d.rect.y - 20} width={26} height={22} rx={7} style={f("raised")} />
          <rect x={d.seat.x - 10} y={d.rect.y - 17} width={20} height={5} rx={2.5} style={f("fill-2")} />
        </g>
      ))}
      <g transform={`translate(${cls.x + 34} ${LOW + 40})`}>
        <rect x={-2} y={10} width={4} height={12} style={f("raised")} />
        <ellipse cx={0} cy={23} rx={9} ry={3} style={f("raised")} />
        <Hue hue="cornflower">
          <circle r={11} style={f("accent")} />
        </Hue>
        <Hue hue="leaf">
          <path d="M-7 -4 q4 -4 8 0 q2 4 -2 6 q-5 1 -6 -6 Z M3 3 q4 -1 5 3 q-3 3 -5 -3 Z" style={f("accent")} />
        </Hue>
      </g>

      {/* the library: two shelves, the reading table's chairs, the armchair, a plant */}
      {[shelfL, shelfR].map((sh, k) => (
        <g key={sh.x}>
          <rect x={sh.x} y={LOW + 2} width={sh.w} height={sh.y + sh.h - LOW - 2} rx={4} style={f("wood")} />
          {[0, 1].map((row) => (
            <g key={row}>
              <rect x={sh.x + 5} y={LOW + 6 + row * 19} width={sh.w - 10} height={15} style={f("ground")} opacity={0.6} />
              {Array.from({ length: 8 }, (_, i) => {
                const hues: HueName[] = ["amber", "coral", "cornflower", "violet", "mint", "rose", "teal", "citron"];
                return (
                  <Hue key={i} hue={hues[(i + row * 3 + k * 5) % hues.length]!}>
                    <rect x={sh.x + 8 + i * 9.4} y={LOW + 7 + row * 19 + ((i * 5 + row + k) % 3)} width={7} height={13 - ((i * 5 + row + k) % 3)} rx={1} style={f(i % 3 ? "accent-fill" : "accent")} />
                  </Hue>
                );
              })}
            </g>
          ))}
        </g>
      ))}
      {[PIECES.readingTable.x + 30, PIECES.readingTable.x + 86].map((x) => (
        <rect key={x} x={x - 14} y={PIECES.readingTable.y - 20} width={28} height={24} rx={8} style={f("raised")} />
      ))}
      <Hue hue="amber">
        <rect x={armchair.x} y={armchair.y - 12} width={armchair.w} height={28} rx={10} style={f("accent")} opacity={0.8} />
        <rect x={armchair.x - 6} y={armchair.y} width={14} height={armchair.h - 4} rx={6} style={f("accent")} />
        <rect x={armchair.x + armchair.w - 8} y={armchair.y} width={14} height={armchair.h - 4} rx={6} style={f("accent")} />
        <rect x={armchair.x + 6} y={armchair.y + 12} width={armchair.w - 12} height={armchair.h - 18} rx={6} style={f("accent-fill")} />
      </Hue>
      <Plant x={lib.x + 26} y={LOW + 200} s={0.95} hue="clover" />

      {/* the interview room: the table and the interviewer's chair, a jug of water, the chairs where applicants wait (its
          sign on the floor counts who applied) */}
      <rect x={table.x + 46} y={table.y - 22} width={28} height={24} rx={8} style={f("raised")} />
      <rect x={table.x} y={table.y} width={table.w} height={table.h - 10} rx={8} style={f("wood")} />
      <rect x={table.x} y={table.y + table.h - 12} width={table.w} height={12} rx={4} style={f("wood")} opacity={0.82} />
      <rect x={table.x + 20} y={table.y + 6} width={24} height={14} rx={1.5} style={f("text-2")} opacity={0.8} />
      <Hue hue="cyan">
        <rect x={table.x + 86} y={table.y - 2} width={12} height={18} rx={4} style={f("accent")} opacity={0.75} />
      </Hue>
      {WAITING.map((w, i) => (
        <g key={i}>
          <rect x={w.x - 16} y={w.y - 30} width={32} height={30} rx={8} style={f("raised")} />
          <rect x={w.x - 13} y={w.y - 27} width={26} height={6} rx={3} style={f("fill-2")} />
        </g>
      ))}
      <Plant x={iv.x + iv.w - 26} y={LOW + 120} s={0.95} />
    </g>
  );
}

export function SideTables() {
  const c = PIECES.coffeeTable;
  const b = PIECES.bistro;
  return (
    <>
      <Piece r={c} up={4} z={c.y + c.h}>
        <rect x={c.x} y={c.y} width={c.w} height={c.h - 8} rx={8} style={f("raised")} />
        <rect x={c.x} y={c.y + c.h - 10} width={c.w} height={10} rx={4} style={f("card")} />
        <rect x={c.x + 18} y={c.y + 5} width={20} height={13} rx={2} style={f("text-2")} opacity={0.7} transform={`rotate(-8 ${c.x + 28} ${c.y + 11})`} />
        <g data-orb="coral">
          <circle cx={c.x + 64} cy={c.y + 11} r={5} style={f("accent")} />
        </g>
      </Piece>
      <Piece r={b} up={4} z={b.y + b.h}>
        <rect x={b.x + b.w / 2 - 3} y={b.y + 16} width={6} height={b.h - 14} style={f("card")} />
        <ellipse cx={b.x + b.w / 2} cy={b.y + b.h - 2} rx={16} ry={4} style={f("card")} />
        <ellipse cx={b.x + b.w / 2} cy={b.y + 12} rx={b.w / 2} ry={13} style={f("raised")} />
        <ellipse cx={b.x + b.w / 2} cy={b.y + 10} rx={b.w / 2 - 4} ry={9} style={f("fill-2")} />
        <g data-orb="apricot">
          <circle cx={b.x + b.w / 2 - 8} cy={b.y + 9} r={4} style={f("accent")} />
        </g>
        <rect x={b.x + b.w / 2 + 4} y={b.y + 3} width={7} height={9} rx={2} style={f("text-2")} />
      </Piece>
    </>
  );
}

/** The floor's moving parts, in CSS: a screen being typed on, thinking dots, blinking lights, the
 * ping-pong rally. Stilled for anyone who asks for less motion. */
export const FLOOR_CSS = `
@keyframes orbs-floor-type { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }
.orbs-floor-type { animation: orbs-floor-type 1.1s ease-in-out infinite; }
.orbs-floor-type:nth-child(2n) { animation-delay: .35s } .orbs-floor-type:nth-child(3n) { animation-delay: .7s }
@keyframes orbs-floor-dots { 0%, 100% { opacity: .25; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-2px) } }
.orbs-floor-dots { animation: orbs-floor-dots 1.2s ease-in-out infinite; transform-box: fill-box; }
@keyframes orbs-floor-blink { 0%, 60%, 100% { opacity: 1 } 70% { opacity: .2 } }
.orbs-floor-blink { animation: orbs-floor-blink 2.4s steps(1) infinite; }
.orbs-floor-blink:nth-of-type(2n) { animation-duration: 3.1s }
@keyframes orbs-floor-twinkle { 0%, 100% { opacity: .3 } 50% { opacity: 1 } }
.orbs-floor-twinkle { animation: orbs-floor-twinkle 3s ease-in-out infinite; }
@keyframes orbs-floor-glow { 0%, 100% { opacity: .65 } 50% { opacity: 1 } }
.orbs-floor-glow { animation: orbs-floor-glow 1.6s ease-in-out infinite; }
@keyframes orbs-floor-drift { 0% { transform: translate(-6px, -4px) } 50% { transform: translate(6px, 5px) } 100% { transform: translate(-6px, -4px) } }
.orbs-floor-drift { animation: orbs-floor-drift 7s ease-in-out infinite; }
@keyframes orbs-floor-ball { 0% { transform: translate(0, 0) } 25% { transform: translate(62px, -10px) } 50% { transform: translate(124px, 6px) } 75% { transform: translate(62px, -12px) } 100% { transform: translate(0, 0) } }
.orbs-floor-ball { animation: orbs-floor-ball 1.4s linear infinite; }
@keyframes orbs-floor-pop { from { transform: translate(-50%, 4px) scale(.6); opacity: 0 } to { transform: translate(-50%, 0) scale(1); opacity: 1 } }
@keyframes orbs-floor-float { 0% { transform: translate(0, 0); opacity: 0 } 30% { opacity: 1 } 100% { transform: translate(6px, -14px); opacity: 0 } }
@media (prefers-reduced-motion: reduce) { [class^="orbs-floor-"] { animation: none !important; } }
`;
