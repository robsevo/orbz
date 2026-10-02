// Passkeys (PLAN 2.7): the owner signs in to the app from any device with a passkey, the browser's
// own WebAuthn, and each sign-in is a device (sessions.ts), revocable. Our own code: ES256 (what
// every platform passkey uses), any attestation format, none of it verified (a passkey's maker is
// not what we ask about: we keep its public key and check every signature with it).
//
// Registering one needs a session already (a device paired by its link, or the loopback token):
// a passkey is never how a stranger gets in. Signing in checks, before a session is made: the
// challenge is ours, fresh and used once; the page that asked is this home's own origin; the
// passkey was made for this home's name (its RP ID hash); the person was present and verified;
// the signature is the key's own; and its counter, when it keeps one, only goes up.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import type { Sessions } from "./sessions.ts";

export const CHALLENGE_MS = 5 * 60_000;
/** The most challenges kept at once: anyone can ask for one at the door, so a flood drops the oldest. */
export const CHALLENGES_KEPT = 256;
const ES256 = -7;
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export class PasskeyError extends Error {}

const b64u = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const unb64u = (s: unknown, what: string): Buffer => {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new PasskeyError(`${what} is not base64url`);
  return Buffer.from(s, "base64url");
};
const sha256 = (b: Uint8Array | string): Buffer => createHash("sha256").update(b).digest();

/** CBOR (RFC 8949), only what WebAuthn sends: whole numbers, byte and text strings, arrays,
 * maps, true, false, null. Anything else, or anything cut short, is refused. */
export function cbor(b: Buffer, at = 0): [unknown, number] {
  if (at >= b.length) throw new PasskeyError("the CBOR is cut short");
  const first = b[at]!;
  const major = first >> 5;
  const info = first & 31;
  let i = at + 1;
  let n: number;
  if (info < 24) n = info;
  else if (info === 24) [n, i] = [b.readUInt8(i), i + 1];
  else if (info === 25) [n, i] = [b.readUInt16BE(i), i + 2];
  else if (info === 26) [n, i] = [b.readUInt32BE(i), i + 4];
  else throw new PasskeyError("a CBOR length WebAuthn does not use");
  const take = (len: number): Buffer => {
    if (i + len > b.length) throw new PasskeyError("the CBOR is cut short");
    const out = b.subarray(i, i + len);
    i += len;
    return out;
  };
  switch (major) {
    case 0:
      return [n, i];
    case 1:
      return [-1 - n, i];
    case 2:
      return [take(n), i];
    case 3:
      return [take(n).toString("utf8"), i];
    case 4: {
      const out: unknown[] = [];
      for (let k = 0; k < n; k++) {
        const [v, next] = cbor(b, i);
        out.push(v);
        i = next;
      }
      return [out, i];
    }
    case 5: {
      const out = new Map<unknown, unknown>();
      for (let k = 0; k < n; k++) {
        const [key, afterKey] = cbor(b, i);
        const [v, next] = cbor(b, afterKey);
        out.set(key, v);
        i = next;
      }
      return [out, i];
    }
    case 7:
      if (info === 20) return [false, i];
      if (info === 21) return [true, i];
      if (info === 22) return [null, i];
      throw new PasskeyError("a CBOR value WebAuthn does not use");
    default:
      throw new PasskeyError("a CBOR tag WebAuthn does not use");
  }
}

type AuthData = { rpIdHash: Buffer; flags: number; signCount: number; credential: { id: Buffer; key: Map<unknown, unknown> } | null };

