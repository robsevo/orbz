// The company's board, met in the Board room (PLAN 5.16; owner, 10-07; plans/board.ts is a plan's board of rows, another thing): "on your board, you also need to have it always be an odd number for voting
// proposals, We need to follow this structure: Chairperson(CEO), Vice Chair(Best Employee), Secretary(Personal
// Assistant), Treasurer(CFO) because they will vote on things. Employees and Board Vote for best employee(s)/orbs to be on
// the board as well, as the company grows, so does the board"; and of a vote: "Each thinks, cheap brain".
//
// Its seats are always odd and never more than the office has: three to begin, five from six orbs, two more for every
// six more (`seatsFor`). The officers sit by their posts, in this order: the Chair (the CEO), the Secretary (your
// personal assistant), the Treasurer (the CFO, once there is one); the rest are elected, the Vice Chair first, then the
// directors. An election is everyone's vote, by code and free: each orb votes for the colleague whose last fortnight's
// work, weighed with how they get on, is the best, never itself (`election`); it is held when there is none, when the
// board's size changes, and once a week. A proposal put to the board is read by each member on the cheapest brain,
// who votes yes or no with one line why; a majority of the votes cast carries it, and what is carried is the board's
// decision, which every orb hears (company.ts). Kept as events (board.*), so the log replays to the same board.
import type { Clock } from "./clock.ts";
import type { EventLog } from "./events.ts";

const DAY = 86_400_000;
export const ELECT_EVERY_MS = 7 * DAY;
export const FORTNIGHT_MS = 14 * DAY;

export type Post = "chair" | "vice" | "secretary" | "treasurer" | "director";
export const POST_WORDS: Record<Post, string> = { chair: "Chairperson", vice: "Vice Chair", secretary: "Secretary", treasurer: "Treasurer", director: "Director" };
export type Seat = { orb: string; name: string; post: Post };
export type Member = { id: string; name: string; specialty: string; xp: number; rank: number; createdAt: number };
export type Election = { at: number; size: number; votes: { voter: string; for: string }[]; ranking: string[] };
export type Vote = { orb: string; name: string; post: Post; vote: "yes" | "no" | "abstain"; why: string };
export type Proposal = { id: number; at: number; text: string; by: string; votes: Vote[]; carried: boolean | null };

/** How many seats: always odd, never more than the office has; three to begin, five from six orbs, two more for every six more. */
export function seatsFor(orbs: number): number {
  if (orbs < 1) return 0;
  const target = 3 + 2 * Math.floor(orbs / 6);
  const odd = orbs % 2 ? orbs : orbs - 1;
  return Math.min(target, odd);
}

/** The officers by their posts: the top-ranked orb of each post, the first to join on a tie. */
function officer(office: Member[], specialty: string): Member | undefined {
  return office.filter((m) => m.specialty === specialty).sort((a, b) => b.rank - a.rank || a.createdAt - b.createdAt)[0];
}

/** Everyone's vote for the best colleague, by code: the fortnight's XP, then how the two get on, then all-time XP; never
 * oneself; the officers are not candidates (they sit by their posts). The ranking: the most votes first. */
export function election(office: Member[], o: { recent: (id: string) => number; gets: (voter: string, other: string) => number }): Omit<Election, "at" | "size"> {
  const officers = new Set(["ceo", "assistant", "cfo"].map((s) => officer(office, s)?.id).filter(Boolean));
  const candidates = office.filter((m) => !officers.has(m.id));
  const votes: { voter: string; for: string }[] = [];
  for (const voter of office) {
    let best: Member | null = null;
    let score = -Infinity;
    for (const c of candidates) {
      if (c.id === voter.id) continue;
      const s = o.recent(c.id) * 1000 + o.gets(voter.id, c.id) * 10 + c.xp / 1000;
      if (s > score || (s === score && best && c.createdAt < best.createdAt)) [best, score] = [c, s];
    }
    if (best) votes.push({ voter: voter.id, for: best.id });
  }
  const count = (id: string): number => votes.filter((v) => v.for === id).length;
  const ranking = [...candidates].sort((a, b) => count(b.id) - count(a.id) || o.recent(b.id) - o.recent(a.id) || a.createdAt - b.createdAt).map((m) => m.id);
  return { votes, ranking };
}

/** The board as the office and its last election make it. */
export function seat(office: Member[], ranking: readonly string[]): Seat[] {
  const n = seatsFor(office.length);
  const seats: Seat[] = [];
  const add = (m: Member | undefined, post: Post): void => {
    if (m && seats.length < n && !seats.some((s) => s.orb === m.id)) seats.push({ orb: m.id, name: m.name, post });
  };
  add(officer(office, "ceo"), "chair");
  add(officer(office, "assistant"), "secretary");
  add(officer(office, "cfo"), "treasurer");
  const elected = (): Post => (seats.some((s) => s.post === "vice") ? "director" : "vice");
  for (const id of ranking) add(office.find((m) => m.id === id), elected());
  // an office that has grown since the election: the rest by their XP until the next one
  for (const m of [...office].sort((a, b) => b.xp - a.xp || a.createdAt - b.createdAt)) add(m, elected());
  return seats;
}

