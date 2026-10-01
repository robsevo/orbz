// The home: the one always-on process (PLAN 1.2). Node runs this TypeScript directly (type
// stripping), so there is no build step; `tsc` only checks it.
export { version } from "./version.ts";
export { type Clock, FakeClock, realClock, settle } from "./clock.ts";
export { HomeLockedError } from "./db.ts";
export { EventLog, type HomeEvent } from "./events.ts";
export { Home, type HomeOptions, defaultProtect } from "./home.ts";
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