/** The authenticator's data: whose name it signed for, its flags, its counter, and (made new) the key. */
export function authData(b: Buffer): AuthData {
  if (b.length < 37) throw new PasskeyError("the authenticator data is cut short");
  const flags = b[32]!;
  let credential: AuthData["credential"] = null;
  if (flags & AT) {
    if (b.length < 55) throw new PasskeyError("the authenticator data is cut short");
    const len = b.readUInt16BE(53);
    if (55 + len > b.length) throw new PasskeyError("the authenticator data is cut short");
    const [key] = cbor(b, 55 + len);
    if (!(key instanceof Map)) throw new PasskeyError("the passkey's public key is not a COSE key");
    credential = { id: b.subarray(55, 55 + len), key };
  }
  return { rpIdHash: b.subarray(0, 32), flags, signCount: b.readUInt32BE(33), credential };
}

/** A COSE EC2 P-256 key, for ES256 only, as a JWK node's crypto takes. */
export function es256Jwk(key: Map<unknown, unknown>): { kty: "EC"; crv: "P-256"; x: string; y: string } {
  const x = key.get(-2);
  const y = key.get(-3);
  if (key.get(1) !== 2 || key.get(3) !== ES256 || key.get(-1) !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
    throw new PasskeyError("only ES256 passkeys (EC P-256) are taken");
  }
  return { kty: "EC", crv: "P-256", x: b64u(x), y: b64u(y) };
}

export type Where = { rpId: string; origin: string };
export type Passkey = { id: number; name: string; createdAt: number; usedAt: number | null };
type Row = { id: number; credential: string; public_key: string; sign_count: number; name: string; created_at: number; used_at: number | null };

export class Passkeys {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;
  readonly #sessions: Sessions;
  readonly #user: Buffer;
  readonly #challenges = new Map<string, { kind: "create" | "get"; until: number }>();

  constructor(db: DatabaseSync, clock: Clock, sessions: Sessions, home: string) {
    this.#db = db;
    this.#clock = clock;
    this.#sessions = sessions;
    this.#user = sha256(`orbs-owner:${home}`).subarray(0, 16); // one owner a home: a passkey made again replaces its own
  }

