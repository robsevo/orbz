// Where you are in the app, as an address (owner, 2026-10-01: "back button on the side menu,
// that brings you to different tabs ... easily navigable"). Every place has a link of its own, so
// the side menu's Back, the browser's Back and a link someone sends all work alike:
//   #/home         the home page, what the app opens on (owner, 10-07: "a nice home page the app can default to")
//   #/office       the office floor            (nothing)    the home page
//   #/office/Ash   an orb in the office        #/new        a new orb, in the creator
//   #/settings     Settings
//   #/chat/Ash     a private chat with an orb (PLAN 2.10)
//   #/sessions     the sessions (PLAN 2.9)     #/session/3/floor   a session's tab
//   #/notices      the notification centre (PLAN 2.11)   #/calendar   the calendar (PLAN 2.12)
//   #/lab          the lab (PLAN 2.13)
//   #/org          the org chart (PLAN 5.6)   #/career/Ash   an orb's career page (PLAN 5.6)
//   #/org/school/kenji  the org chart, Kenji's school sheet open (PLAN 5.7; owner, 10-06: "we dont see the send to school option")
//   #/recruiter    the recruiter (PLAN 5.8)   #/recruiter/build   who applied to one department
//   #/stats/brain  the brains' tokens, as charts (PLAN 2.19)   #/stats/xp   the XP
//   #/desk         the desk's floor (PLAN 5.22)
// Rooms join this list as they are built (the lab 2.13, the calendar 2.12...).

export type Room = "office" | "settings";
export type Route =
  | { room: "home" }
  | { room: "office"; orb: string | null }
  | { room: "new" }
  | { room: "settings" }
  | { room: "chat"; orb: string }
  | { room: "sessions"; id: number | null; tab: "brainstorm" | "floor" }
  | { room: "notices" }
  | { room: "calendar" }
  | { room: "lab" }
  | { room: "report" }
  | { room: "stats"; tab: "brain" | "xp" }
  | { room: "org"; school?: string | null }
  | { room: "recruiter"; family?: string | null }
  | { room: "career"; orb: string }
  | { room: "desk" };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (parts[0] === "new") return { room: "new" };
  if (parts[0] === "settings") return { room: "settings" };
  if (parts[0] === "notices") return { room: "notices" };
  if (parts[0] === "calendar") return { room: "calendar" };
  if (parts[0] === "lab") return { room: "lab" };
  if (parts[0] === "report") return { room: "report" };
  if (parts[0] === "stats") return { room: "stats", tab: parts[1] === "xp" ? "xp" : "brain" };
  if (parts[0] === "org") return parts[1] === "school" && parts[2] ? { room: "org", school: parts[2] } : { room: "org" };
  if (parts[0] === "recruiter") return { room: "recruiter", family: parts[1] ?? null };
  if (parts[0] === "career" && parts[1]) return { room: "career", orb: parts[1] };
  if (parts[0] === "desk") return { room: "desk" };
  if (parts[0] === "chat" && parts[1]) return { room: "chat", orb: parts[1] };
  if (parts[0] === "sessions") return { room: "sessions", id: null, tab: "brainstorm" };
  if (parts[0] === "session" && /^\d+$/.test(parts[1] ?? "")) return { room: "sessions", id: Number(parts[1]), tab: parts[2] === "floor" ? "floor" : "brainstorm" };
  if (parts[0] === "office") return { room: "office", orb: parts[1] ?? null };
  return { room: "home" };
}

export function routeHash(r: Route): string {
  if (r.room === "home") return "#/home";
  if (r.room === "new") return "#/new";
  if (r.room === "settings") return "#/settings";
  if (r.room === "notices") return "#/notices";
  if (r.room === "calendar") return "#/calendar";
  if (r.room === "lab") return "#/lab";
  if (r.room === "report") return "#/report";
  if (r.room === "stats") return `#/stats/${r.tab}`;
  if (r.room === "org") return r.school ? `#/org/school/${encodeURIComponent(r.school)}` : "#/org";
  if (r.room === "recruiter") return r.family ? `#/recruiter/${encodeURIComponent(r.family)}` : "#/recruiter";
  if (r.room === "career") return `#/career/${encodeURIComponent(r.orb)}`;
  if (r.room === "desk") return "#/desk";
  if (r.room === "chat") return `#/chat/${encodeURIComponent(r.orb)}`;
  if (r.room === "sessions") return r.id === null ? "#/sessions" : `#/session/${r.id}/${r.tab}`;
  return r.orb ? `#/office/${encodeURIComponent(r.orb)}` : "#/office";
}
