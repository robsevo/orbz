// The game studio's career paths (owner, 10-18: "make the game dev jobs and career paths more intricate. games will be
// huge, to industry standards"). Every studio job climbs the home's six levels (gym/levels.ts: Junior, Mid, Senior,
// Staff, Principal, Chief; only the person promotes), and each level here has the title a games studio gives it and
// what that rung owns: a Junior Level Designer builds encounters from a lead's layout, a Lead runs the level team on a
// game, the Design Director owns how every game in the studio plays. A studio says Lead where a tech company says Staff,
// and its directors sit where the office's Chief does. Each job also says where it can lead across the studio (a
// gameplay programmer into AI or design, a QA tester into production, a producer to running the studio), and back into
// the office where the studio's work meets it. Pure: Career.tsx and the studio's Team tab read it, test/careers.test.ts
// holds it to the roster.
import { SPECIALTIES } from "./spec.ts";

/** The home's levels, in order (gym/levels.ts). */
export const LEVELS = ["Junior", "Mid", "Senior", "Staff", "Principal", "Chief"] as const;
export type Level = (typeof LEVELS)[number];
type Six = readonly [string, string, string, string, string, string];

/** A track: the disciplines that climb alike, what each rung owns there. */
export type TrackId = "design" | "engineering" | "art" | "animation" | "audio" | "production" | "quality" | "liveops" | "community" | "direction" | "studio" | "indie";
export const TRACKS: Record<TrackId, { name: string; scope: Six }> = {
  design: {
    name: "Design",
    scope: [
      "Builds features from a lead's design: a mechanic, a level's encounters, a table of numbers, every change reviewed.",
      "Owns a feature from the page to playable: its design doc, its prototype, its tuning after playtests.",
      "Owns a whole system or area of the game, and teaches the juniors on it how the game is meant to feel.",
      "Leads the discipline's team on one game: what gets built, the reviews, the bar every feature has to clear.",
      "Sets how the discipline works across the studio's games, and takes the problems no one else can crack.",
      "Owns the discipline's vision and its people across every game, and answers for how they play.",
    ],
  },
  engineering: {
    name: "Engineering",
    scope: [
      "Fixes bugs and builds small features in one part of the code, every change reviewed.",
      "Owns features end to end in its area: the code, its tests, its performance on every platform.",
      "Owns a whole system (a renderer, a netcode layer, the player controller) and reviews the others' code in it.",
      "Leads the discipline's programmers on one game: the architecture, the frame and memory budgets, the reviews.",
      "Sets the studio's technical standards, takes the hardest technical problems, and decides what the engine becomes.",
      "Owns the technology of every game the studio makes, its engine, its pipelines and its programmers.",
    ],
  },
  art: {
    name: "Art",
    scope: [
      "Makes assets to a brief and a style guide: props, textures, studies, every one critiqued.",
      "Owns assets from the first sketch to in the game, within its budgets of polygons and memory.",
      "Owns a set or a character line, and keeps its look true to the art direction; critiques the juniors.",
      "Leads the discipline's artists on one game: the style guide, the reviews, the schedule of what gets made.",
      "Sets the look of a game or a franchise's visual language, and solves its hardest pieces.",
      "Owns how every game in the studio looks, and the artists who make it.",
    ],
  },
  animation: {
    name: "Animation",
    scope: [
      "Animates to a brief: cycles, idles, motion-capture clean-up, each shot reviewed.",
      "Owns a character's or a feature's animation set, put into the game and tuned for feel.",
      "Owns how the player character moves, its blends and its timing, with the gameplay programmers.",
      "Leads the animators on one game: the style, the rigs' needs, the shoot list for the motion-capture stage.",
      "Sets the studio's animation standards, the motion-matching or the stylised look its games share.",
      "Owns how everything in the studio's games moves, and its animators.",
    ],
  },
  audio: {
    name: "Audio",
    scope: [
      "Makes sounds or cues to a brief, put into the game with the audio middleware, each one reviewed.",
      "Owns a feature's audio from the recording to the mix in the game.",
      "Owns an area's soundscape or a game's score themes, and mentors the juniors.",
      "Leads the audio team on one game: the sound's direction, the mix, the recording sessions.",
      "Sets how the studio's games sound and the tools its audio is made with.",
      "Owns the sound and music of every game in the studio, and its audio team.",
    ],
  },
  production: {
    name: "Production",
    scope: [
      "Keeps one team's board, its meetings and its builds moving, and says early what is slipping.",
      "Owns a team's schedule and scope: the milestones, the risks, what is cut and when.",
      "Owns several teams' delivery on one game, and the dependencies between them.",
      "Owns the whole game's development: every discipline's plan, the budget, the milestones to the publisher.",
      "Owns a game or a franchise as a business: the money, the partners, the date it ships.",
      "Owns production across the studio: which games are made, by whom, on what budget and when.",
    ],
  },
  quality: {
    name: "Quality",
    scope: [
      "Plays the build to a test plan and writes bugs anyone can reproduce.",
      "Owns a feature's testing: its test cases, its regressions, the compatibility passes.",
      "Owns a game's test strategy for an area, automation where it pays, and certification's checklists.",
      "Leads the testers on one game: the plan, triage with the leads, what blocks a release.",
      "Runs quality for several games: the team, the tools, the bar a build must clear to ship.",
      "Owns quality across the studio: what every game is tested against before a player sees it.",
    ],
  },
  liveops: {
    name: "Live ops",
    scope: [
      "Sets up events and offers from the calendar, and checks they went live right.",
      "Owns a season's events: their content, their timing, what the players' data says after.",
      "Owns the live calendar for a game and the plan for each update, with design and community.",
      "Leads live operations for a game: its roadmap after launch, its revenue and its players' trust.",
      "Runs live operations for several games, and how the studio plans a game to live for years.",
      "Owns every live game in the studio: its services, its seasons, its players after launch.",
    ],
  },
  community: {
    name: "Community",
    scope: [
      "Posts and moderates on the game's Discord and socials, and passes on what players say.",
      "Owns a game's channels: patch notes, events, the tone of every announcement.",
      "Owns the community's plan for a launch or a season, and brings its feedback to the team every week.",
      "Leads the community team: creators, moderation, the community's voice in every planning meeting.",
      "Owns the community across the studio's games and the studio's own voice.",
      "Owns how players feel about every game the studio makes, from first trailer to the last patch.",
    ],
  },
  direction: {
    name: "Direction",
    scope: [
      "Helps a game director: runs reviews, keeps the pillars, decides the smaller calls.",
      "Owns a game's vision for an area or a mode, every discipline's work there pulling the same way.",
      "Owns one game's vision from pitch to launch: its pillars, what makes it fun, what gets cut.",
      "Directs a large game across its teams, or more than one game at once.",
      "Owns the creative direction of a franchise, every game in it.",
      "Owns the creative direction of everything the studio makes.",
    ],
  },
  studio: {
    name: "Studio",
    scope: [
      "Runs the studio's day to day: its hiring, its tools, its calendar.",
      "Runs a team inside the studio: its people, its budget, its place on the slate.",
      "Runs the studio: its slate of games, who works on what, the budget and the milestones; answers to the CEO.",
      "Runs a larger studio, or two, and the leads under it.",
      "Owns the studio as a business inside the company: its profit, its partners, its reputation.",
      "Owns every studio the company has.",
    ],
  },
  indie: {
    name: "Indie",
    scope: [
      "Makes small games or prototypes alone, every part of them, each one shown for feedback.",
      "Makes a whole small game alone: its code, its levels, its feel, shipped.",
      "Makes games the others play: owns one end to end and helps the rest with theirs.",
      "Leads a small team through a whole game.",
      "Its games set what the studio's prototypes are measured against.",
      "Owns what a whole game is, from the first prototype to launch.",
    ],
  },
};