  #challenge(kind: "create" | "get"): string {
    const now = this.#clock.now();
    for (const [k, v] of this.#challenges) if (v.until < now) this.#challenges.delete(k);
    while (this.#challenges.size >= CHALLENGES_KEPT) this.#challenges.delete(this.#challenges.keys().next().value!); // the oldest first
    const c = b64u(randomBytes(32));
    this.#challenges.set(c, { kind, until: now + CHALLENGE_MS });
    return c;
  }

  /** What the browser needs to make a passkey for this home (navigator.credentials.create). */
  createOptions(where: Where, owner: string): Record<string, unknown> {
    return {
      challenge: this.#challenge("create"),
      rp: { id: where.rpId, name: "Orbs" },
      user: { id: b64u(this.#user), name: owner, displayName: owner },
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
      timeout: CHALLENGE_MS,
      attestation: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      excludeCredentials: this.#rows().map((r) => ({ type: "public-key", id: r.credential })),
    };
  }

  /** What the browser needs to sign in with one (navigator.credentials.get): any of this home's. */
  getOptions(where: Where): Record<string, unknown> {
    return { challenge: this.#challenge("get"), rpId: where.rpId, timeout: CHALLENGE_MS, userVerification: "required", allowCredentials: [] };
  }

  /** Keeps the passkey a browser made, once everything about it is checked. */
  register(where: Where, cred: unknown, name: string): Passkey {
    const c = cred as { id?: unknown; response?: { clientDataJSON?: unknown; attestationObject?: unknown } };
    const clientRaw = unb64u(c.response?.clientDataJSON, "clientDataJSON");
    this.#client(clientRaw, "webauthn.create", "create", where);
    const [att] = cbor(unb64u(c.response?.attestationObject, "attestationObject"));
    const raw = att instanceof Map ? att.get("authData") : null;
    if (!Buffer.isBuffer(raw)) throw new PasskeyError("the attestation has no authenticator data");
    const d = authData(raw);
    this.#signedFor(d, where);
    if (!d.credential) throw new PasskeyError("no passkey was made");
    const jwk = es256Jwk(d.credential.key);
    const id = b64u(d.credential.id);
    if (c.id !== id) throw new PasskeyError("the passkey's id is not the one its authenticator made");
    const now = this.#clock.now();
    const r = this.#db
      .prepare("INSERT INTO passkeys (credential, public_key, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(credential) DO UPDATE SET public_key = excluded.public_key, sign_count = excluded.sign_count RETURNING id")
      .get(id, JSON.stringify(jwk), d.signCount, name.slice(0, 80) || "a passkey", now) as { id: number };
    return { id: r.id, name, createdAt: now, usedAt: null };
  }

  /** A sign-in: a new session for the device, if every check holds. */
  signIn(where: Where, cred: unknown, deviceName: string): string {
    const c = cred as { id?: unknown; response?: { clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown } };
    const clientRaw = unb64u(c.response?.clientDataJSON, "clientDataJSON");
    this.#client(clientRaw, "webauthn.get", "get", where);
    const row = this.#db.prepare("SELECT * FROM passkeys WHERE credential = ?").get(String(c.id ?? "")) as Row | undefined;
    if (!row) throw new PasskeyError("that passkey is not one of this home's");
    const raw = unb64u(c.response?.authenticatorData, "authenticatorData");
    const d = authData(raw);
    this.#signedFor(d, where);
    const key = createPublicKey({ key: JSON.parse(row.public_key) as Record<string, string>, format: "jwk" });
    const ok = verify("sha256", Buffer.concat([raw, sha256(clientRaw)]), { key, dsaEncoding: "der" }, unb64u(c.response?.signature, "signature"));
    if (!ok) throw new PasskeyError("the signature is not that passkey's");
    // a counter that went back (or stood still) is a copy of the key: synced passkeys keep none (0)
    if ((d.signCount !== 0 || row.sign_count !== 0) && d.signCount <= row.sign_count) throw new PasskeyError("that passkey's counter went backwards: it may have been copied");
    this.#db.prepare("UPDATE passkeys SET sign_count = ?, used_at = ? WHERE id = ?").run(d.signCount, this.#clock.now(), row.id);
    return this.#sessions.open(deviceName, "passkey");
  }

  list(): Passkey[] {
    return this.#rows().map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, usedAt: r.used_at }));
  }

  remove(id: number): void {
    if (!Number(this.#db.prepare("DELETE FROM passkeys WHERE id = ?").run(id).changes)) throw new PasskeyError(`no passkey ${id}`);
  }

  #rows(): Row[] {
    return this.#db.prepare("SELECT * FROM passkeys ORDER BY id").all() as Row[];
  }

  /** The browser's own account of the request: of this kind, our challenge (used once), our origin. */
  #client(raw: Buffer, type: string, kind: "create" | "get", where: Where): void {
    let data: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
    try {
      data = JSON.parse(raw.toString("utf8")) as typeof data;
    } catch {
      throw new PasskeyError("clientDataJSON is not JSON");
    }
    if (data.type !== type) throw new PasskeyError(`that is not a ${type}`);
    const ch = typeof data.challenge === "string" ? this.#challenges.get(data.challenge) : undefined;
    if (typeof data.challenge === "string") this.#challenges.delete(data.challenge); // used once, right or wrong
    if (!ch || ch.kind !== kind || ch.until < this.#clock.now()) throw new PasskeyError("that challenge is not this home's, or it lapsed, or it was used");
    if (data.origin !== where.origin || data.crossOrigin === true) throw new PasskeyError(`it was asked for by ${String(data.origin)}, not this home (${where.origin})`);
  }

  #signedFor(d: AuthData, where: Where): void {
    if (!d.rpIdHash.equals(sha256(where.rpId))) throw new PasskeyError(`that passkey is for another name than ${where.rpId}`);
    if (!(d.flags & UP) || !(d.flags & UV)) throw new PasskeyError("the person was not there and verified (a fingerprint, a face, a PIN)");
  }
}
