// The floor (PLAN 1.6; CLAUDE.md rule 9): what always asks, at every tier and every rank, whatever
// the rules say, and what is never done at all. It is CODE, not prose: a page, a model or a rule
// can talk about it, none of them can move it.
//
//   deleting    removing files, history or data            always asks
//   money       paying, buying, charging, transferring     always asks
//   passwords   keys, credentials, the password stores     always asks
//   messaging   sending to people (mail, chat webhooks)    always asks
//   calendar    moving or changing what is on your calendar always asks (PLAN 2.12: never silent)
//   lessons     an orb learning a lesson always asks (PLAN 3.5: never activated by a model)
//   protected   writing the owner's brain or Orbs' data    never
//
// Recognised from the command by code. The patterns lean wide on purpose: a needless card costs a
// tap, a missed one can cost what the floor exists for. Tools that do these things directly (a
// sender, a payment page) declare it themselves (ToolDef.floor).

export type FloorCategory = "deleting" | "money" | "passwords" | "messaging" | "calendar" | "lessons" | "protected";
export type FloorHit = { category: FloorCategory; why: string };

export const FLOOR_WORDS: Record<FloorCategory, string> = {
  deleting: "deleting always asks",
  money: "anything to do with money always asks",
  passwords: "passwords and keys always ask",
  messaging: "messaging someone always asks",
  calendar: "changing your calendar always asks",
  lessons: "what an orb learns, it learns only with your yes",
  protected: "the owner's brain and Orbz' own data are never written",
};

const DELETING = [
  /(^|[;&|`(\s])(rm|rmdir|unlink|shred|srm|wipe|truncate)(\s|$)/,
  /\bgit\s+(rm|clean|reset\s+--hard|branch\s+-D|push\b.*(--force|-f\b)|stash\s+(drop|clear))/,
  /\bfind\b.*\s-delete\b/,
  /\bdd\b.*\bof=/,
  /\b(mkfs|wipefs|dropdb)\b/,
  /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i,
];
const MONEY = [
  /\b(stripe|paypal|braintree|squareup|adyen|coinbase|wise|venmo|revolut)\b/i,
  // investing and crypto (owner, 10-02: "an investor persona, for crypto also"): an exchange, a trade,
  // a wallet signing or sending: always the person's yes, at every rank
  /\b(binance|kraken|robinhood|etoro|alpaca|bybit|okx|kucoin|bitstamp|bitfinex|uniswap)\b/i,
  /\b(sell|trade|swap|withdraw|stake|unstake)\b/i,
  /\b(eth_send(raw)?transaction|send(raw)?transaction|sign(and(send)?)?transaction|personal_sign)\b/i,
  /\/(charges|payments?|payouts|transfers|checkout|invoices\/[^/\s]+\/pay|orders)\b/i,
  /\b(purchase|buy|checkout|pay)\b/i,
];
const PASSWORDS = [
  /\.ssh\/|\bid_(rsa|ed25519|ecdsa)\b|\.gnupg\b|\.password-store\b|\/etc\/shadow\b/,
  /\.aws\/credentials|\.netrc\b|\.git-credentials\b|\.docker\/config\.json/,
  /\bsecret-tool\b|\bsecurity\s+find-(generic|internet)-password\b|\bpass\s+show\b|\bgpg\b.*(-d\b|--decrypt)/,
  /\bkeyring\b|\bkeychain\b|\bcredential(s)?\b|\bpasswords?\b/i,
];
const MESSAGING = [
  /(^|[;&|`(\s])(sendmail|mail|mailx|mutt|msmtp|swaks|s-nail)(\s|$)/,
  /hooks\.slack\.com|slack\.com\/api\/chat\.|discord(app)?\.com\/api\/webhooks|api\.twilio\.com|api\.telegram\.org\/bot|smtps?:\/\//i,
];
const WRITES = /(>|\btee\b|\bcp\b|\bmv\b|\brm\b|\bsed\s+(-[a-z]*i|--in-place)|\btruncate\b|\bchmod\b|\bchown\b|\bln\b|\btouch\b|\bdd\b|\binstall\b|\brsync\b)/;

/** The floor's view of a shell command. `protectedPaths` are absolute; `home` turns them into ~ forms too. */
export function shellFloor(command: string, protectedPaths: string[], home: string): FloorHit[] {
  const hits: FloorHit[] = [];
  const hit = (category: FloorCategory, res: RegExp[]): void => {
    if (res.some((re) => re.test(command))) hits.push({ category, why: FLOOR_WORDS[category] });
  };
  hit("deleting", DELETING);
  hit("money", MONEY);
  hit("passwords", PASSWORDS);
  hit("messaging", MESSAGING);
  if (WRITES.test(command)) {
    const forms = protectedPaths.flatMap((p) => [p, p.startsWith(home + "/") ? `~/${p.slice(home.length + 1)}` : p, p.startsWith(home + "/") ? `$HOME/${p.slice(home.length + 1)}` : p]);
    const named = forms.find((f) => command.includes(f));
    if (named) hits.push({ category: "protected", why: `${FLOOR_WORDS.protected} (${named})` });
  }
  return hits;
}

// A connector's tool (PLAN 4.2) is someone else's code: what it does is read off its name, the
// words in it (`send_email`, `createPayment`, `deleteEvent`), and what the floor covers asks.
const TOOL_WORDS: [FloorCategory, RegExp][] = [
  ["money", /^(pay|payment|payments|charge|refund|transfer|purchase|buy|checkout|invoice|payout|order|sell|trade|swap|withdraw|deposit|stake|unstake|bridge)$/],
  ["messaging", /^(send|reply|forward|post|message|email|mail|sms|tweet|dm|publish|invite|share)$/],
  ["deleting", /^(delete|remove|destroy|drop|purge|trash|erase|wipe|unsubscribe)$/],
  ["passwords", /^(password|passwords|secret|secrets|credential|credentials|token|tokens|key|keys)$/],
];
// the calendar is what changes it: a verb that changes, on a thing a calendar holds (list_events reads)
const CHANGES = /^(create|add|update|edit|move|reschedule|cancel|set|book|accept|decline)$/;
const ON_CALENDAR = /^(event|events|meeting|meetings|appointment|appointments|calendar|calendars|booking)$/;

/** The floor's view of a connector's tool, by the words of its name. */
export function toolFloor(name: string): FloorHit[] {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hits: FloorHit[] = [];
  for (const [category, re] of TOOL_WORDS) if (words.some((w) => re.test(w)) && !hits.some((h) => h.category === category)) hits.push({ category, why: FLOOR_WORDS[category] });
  if (words.some((w) => CHANGES.test(w)) && words.some((w) => ON_CALENDAR.test(w))) hits.push({ category: "calendar", why: FLOOR_WORDS.calendar });
  return hits;
}
