// A stand-in for OpenAI, both halves of Sign in with ChatGPT (PLAN 1.10_t): the issuer (discovery,
// signing keys, authorize, token, revoke) and the API (models, a scripted Responses stream). It
// checks what a real server would (PKCE, the redirect, the client, the resource) and can be told
// to misbehave (a forged state, an ID token with a bad signature, issuer, audience, nonce or
// expiry, a refused refresh, the plan's usage limit). Every token it hands out is kept, so a test
// can look for each one, by value, everywhere the home writes.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer } from "node:http";
import type { TestContext } from "node:test";

export type IdTokenFlaw = "none" | "bad-signature" | "bad-issuer" | "bad-audience" | "bad-nonce" | "expired" | "missing";

export type PlanTurn = {
  chunks?: string[];
  calls?: { name: string; args: Record<string, unknown>; id?: string }[];
  /** An HTTP error with this status and code instead of a stream. */
  status?: number;
  code?: string;
  /** A stream that ends in `response.failed` with this code. */
  failed?: string;
  /** A stream that ends in an `error` event with this code inside its `error` (10-06: how a usage
   * limit came, codeless at the event's top). */
  error?: string;
  /** With `status`: the field the refusal names (`error.param`). */
  param?: string;
  /** Of the prompt, how much came from the cache. */
  cached?: number;
  /** A stream that ends without `response.completed`. */
  cut?: boolean;
};

export type FakeChatGPT = {
  issuer: string;
  apiBase: string;
  authorize: URLSearchParams[];
  token: Record<string, string>[];
  responses: { body: Record<string, unknown>; bearer: string }[];
  revoked: string[];
  /** Every token handed out, by value. */
  secrets: string[];
  // the knobs
  idToken: IdTokenFlaw;
  callback: "good" | "wrong-state" | "denied";
  scope: string;
  expiresIn: number;
  tokenError: string | null;
  refreshError: string | null;
  script: PlanTurn[];
  /** What GET /v1/models lists (default: gpt-6, and one hidden). */
  models: { slug: string; display_name: string; visibility: string }[] | null;
};

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const rand = (p: string): string => `${p}${randomBytes(18).toString("base64url")}`;

