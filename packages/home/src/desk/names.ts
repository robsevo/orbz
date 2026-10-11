// The desk's head, by its post, and the department it opens: kept as the app keeps them (app/src/floor/props.ts), and
// held alike by app/test/company.test.ts.
const KEY = "the floor keeps its own small things";
const SEALED = "D0oNRQcITVVQaA4EAVAcRkkgAUELHgBHUUFDCAlQAEpTTDMBFQwMTgFOEg==";

const read = (): { head: string; dept: string } => {
  const raw = atob(SEALED);
  let out = "";
  for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  return JSON.parse(out) as { head: string; dept: string };
};
export const DESK_NAMES = read();