/** Each studio job: its track and the title at each level (Junior to Chief), and the jobs it can move into. */
type Path = { track: TrackId; titles: Six; leads: readonly string[] };
const climb = (role: string, top: string): Six => [`Junior ${role}`, role, `Senior ${role}`, `Lead ${role}`, `Principal ${role}`, top];
export const PATHS: Record<string, Path> = {
  // the indie's whole game, alone (the Game Maker, before the studio had jobs)
  games: { track: "indie", titles: climb("Game Developer", "Game Director"), leads: ["gamedirector", "gamedesign", "gameplay"] },
  studiohead: { track: "studio", titles: ["Studio Coordinator", "Studio Manager", "Studio Head", "Studio Director", "General Manager", "Head of Studios"], leads: ["ceo", "coo"] },
  gamedirector: { track: "direction", titles: ["Assistant Game Director", "Associate Game Director", "Game Director", "Senior Game Director", "Creative Director", "Chief Creative Officer"], leads: ["studiohead"] },
  gamedesign: { track: "design", titles: climb("Game Designer", "Design Director"), leads: ["systemsdesign", "leveldesign", "gamedirector", "producer"] },
  systemsdesign: { track: "design", titles: climb("Systems Designer", "Design Director"), leads: ["economy", "gamedesign", "gamedirector"] },
  leveldesign: { track: "design", titles: climb("Level Designer", "Design Director"), leads: ["gamedesign", "envart", "gamedirector"] },
  narrative: { track: "design", titles: climb("Narrative Designer", "Narrative Director"), leads: ["gamedirector", "gamedesign", "writing"] },
  economy: { track: "design", titles: climb("Economy Designer", "Design Director"), leads: ["liveops", "systemsdesign", "data"] },
  gameux: { track: "design", titles: climb("Game UX Designer", "UX Director"), leads: ["gamedesign", "producer", "design"] },
  gameplay: { track: "engineering", titles: climb("Gameplay Programmer", "Technical Director"), leads: ["gameai", "engine", "gamedesign", "tools"] },
  engine: { track: "engineering", titles: climb("Engine Programmer", "Technical Director"), leads: ["graphics", "netcode", "tools", "cto"] },
  graphics: { track: "engineering", titles: climb("Graphics Programmer", "Technical Director"), leads: ["techart", "engine"] },
  gameai: { track: "engineering", titles: climb("AI Programmer", "Technical Director"), leads: ["gameplay", "gamedesign"] },
  netcode: { track: "engineering", titles: climb("Network Programmer", "Technical Director"), leads: ["engine", "backend", "devops"] },
  tools: { track: "engineering", titles: climb("Tools Programmer", "Technical Director"), leads: ["techart", "engine", "devops"] },
  concept: { track: "art", titles: climb("Concept Artist", "Art Director"), leads: ["charart", "envart", "gamedirector"] },
  envart: { track: "art", titles: climb("Environment Artist", "Art Director"), leads: ["leveldesign", "techart", "concept"] },
  charart: { track: "art", titles: climb("Character Artist", "Art Director"), leads: ["techart", "animator", "concept"] },
  techart: { track: "art", titles: climb("Technical Artist", "Technical Art Director"), leads: ["graphics", "tools", "vfx", "animator"] },
  animator: { track: "animation", titles: climb("Animator", "Animation Director"), leads: ["techart", "gameplay", "vfx"] },
  vfx: { track: "art", titles: climb("VFX Artist", "Art Director"), leads: ["techart", "graphics"] },
  sounddesign: { track: "audio", titles: climb("Sound Designer", "Audio Director"), leads: ["composer", "producer"] },
  composer: { track: "audio", titles: climb("Composer", "Music Director"), leads: ["sounddesign"] },
  producer: { track: "production", titles: ["Associate Producer", "Producer", "Senior Producer", "Development Director", "Executive Producer", "Head of Production"], leads: ["gamedirector", "studiohead", "liveops"] },
  gameqa: { track: "quality", titles: ["QA Tester", "QA Analyst", "Senior QA Analyst", "QA Lead", "QA Manager", "Director of Quality"], leads: ["gamedesign", "producer", "testing", "tools"] },
  liveops: { track: "liveops", titles: ["Live Ops Coordinator", "Live Ops Manager", "Senior Live Ops Manager", "Live Ops Lead", "Head of Live Ops", "Director of Live Services"], leads: ["economy", "producer", "studiohead"] },
  community: { track: "community", titles: ["Community Coordinator", "Community Manager", "Senior Community Manager", "Community Lead", "Head of Community", "Director of Player Experience"], leads: ["liveops", "narrative", "producer"] },
};