export async function fakeChatGPT(t: TestContext): Promise<FakeChatGPT> {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(key.publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string; nonce: string }>();
  const live = new Set<string>();
  const refreshes = new Map<string, string>(); // refresh token → client
  const ISSUED = "oaiapp_test_client";
  const f: FakeChatGPT = {
    issuer: "", apiBase: "", authorize: [], token: [], responses: [], revoked: [], secrets: [],
    idToken: "none", callback: "good", scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    expiresIn: 3600, tokenError: null, refreshError: null, script: [], models: null,
  };
  const jwt = (claims: Record<string, unknown>, k: KeyObject): string => {
    const head = b64({ alg: "RS256", kid: "k1", typ: "JWT" });
    const body = b64(claims);
    return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), k).toString("base64url")}`;
  };
  const tokens = (clientId: string, nonce: string | null): Record<string, unknown> => {
    const access = rand("at-");
    const refresh = rand("rt-");
    live.add(access);
    refreshes.set(refresh, clientId);
    const now = Math.floor(Date.now() / 1000);
    const flaw = f.idToken;
    const claims = {
      iss: flaw === "bad-issuer" ? "https://not-openai.example" : f.issuer,
      aud: flaw === "bad-audience" ? "oaiapp_someone_else" : clientId,
      sub: "user-123", email: "owner@example.com", name: "The Owner",
      nonce: flaw === "bad-nonce" ? "not-this-sign-in" : nonce,
      iat: now, exp: flaw === "expired" ? now - 3600 : now + 3600,
    };
    const id = flaw === "missing" || nonce === null ? null : jwt(claims, flaw === "bad-signature" ? other.privateKey : key.privateKey);
    f.secrets.push(access, refresh, ...(id ? [id] : []));
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: f.expiresIn, scope: f.scope, ...(id && { id_token: id }) };
  };
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const sse = (res: import("node:http").ServerResponse, e: Record<string, unknown>): void => {
    res.write(`event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`);
  };

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += String(d)));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", f.issuer);
      const path = url.pathname;
      if (path === "/.well-known/openid-configuration") {
        return json(res, 200, {
          issuer: f.issuer,
          authorization_endpoint: `${f.issuer}/api/accounts/authorize`,
          token_endpoint: `${f.issuer}/api/accounts/oauth/token`,
          jwks_uri: `${f.issuer}/.well-known/jwks.json`,
          revocation_endpoint: `${f.issuer}/api/accounts/oauth/revoke`,
        });
      }
      if (path === "/.well-known/jwks.json") return json(res, 200, { keys: [jwk] });
      if (path === "/api/accounts/authorize") {
        const q = url.searchParams;
        f.authorize.push(q);
        const redirect = q.get("redirect_uri") ?? "";
        const ok =
          q.get("response_type") === "code" && q.get("code_challenge_method") === "S256" && q.get("code_challenge") &&
          /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(redirect) && q.get("resource") === "https://api.openai.com/v1" &&
          (q.get("client_id") === "dynamic_agent_client" || q.get("client_id") === ISSUED) && q.get("ext_agent_host_id");
        if (!ok) return json(res, 400, { error: "invalid_request" });
        const back = new URL(redirect);
        if (f.callback === "denied") {
          back.searchParams.set("error", "access_denied");
          back.searchParams.set("state", q.get("state")!);
        } else {
          const code = rand("code-");
          codes.set(code, { challenge: q.get("code_challenge")!, redirectUri: redirect, clientId: ISSUED, nonce: q.get("nonce")! });
          back.searchParams.set("code", code);
          back.searchParams.set("state", f.callback === "wrong-state" ? "forged-state" : q.get("state")!);
          if (q.get("client_id") === "dynamic_agent_client") back.searchParams.set("client_id", ISSUED);
        }
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (path === "/api/accounts/oauth/token") {
        const p = Object.fromEntries(new URLSearchParams(raw));
        f.token.push(p);
        if (p.grant_type === "authorization_code") {
          const c = codes.get(p.code ?? "");
          codes.delete(p.code ?? "");
          if (f.tokenError) return json(res, 400, { error: f.tokenError });
          const verified = c && createHash("sha256").update(p.code_verifier ?? "").digest("base64url") === c.challenge;
          if (!c || !verified || p.client_id !== c.clientId || p.redirect_uri !== c.redirectUri || p.resource !== "https://api.openai.com/v1") {
            return json(res, 400, { error: "invalid_grant", error_description: "the code, verifier, client or redirect does not match" });
          }
          return json(res, 200, tokens(c.clientId, c.nonce));
        }
        if (p.grant_type === "refresh_token") {
          if (f.refreshError) return json(res, 400, { error: f.refreshError });
          const client = refreshes.get(p.refresh_token ?? "");
          if (!client || client !== p.client_id) return json(res, 400, { error: "invalid_grant" });
          refreshes.delete(p.refresh_token!);
          return json(res, 200, tokens(client, null));
        }
        return json(res, 400, { error: "unsupported_grant_type" });
      }
      if (path === "/api/accounts/oauth/revoke") {
        f.revoked.push(new URLSearchParams(raw).get("token") ?? "");
        return json(res, 200, {});
      }
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (path === "/v1/models") {
        if (!live.has(bearer)) return json(res, 401, { error: { code: "subscription_sharing_invalid_user" } });
        return json(res, 200, { models: f.models ?? [{ slug: "gpt-6", display_name: "GPT-6", visibility: "list" }, { slug: "gpt-6-internal", display_name: "internal", visibility: "hide" }] });
      }
      if (path === "/v1/responses") {
        const body = JSON.parse(raw || "{}") as Record<string, unknown>;
        f.responses.push({ body, bearer });
        if (!live.has(bearer)) return json(res, 401, { error: { code: "subscription_sharing_invalid_user", message: "sign in again" } });
        const turn = f.script.shift() ?? {};
        if (turn.status) return json(res, turn.status, { error: { code: turn.code ?? null, message: "scripted refusal", ...(turn.param && { param: turn.param }) } });
        res.writeHead(200, { "content-type": "text/event-stream" });
        sse(res, { type: "response.created", response: { status: "in_progress" } });
        for (const c of turn.chunks ?? (turn.calls || turn.failed || turn.error ? [] : ["ok"])) sse(res, { type: "response.output_text.delta", delta: c });
        if (turn.failed) {
          sse(res, { type: "response.failed", response: { status: "failed", error: { code: turn.failed, message: "scripted" } } });
          return res.end();
        }
        if (turn.error) {
          sse(res, { type: "error", error: { type: "usage_limit_reached", code: turn.error, message: "You've hit your usage limit." } });
          return res.end();
        }
        (turn.calls ?? []).forEach((c, i) => {
          const item = { type: "function_call", id: `fc_${i}`, call_id: c.id ?? `call_plan_${f.responses.length}_${i}`, name: c.name, arguments: "" };
          const args = JSON.stringify(c.args);
          sse(res, { type: "response.output_item.added", item });
          sse(res, { type: "response.function_call_arguments.delta", item_id: item.id, delta: args.slice(0, 5) });
          sse(res, { type: "response.function_call_arguments.delta", item_id: item.id, delta: args.slice(5) });
          sse(res, { type: "response.output_item.done", item: { ...item, arguments: args } });
        });
        if (!turn.cut) sse(res, { type: "response.completed", response: { status: "completed", usage: { input_tokens: 120, output_tokens: 12, ...(turn.cached && { input_tokens_details: { cached_tokens: turn.cached } }) } } });
        return res.end();
      }
      json(res, 404, { error: "no such path" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  f.issuer = `http://127.0.0.1:${addr.port}`;
  f.apiBase = `${f.issuer}/v1`;
  t.after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return f;
}

/** The person's browser: opens the sign-in URL and follows the redirect to the home's callback. */
export async function browse(url: string): Promise<{ status: number; page: string }> {
  const first = await fetch(url, { redirect: "manual" });
  const to = first.headers.get("location");
  if (!to) return { status: first.status, page: await first.text() };
  const back = await fetch(to);
  return { status: back.status, page: await back.text() };
}
