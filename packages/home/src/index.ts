// The home: the one always-on process (PLAN 1.2). Node runs this TypeScript directly (type
// stripping), so there is no build step; `tsc` only checks it.
export { version } from "./version.ts";
export { type Clock, FakeClock, realClock, settle } from "./clock.ts";
export { HomeLockedError } from "./db.ts";
export { EventLog, type HomeEvent } from "./events.ts";
export { DEFAULT_SPEND_CAP_USD, Home, type HomeOptions, defaultProtect } from "./home.ts";
export { type Habit, type HabitAnswer, HabitShelf, KitHabit, TsHabit } from "./brain/habits.ts";
export { type Fall, Ladder, type LadderAnswer, type LadderTask, NoBrainError, type Tier, trimHistory } from "./brain/ladder.ts";
export { BrainCallError, type ChatMessage, chat, type Completion, type Endpoint } from "./brain/openai.ts";
export { ASH_ROUTER_FREE_SEATS, ashRouter, local, oneKey, openRouter, type Preset, PresetError } from "./brain/presets.ts";
export { Spend, SpendCapError } from "./brain/spend.ts";
export { type Card, Conversations, type Message, type ModelMessage } from "./agent/conversation.ts";
export { AgentRunner, type AgentOptions } from "./agent/loop.ts";
export { Background, runTool, type ToolDef, type ToolResult, TOOLS } from "./agent/tools.ts";
export { script, trace } from "./agent/trace.ts";
export {
  Inboxes,
  type Item,
  type Orb,
  type OrbStatus,
  type RunContext,
  type RunResult,
  type Runner,
  type Source,
  UnknownOrbError,
} from "./inbox.ts";
export { hashFiles, type LoopDef, type LoopEntry, type LoopPlan, type LoopResult, Loops } from "./loops.ts";
export { type Schedule, Schedules, scheduleConversation } from "./schedule.ts";
export { type Trigger, type TriggerEvent, Triggers, type TriggerSource, triggerConversation } from "./triggers.ts";
export { serve, type HomeDoor } from "./api.ts";
export { CRASH_LOOP_RESTARTS, Kit, KitDiedError, KitDownError, type KitOptions, kitPython } from "./kit.ts";
