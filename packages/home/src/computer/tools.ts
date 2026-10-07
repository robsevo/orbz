// His computer's tools (PLAN 4.1): his browser, by visible text, and the check a built page must
// pass before it is called done. Each answers in plain words; what a page says comes back marked
// as outside text (the one-way switch), with every saved password taken out of it first.
//
// What asks, and why (the floor reads the WORDS, Open Dot's idea, wider and in our categories):
//
//   a click on pay, buy, place order, checkout, subscribe, donate…    money: always asks
//   a click on send, submit, post, publish, reply, share, invite…     messaging: always asks
//   a click on delete, remove, cancel, unsubscribe, close account…    deleting: always asks
//   a click on book, reserve, schedule, RSVP                          calendar: always asks
//   a click on confirm, accept, agree, allow, authorize, sign up…     asks unless your rules allow
//   typing into a card number, CVV, IBAN, account number…             money: always asks
//   typing into a code, PIN, token or key field                       passwords: always asks
//   signing in with a saved password                                  passwords: always asks
//   typing anything, in a turn that read a page                       the one-way switch: a fresh yes
//
// The floor is asked about the words he named; at the moment of acting the button's or field's
// WHOLE words are read again, and if they commit to more ("Continue" that is "Continue to
// payment") nothing is pressed and he is told to name them, so the card shows what is real.
//
// While the person has his computer (PLAN 4.6) each act waits for them to hand it back.
import { checkUrl } from "../agent/net.ts";
import { inWorkspace, type ToolDef, type ToolResult } from "../agent/tools.ts";
import { FLOOR_WORDS, type FloorCategory, type FloorHit } from "../rules/floor.ts";
import { ComputerError, type Computers } from "./browser.ts";
import { hostOf, type Vault, VaultError } from "./vault.ts";
import { GROUPS } from "../agent/groups.ts";

const CLICK_FLOOR: [FloorCategory, RegExp][] = [
  ["money", /\b(pay|payment|pay now|buy|buy now|purchase|place (an |your |my |the )?order|order now|complete (the |your )?order|checkout|check out|subscribe|subscriptions?|donate|tip|bid|upgrade|renew|add (a )?(card|payment)|trade|sell|swap|withdraw|transfer|deposit)\b/i],
  ["messaging", /\b(send|submit|post|publish|reply|comment|share|invite|tweet|retweet|message|email|forward)\b/i],
  ["deleting", /\b(delete|remove|erase|trash|discard|wipe|destroy|cancel|unsubscribe|deactivate|close (my |your |the )?account|leave)\b/i],
  ["calendar", /\b(book|reserve|reservation|schedule|reschedule|rsvp)\b/i],
];
/** Words that consent to something: asked by default; the person's rules may allow them. */
const CONSENT = /\b(confirm|accept|agree|allow|authori[sz]e|approve|grant|sign ?up|register|enrol+|apply|continue to|proceed to)\b/i;
const FIELD_FLOOR: [FloorCategory, RegExp][] = [
  ["money", /\b(card ?number|card no|credit card|debit card|cc-?number|cc-?csc|cvv|cvc|csc|security code|expir(y|ation|es)|cc-exp|iban|swift|bic|routing|account (number|no)|sort code|amount)\b/i],
  ["passwords", /\b(password|passcode|pin|one[- ]?time|otp|2fa|two[- ]factor|verification code|security answer|secret|api[- ]?key|token)\b/i],
];

const hits = (table: [FloorCategory, RegExp][], words: string): FloorHit[] =>
  table.filter(([, re]) => re.test(words)).map(([category]) => ({ category, why: FLOOR_WORDS[category] }));
/** The floor's view of a click on these words. */
export const clickFloor = (words: string): FloorHit[] => hits(CLICK_FLOOR, words);
/** The floor's view of typing into a field with these words. */
export const fieldFloor = (words: string): FloorHit[] => hits(FIELD_FLOOR, words);
export const consents = (words: string): boolean => CONSENT.test(words);

/** Whether what was asked about covers everything the real words commit to. */
const covers = (asked: FloorHit[], real: FloorHit[]): boolean => real.every((r) => asked.some((a) => a.category === r.category));

