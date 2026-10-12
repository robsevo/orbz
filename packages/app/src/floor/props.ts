// The floor's small things that answer a press (owner, 10-10). Each answers only in its turn; what one gives is kept by
// the home (about.ts keepsakes, every device sees it) and carried in the side menu. Pure, so a test can walk it: the
// turns, what they give and the words they come with are read from the table below.
const KEY = "the floor keeps its own small things";
const TABLE = "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";
/** What a word typed at the game is checked against: a digest only (SHA-256), never the words. */
const ACCEPTED = "95431de6e3e19fe0ded52b08258a36313fc477bb1309d0eb78fdd40600ce09b5";

export type Thing = "shelf" | "arcade" | "paper" | "screen" | "bin";
export type Turn =
  | { k: "press"; on: Thing; n: number; drop: string }
  | { k: "carry"; on: Thing; with: string; gives: string }
  | { k: "move"; on: Thing; drop: string }
  | { k: "code"; on: Thing; with: string; gives: string };

type Job = { label: string; title: string; focus: string; limits: string };
type Names = {
  room: string; dept: string; one: string; home: string; empty: string; noBook: string; hireOne: string; hiring: string;
  ask: string; field: string; yes: string; no: string; stick: string; paper: string;
  jobs: Record<"deskhead" | "dealer" | "quant" | "onchain" | "risk" | "quantres" | "quantdev" | "riskanalyst", Job>;
};

const read = (): { s: Turn[]; w: string[]; n: Names } => {
  const raw = atob(TABLE);
  let out = "";
  for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  return JSON.parse(out) as { s: Turn[]; w: string[]; n: Names };
};
const { s: TURNS, w: WORDS, n: NAMES } = read();
/** The turns, and the words said with what they give and open. */
export { TURNS, NAMES };

/** What a turn leaves kept once it is done. */
export const keptBy = (t: Turn): string => ("drop" in t ? t.drop : t.gives);
/** The turn that answers now: the first whose keepsake is not yet kept (null: all done). */
export function turnNow(kept: readonly string[]): Turn | null {
  return TURNS.find((t) => !kept.includes(keptBy(t))) ?? null;
}
/** The pieces of the paper found so far, in their order: what the paper shows. */
export function piecesOf(kept: readonly string[]): (string | null)[] {
  const drops = TURNS.filter((t): t is Extract<Turn, { k: "press" | "move" }> => "drop" in t && t.drop.startsWith("p"));
  return drops.map((t, i) => (kept.includes(t.drop) ? WORDS[i] ?? null : null));
}
/** Whether the words typed are the ones: only as the paper has them, exact; spaces and the signs that close them forgiven. */
export async function opens(typed: string): Promise<boolean> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typed.replace(/\s+/g, "").replace(/=+$/, ""))));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("") === ACCEPTED;
}
/** The keepsakes carried in the side menu, and what opens once all is done. */
export const CARRIED = { stick: keptBy(TURNS[0]!), pieces: TURNS.filter((t) => "drop" in t && t.drop.startsWith("p")).map(keptBy), open: keptBy(TURNS[TURNS.length - 1]!), seen: keptBy(TURNS[1]!) };