/** A member's answer read: YES or NO first, then why. Anything else abstains. */
export function readVote(text: string | null): { vote: Vote["vote"]; why: string } {
  const t = (text ?? "").trim();
  const m = /^\W*(yes|no)\b[\s\W]*(.*)$/is.exec(t);
  if (!m) return { vote: "abstain", why: t.slice(0, 160) || "no answer" };
  return { vote: m[1]!.toLowerCase() as "yes" | "no", why: m[2]!.replace(/\s+/g, " ").trim().slice(0, 200) };
}

export type BoardroomOptions = {
  /** The office as the board reads it. */
  office: () => Member[];
  /** An orb's XP over the last fortnight. */
  recent: (id: string) => number;
  /** How one orb gets on with another (-100 to 100). */
  gets: (voter: string, other: string) => number;
  /** One member's vote, asked of the cheapest brain; null when no brain answers. */
  ask: (member: Seat, prompt: string) => Promise<string | null>;
  company: () => string | null;
};

export class Boardroom {
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #o: BoardroomOptions;

  constructor(events: EventLog, clock: Clock, o: BoardroomOptions) {
    this.#events = events;
    this.#clock = clock;
    this.#o = o;
  }

  /** The last election, if there has been one. */
  lastElection(): Election | null {
    const e = this.#events.ofType("board.elected").at(-1);
    return e ? { at: e.at, size: Number(e.data.size), votes: e.data.votes as Election["votes"], ranking: e.data.ranking as string[] } : null;
  }

  /** Who sits on the board now. */
  seats(): Seat[] {
    return seat(this.#o.office(), this.lastElection()?.ranking ?? []);
  }

  /** Everyone votes now; the board is seated by it. */
  elect(): Election {
    const office = this.#o.office();
    const r = election(office, { recent: this.#o.recent, gets: this.#o.gets });
    const size = seatsFor(office.length);
    this.#events.append("board.elected", { size, votes: r.votes, ranking: r.ranking });
    return { at: this.#clock.now(), size, ...r };
  }

  /** The home's tick: an election when there has been none, when the board's size has changed, or once a week. */
  due(): void {
    const office = this.#o.office();
    if (office.length < 3) return; // a board needs three to vote
    const last = this.lastElection();
    if (!last || last.size !== seatsFor(office.length) || this.#clock.now() - last.at >= ELECT_EVERY_MS) this.elect();
  }

  /** When the next election is due (the week's), for the home's timer. */
  nextAt(): number | null {
    const last = this.lastElection();
    return last ? last.at + ELECT_EVERY_MS : null;
  }

  /** Puts a proposal to the board: each member reads it and votes on the cheapest brain; a majority of the votes cast
   * carries it. A board of one (an office of fewer than three) is its Chair's call alone. */
  async propose(text: string, by: string): Promise<Proposal> {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) throw new Error("a proposal needs saying");
    if (t.length > 600) throw new Error("a proposal is 600 letters at most: say it in a few lines");
    const seats = this.seats();
    if (!seats.length) throw new Error("there is no board yet: appoint your CEO first");
    const id = this.#events.append("board.proposed", { text: t, by, members: seats.map((s) => s.orb) });
    const company = this.#o.company();
    const votes: Vote[] = [];
    for (const s of seats) {
      const prompt = `You sit on the board of ${company ?? "an Orb startup"} as its ${POST_WORDS[s.post]}. A proposal is put to the board:\n\n"${t}"\n\nRead it as a careful board member who wants the company to do well and the Founder to be glad of it. Vote. Answer with YES or NO first, then one short sentence why.`;
      let answer: string | null = null;
      try {
        answer = await this.#o.ask(s, prompt);
      } catch (e) {
        answer = null;
        this.#events.append("board.vote_failed", { proposal: id, orb: s.orb, why: e instanceof Error ? e.message : String(e) });
      }
      const v = readVote(answer);
      votes.push({ orb: s.orb, name: s.name, post: s.post, ...v });
      this.#events.append("board.voted", { proposal: id, vote: v.vote, why: v.why, post: s.post }, { orb: s.orb });
    }
    const yes = votes.filter((v) => v.vote === "yes").length;
    const no = votes.filter((v) => v.vote === "no").length;
    const carried = yes > no;
    this.#events.append("board.decided", { proposal: id, carried, yes, no, abstained: votes.length - yes - no });
    return { id, at: this.#clock.now(), text: t, by, votes, carried };
  }

  /** The proposals put, newest first, with their votes and outcomes. */
  proposals(limit = 10): Proposal[] {
    const voted = this.#events.ofType("board.voted");
    const decided = new Map(this.#events.ofType("board.decided").map((e) => [Number(e.data.proposal), Boolean(e.data.carried)]));
    const office = new Map(this.#o.office().map((m) => [m.id, m.name]));
    return this.#events.ofType("board.proposed").slice(-limit).reverse().map((p) => ({
      id: p.seq, at: p.at, text: String(p.data.text), by: String(p.data.by),
      votes: voted.filter((v) => Number(v.data.proposal) === p.seq).map((v) => ({ orb: String(v.orb), name: office.get(String(v.orb)) ?? String(v.orb), post: v.data.post as Post, vote: v.data.vote as Vote["vote"], why: String(v.data.why) })),
      carried: decided.has(p.seq) ? decided.get(p.seq)! : null,
    }));
  }

  /** What the board has decided lately (carried proposals), newest first, for every orb to hear. */
  decisions(limit = 3): string[] {
    return this.proposals(20).filter((p) => p.carried === true).slice(0, limit).map((p) => p.text);
  }
}
