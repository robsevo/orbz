// Sign in with ChatGPT, the protocol (PLAN 1.10), as OpenAI documents it for open-source apps that
// run locally (developers.openai.com/siwc/token-sharing-open-source): OAuth 2.0 with PKCE, a
// public client registered during the flow (`client_id=dynamic_agent_client`, then the issued
// `oaiapp_…` id), a loopback redirect, and an ID token checked for its signature, issuer,
// audience, expiry and nonce before anything is kept. Our own code: no SDK, no client secret, no
// API key. The endpoints come from the issuer's discovery document, so a test can stand up its own
// issuer; the issuer itself is configured, never taken from what the server says.
//
// Nothing here logs or returns a token in an error: an error says which check failed or which
// code the server sent, never the body it sent.
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";

/** One of the issuer's public keys, as its JWKS lists it. */
type Jwk = Extract<Parameters<typeof createPublicKey>[0], { format: "jwk" }>["key"] & { kid?: string; kty?: string };

export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const SHARING_SCOPE = "chatgpt.tokens.use.direct";
export const DYNAMIC_CLIENT = "dynamic_agent_client";

/** The server's codes that mean the saved tokens are no good and sign-in must run again. */
export const REAUTH_CODES = new Set(["invalid_grant", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);

export type Discovery = { issuer: string; authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string; revocationEndpoint: string | null };
export type Tokens = { accessToken: string; refreshToken: string | null; expiresIn: number; scope: string; idToken: string | null };
export type IdClaims = { sub: string; email: string | null; name: string | null };

export class SignInError extends Error {
  /** The server's error code, when it sent one (`invalid_grant`, `access_denied`…). */
  readonly code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "SignInError";
    this.code = code;
  }
}

const b64url = (b: Buffer): string => b.toString("base64url");

export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export const randomToken = (): string => b64url(randomBytes(24));
export const newHostId = (): string => `urn:uuid:${randomUUID()}`;

export async function discover(issuer: string, signal?: AbortSignal): Promise<Discovery> {
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) throw new SignInError(`the sign-in server's discovery document answered HTTP ${res.status}`);
  const d = (await res.json()) as Record<string, unknown>;
  // OpenID Connect: the document must name the issuer it was fetched from
  if (d.issuer !== issuer) throw new SignInError(`the discovery document names the issuer ${String(d.issuer)}, not ${issuer}`);
  const need = (k: string): string => {
    if (typeof d[k] !== "string") throw new SignInError(`the discovery document has no ${k}`);
    return d[k] as string;
  };
  return {
    issuer,
    authorizationEndpoint: need("authorization_endpoint"),
    tokenEndpoint: need("token_endpoint"),
    jwksUri: need("jwks_uri"),
    revocationEndpoint: typeof d.revocation_endpoint === "string" ? d.revocation_endpoint : null,
  };
}

export function authorizeUrl(d: Discovery, p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; appName: string; hostId: string }): string {
  const u = new URL(d.authorizationEndpoint);
  const q = u.searchParams;
  q.set("response_type", "code");
  q.set("client_id", p.clientId);
  q.set("redirect_uri", p.redirectUri);
  q.set("scope", SCOPES);
  q.set("state", p.state);
  q.set("nonce", p.nonce);
  q.set("code_challenge", p.challenge);
  q.set("code_challenge_method", "S256");
  q.set("resource", RESOURCE);
  q.set("agent_name_hint", p.appName);
  q.set("ext_agent_host_id", p.hostId);
  return u.toString();
}

async function tokenCall(d: Discovery, form: Record<string, string>): Promise<Tokens> {
  let res: Response;
  try {
    res = await fetch(d.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new SignInError(`the sign-in server is not answering (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message})`);
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof j.access_token !== "string") {
    const code = typeof j.error === "string" ? j.error : null;
    const why = typeof j.error_description === "string" ? `: ${j.error_description.slice(0, 200)}` : "";
    throw new SignInError(`the sign-in server refused the token request (HTTP ${res.status}${code ? `, ${code}` : ""}${why})`, code);
  }
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null,
    expiresIn: Math.max(0, Number(j.expires_in ?? 3600)),
    scope: typeof j.scope === "string" ? j.scope : "",
    idToken: typeof j.id_token === "string" ? j.id_token : null,
  };
}

export function exchange(d: Discovery, p: { clientId: string; code: string; verifier: string; redirectUri: string }): Promise<Tokens> {
  return tokenCall(d, {
    grant_type: "authorization_code",
    client_id: p.clientId,
    code: p.code,
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
    resource: RESOURCE,
  });
}

export function refresh(d: Discovery, p: { clientId: string; refreshToken: string }): Promise<Tokens> {
  return tokenCall(d, { grant_type: "refresh_token", client_id: p.clientId, refresh_token: p.refreshToken, resource: RESOURCE });
}

/** Best effort: a sign-out that cannot reach the server still forgets the tokens here. */
export async function revoke(d: Discovery, p: { clientId: string; token: string }): Promise<boolean> {
  if (!d.revocationEndpoint) return false;
  try {
    const res = await fetch(d.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: p.token, token_type_hint: "refresh_token", client_id: p.clientId }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The issuer's signing keys, fetched once and again when a token names a key we have not seen. */
export class Keys {
  readonly #uri: string;
  #keys: Jwk[] | null = null;

  constructor(uri: string) {
    this.#uri = uri;
  }

  async find(kid: string | undefined): Promise<Jwk[]> {
    const pick = (): Jwk[] => (this.#keys ?? []).filter((k) => k.kty === "RSA" && (kid === undefined || k.kid === kid));
    if (this.#keys && pick().length) return pick();
    const res = await fetch(this.#uri, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new SignInError(`the issuer's signing keys answered HTTP ${res.status}`);
    const j = (await res.json()) as { keys?: unknown };
    this.#keys = Array.isArray(j.keys) ? (j.keys as Jwk[]) : [];
    return pick();
  }
}

/** Verifies an ID token: RS256 by one of the issuer's keys, for this issuer, this client, this
 * sign-in's nonce, not expired. Throws SignInError naming the first check that failed. */
export async function verifyIdToken(token: string, o: { issuer: string; audience: string; nonce: string; keys: Keys; nowMs?: number }): Promise<IdClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new SignInError("the ID token is not a signed token");
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as typeof header;
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new SignInError("the ID token cannot be read");
  }
  if (header.alg !== "RS256") throw new SignInError(`the ID token is signed with ${String(header.alg)}, not RS256`);
  const candidates = await o.keys.find(header.kid);
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2]!, "base64url");
  const signed = candidates.some((jwk) => {
    try {
      return verify("RSA-SHA256", data, createPublicKey({ key: jwk, format: "jwk" }), sig);
    } catch {
      return false;
    }
  });
  if (!signed) throw new SignInError("the ID token's signature does not verify with the issuer's keys");
  if (claims.iss !== o.issuer) throw new SignInError(`the ID token was issued by ${String(claims.iss)}, not ${o.issuer}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(o.audience)) throw new SignInError("the ID token was issued for another app, not this one");
  const now = (o.nowMs ?? Date.now()) / 1000;
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new SignInError("the ID token has expired");
  if (claims.nonce !== o.nonce) throw new SignInError("the ID token's nonce does not match this sign-in");
  if (typeof claims.sub !== "string" || !claims.sub) throw new SignInError("the ID token names no account");
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    name: typeof claims.name === "string" ? claims.name : null,
  };
}