/** A job's path, or null for one outside the studio (the office's jobs keep "Senior Data Analyst" plainly). */
export const pathOf = (specialty: string): Path | null => PATHS[specialty] ?? null;

/** What a job is called at a level: the studio's own title, else the level before the job's title. */
export function titleAt(specialty: string, level: string): string {
  const p = pathOf(specialty);
  const i = LEVELS.indexOf(level as Level);
  if (p && i >= 0) return p.titles[i]!;
  return `${level} ${SPECIALTIES[specialty as keyof typeof SPECIALTIES]?.title ?? specialty}`;
}

/** The whole ladder for a job: each rung's level, title and what it owns. */
export function ladderOf(specialty: string): { level: Level; title: string; scope: string }[] | null {
  const p = pathOf(specialty);
  if (!p) return null;
  return LEVELS.map((level, i) => ({ level, title: p.titles[i]!, scope: TRACKS[p.track].scope[i]! }));
}

/** Where a job can lead: each move's job and the title it would start at there, a level under the one it holds (a move
 * across is a step back to learn the new craft, as studios make it; a Junior stays a Junior). A move into the office
 * is its job's title alone: the office's ladders are the home's. */
export function movesOf(specialty: string, level: string): { specialty: string; title: string }[] {
  const p = pathOf(specialty);
  if (!p) return [];
  const at = Math.max(0, LEVELS.indexOf(level as Level) - 1);
  return p.leads.map((s) => ({ specialty: s, title: pathOf(s) ? titleAt(s, LEVELS[at]!) : (SPECIALTIES[s as keyof typeof SPECIALTIES]?.title ?? s) }));
}