const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const failed = (e: unknown): ToolResult => {
  if (e instanceof ComputerError || e instanceof VaultError) return { content: e.message, isError: true };
  throw e;
};

/** What the kit's pagecheck said about a page (PLAN 4.1): pass, fail, or that nothing could look. */
export type PageVerdict = { verdict: "pass" | "fail" | "inconclusive"; report: string };
export type PageCheck = (target: { url: string } | { root: string; path: string }) => Promise<PageVerdict>;

/** A page an orb may check: one of his own, served on this machine (his dev server), or a file
 * of his workspace. Never the web, never another machine on your network. */
function ownPage(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "a page is checked at its http address, or by its path in your workspace";
    if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return "check_page checks a page you built: one served on this machine (localhost), or a file in your workspace";
    return null;
  } catch {
    return `not an address: ${url}`;
  }
}

export function computerTools(c: Computers, vault: Vault, pageCheck: PageCheck | null): ToolDef[] {
  const words = async (text: string): Promise<string> => vault.scrub(text);
  return [
    {
      name: "open_page",
      group: GROUPS.computer,
      label: "Opening a page",
      description:
        "Open a web page in your own browser (it keeps your sign-ins). Then read_page to see what it says, click by its visible words and type_into its fields. Only the web: never this machine or its network.",
      parameters: obj({ url: { type: "string", description: "The page's address (https://…)." } }, ["url"]),
      describe: (a) => `open ${s(a.url)} in its browser`,
      decision: "allow",
      untrusted: "page",
      precheck: (a) => (/^https?:\/\//i.test(s(a.url)) ? null : "Only http and https addresses open in your browser."),
      async run(a, ctx) {
        const ok = await checkUrl(s(a.url));
        if (!ok.ok) return { content: `Not opened: ${ok.reason}. Your browser only goes to the web.`, isError: true };
        try {
          await c.waitForHands(ctx.orb, ctx.signal);
          const r = await c.open(ctx.orb, s(a.url));
          return { content: await words(`Opened ${r.url} — "${r.title}". read_page to see what it says.`) };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: "read_page",
      group: GROUPS.computer,
      label: "Reading the page",
      description: "The words on the page open in your browser, as a person sees them (and its address and title).",
      parameters: obj({}, []),
      describe: () => "read the page open in its browser",
      decision: "allow",
      untrusted: "page",
      async run(_a, ctx) {
        try {
          await c.waitForHands(ctx.orb, ctx.signal);
          const r = await c.read(ctx.orb);
          return { content: await words(`${r.url} — "${r.title}"\n\n${r.text || "(no words on the page)"}${r.cut ? "\n… [the page goes on]" : ""}`) };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: "click",
      group: GROUPS.computer,
      label: "Using the computer",
      description:
        'Click something on the page by its visible words (a button, a link, a tab), e.g. "Next" or "Row F, seat 12". Use the words exactly as read_page shows them. Paying, sending, deleting and booking always ask the person first.',
      parameters: obj({ text: { type: "string", description: "The visible words of what to click." } }, ["text"]),
      describe: (a) => `click "${s(a.text)}" in its browser`,
      decision: "allow",
      decisionFor: (a) => (consents(s(a.text)) ? "ask" : "allow"),
      floor: (a) => clickFloor(s(a.text)),
      untrusted: "page",
      async run(a, ctx) {
        const asked = s(a.text);
        try {
          await c.waitForHands(ctx.orb, ctx.signal);
          const r = await c.click(ctx.orb, asked, (label) =>
            covers(clickFloor(asked), clickFloor(label)) && (consents(asked) || !consents(label))
              ? null
              : `Not clicked: it says "${label}", which commits to more than "${asked}". Click it by its own words ("${label}"), so the person is asked first.`,
          );
          return { content: await words(`Clicked "${r.label}". Now on ${r.url} — "${r.title}". read_page to see what changed.`) };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: "type_into",
      group: GROUPS.computer,
      label: "Typing on the computer",
      description:
        "Type into a field on the page, found by its label, placeholder or name; submit presses Enter after. Never a password (sign_in types saved ones). In a turn that read a page, typing asks the person first.",
      parameters: obj(
        {
          field: { type: "string", description: "The field's label, placeholder or name, as the page shows it." },
          text: { type: "string", description: "What to type." },
          submit: { type: "boolean", description: "Press Enter after typing." },
        },
        ["field", "text"],
      ),
      describe: (a) => `type "${s(a.text).slice(0, 80)}" into "${s(a.field)}" in its browser${a.submit ? ", and press Enter" : ""}`,
      decision: "allow",
      act: "send", // words leave him for a page: after reading one, a fresh yes (Ash's one-way switch)
      floor: (a) => fieldFloor(s(a.field)),
      untrusted: "page",
      async run(a, ctx) {
        const field = s(a.field);
        try {
          await c.waitForHands(ctx.orb, ctx.signal);
          const r = await c.type(ctx.orb, field, s(a.text), Boolean(a.submit), (label) =>
            covers(fieldFloor(field), fieldFloor(label)) ? null : `Not typed: that field is "${label}". Name it by those words, so the person is asked first.`,
          );
          return { content: await words(a.submit ? `Typed into "${field}" and pressed Enter. Now on ${r.url} — "${r.title}".` : `Typed into "${field}".`) };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: "sign_in",
      group: GROUPS.computer,
      label: "Signing in",
      description:
        "Fill the sign-in form on the page you are on with the password the person saved for THIS site (you never see it; it is typed only on the site it was saved for). Open the site's sign-in page first; afterwards click its sign-in button yourself.",
      parameters: obj({ username: { type: "string", description: "Which username, when more than one is saved for the site." } }, []),
      describe: (a) => `sign in on the page in its browser with the password you saved${a.username ? ` for ${s(a.username)}` : ""}`,
      decision: "ask",
      act: "send",
      floor: () => [{ category: "passwords", why: FLOOR_WORDS.passwords }],
      async run(a, ctx) {
        try {
          await c.waitForHands(ctx.orb, ctx.signal);
          const login = await vault.loginFor(await c.url(ctx.orb), s(a.username) || undefined);
          const r = await c.fill(ctx.orb, login.site, login.username, login.password, hostOf);
          if (!r.filled) return { content: `No sign-in fields are showing on ${login.site}: open its sign-in form first.`, isError: true };
          return { content: `Filled ${r.filled === 2 ? "the username and the password" : "the one sign-in field showing (it may ask for the rest next)"} for ${login.username} on ${login.site}. Now click its sign-in button.` };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: "check_page",
      group: GROUPS.computer,
      label: "Checking a page",
      description:
        "Before calling a page you built done: Ash's pagecheck loads it in a browser of its own and asks what really rendered: that it answered, that its stylesheet produced rules, that its classes are styled, that its pictures loaded (no placeholders), that no build error covers it. Give the path of a built page in your workspace, or the address your dev server serves it at (localhost).",
      parameters: obj(
        {
          path: { type: "string", description: "A page in your workspace (e.g. site/index.html)." },
          url: { type: "string", description: "Or its address on this machine (http://localhost:5173/)." },
        },
        [],
      ),
      describe: (a) => `check that ${s(a.path) || s(a.url)} really renders`,
      decision: "allow",
      async run(a, ctx) {
        if (!pageCheck) return { content: "Pages cannot be checked here: pagecheck runs in the kit, which is not running.", isError: true };
        let target: { url: string } | { root: string; path: string };
        if (s(a.path)) {
          if (!inWorkspace(ctx.workspace, s(a.path))) return { content: `${s(a.path)} is outside your workspace.`, isError: true };
          target = { root: ctx.workspace, path: s(a.path).replace(/^\.?\/+/, "") };
        } else {
          const no = ownPage(s(a.url));
          if (no) return { content: no, isError: true };
          target = { url: s(a.url) };
        }
        const v = await pageCheck(target);
        const head = v.verdict === "pass" ? "It renders and is styled." : v.verdict === "fail" ? "It is NOT done:" : "Inconclusive: nothing could look at what it rendered, so it is not a pass.";
        return { content: `${head}\n${v.report.trim()}`, isError: v.verdict !== "pass" };
      },
    },
  ];
}
