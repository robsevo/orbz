// Where you are in the app, as an address (owner, 2026-10-01: "back button on the side menu,
// that brings you to different tabs ... easily navigable"). Every place has a link of its own, so
// the side menu's Back, the browser's Back and a link someone sends all work alike:
//   #/office/Ash   an orb in the office        #/new        a new orb, in the creator
//   #/settings     Settings                    (nothing)    the office, its first orb
//   #/chat/Ash     a private chat with an orb (PLAN 2.10)
//   #/sessions     the sessions (PLAN 2.9)     #/session/3/floor   a session's tab
//   #/notices      the notification centre (PLAN 2.11)   #/calendar   the calendar (PLAN 2.12)
//   #/lab          the lab (PLAN 2.13)
//   #/org          the org chart (PLAN 5.6)   #/career/Ash   an orb's career page (PLAN 5.6)
// Rooms join this list as they are built (the lab 2.13, the calendar 2.12...).

export type Room = "office" | "settings";
export type Route =
  | { room: "office"; orb: string | null }
  | { room: "new" }
  | { room: "settings" }
  | { room: "chat"; orb: string }
  | { room: "sessions"; id: number | null; tab: "brainstorm" | "floor" }
  | { room: "notices" }
  | { room: "calendar" }
  | { room: "lab" }
  | { room: "org" }
  | { room: "career"; orb: string };

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
  if (parts[0] === "org") return { room: "org" };
  if (parts[0] === "career" && parts[1]) return { room: "career", orb: parts[1] };
  if (parts[0] === "chat" && parts[1]) return { room: "chat", orb: parts[1] };
  if (parts[0] === "sessions") return { room: "sessions", id: null, tab: "brainstorm" };
  if (parts[0] === "session" && /^\d+$/.test(parts[1] ?? "")) return { room: "sessions", id: Number(parts[1]), tab: parts[2] === "floor" ? "floor" : "brainstorm" };
  if (parts[0] === "office") return { room: "office", orb: parts[1] ?? null };
  return { room: "office", orb: null };
}

export function routeHash(r: Route): string {
  if (r.room === "new") return "#/new";
  if (r.room === "settings") return "#/settings";
  if (r.room === "notices") return "#/notices";
  if (r.room === "calendar") return "#/calendar";
  if (r.room === "lab") return "#/lab";
  if (r.room === "org") return "#/org";
  if (r.room === "career") return `#/career/${encodeURIComponent(r.orb)}`;
  if (r.room === "chat") return `#/chat/${encodeURIComponent(r.orb)}`;
  if (r.room === "sessions") return r.id === null ? "#/sessions" : `#/session/${r.id}/${r.tab}`;
  return r.orb ? `#/office/${encodeURIComponent(r.orb)}` : "#/office";
}
