// Where you are in the app, as an address (owner, 2026-10-01: "back button on the side menu,
// that brings you to different tabs ... easily navigable"). Every place has a link of its own, so
// the side menu's Back, the browser's Back and a link someone sends all work alike:
//   #/office/Ash   an orb in the office        #/new        a new orb, in the creator
//   #/settings     Settings                    (nothing)    the office, its first orb
// Rooms join this list as they are built (sessions 2.9, the lab 2.13, the calendar 2.12...).

export type Room = "office" | "settings";
export type Route = { room: "office"; orb: string | null } | { room: "new" } | { room: "settings" };

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
  if (parts[0] === "office") return { room: "office", orb: parts[1] ?? null };
  return { room: "office", orb: null };
}

export function routeHash(r: Route): string {
  if (r.room === "new") return "#/new";
  if (r.room === "settings") return "#/settings";
  return r.orb ? `#/office/${encodeURIComponent(r.orb)}` : "#/office";
}
