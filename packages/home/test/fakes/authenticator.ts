// A stand-in authenticator for the passkey tests (PLAN 2.7): an ES256 key, the authenticator data
// laid out as the WebAuthn spec has it, and CBOR written by hand. Each option can be bent the way
// an attack would (another origin, another name, no verification, a counter going backwards); a
// real browser's virtual authenticator is the app's test (packages/app/test).
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

const b64u = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string): Buffer => createHash("sha256").update(b).digest();

/** CBOR, the little WebAuthn uses. */
export function cborOf(v: unknown): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(n < 65536 ? 3 : 5);
    b[0] = (major << 5) | (n < 65536 ? 25 : 26);
    if (n < 65536) b.writeUInt16BE(n, 1);
    else b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") {
    const b = Buffer.from(v, "utf8");
    return Buffer.concat([head(3, b.length), b]);
  }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cborOf)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cborOf(k), cborOf(x)])]);
  throw new Error(`no CBOR for ${String(v)}`);
}

type Bend = { origin?: string; rpId?: string; verified?: boolean; count?: number; type?: string };

export class FakeAuthenticator {
  readonly #keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  readonly credentialId = randomBytes(16);
  count = 0;

  #authData(rpId: string, o: Bend, made: boolean): Buffer {
    const flags = 0x01 | (o.verified === false ? 0 : 0x04) | (made ? 0x40 : 0);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(o.count ?? this.count);
    const parts = [sha256(rpId), Buffer.from([flags]), counter];
    if (made) {
      const jwk = this.#keys.publicKey.export({ format: "jwk" }) as { x: string; y: string };
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length);
      const cose = cborOf(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
      parts.push(Buffer.alloc(16), len, this.credentialId, cose);
    }
    return Buffer.concat(parts);
  }

  #client(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** navigator.credentials.create, as a browser at `origin` would answer it. */
  create(options: { challenge: string; rp: { id: string } }, origin: string, o: Bend = {}): Record<string, unknown> {
    const authData = this.#authData(o.rpId ?? options.rp.id, o, true);
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: "public-key",
      response: {
        clientDataJSON: b64u(this.#client(o.type ?? "webauthn.create", options.challenge, o.origin ?? origin)),
        attestationObject: b64u(cborOf(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
      },
    };
  }

  /** navigator.credentials.get, signed with the key. */
  get(options: { challenge: string; rpId: string }, origin: string, o: Bend = {}): Record<string, unknown> {
    if (o.count === undefined) this.count++;
    const authData = this.#authData(o.rpId ?? options.rpId, o, false);
    const client = this.#client(o.type ?? "webauthn.get", options.challenge, o.origin ?? origin);
    const signature = sign("sha256", Buffer.concat([authData, sha256(client)]), { key: this.#keys.privateKey, dsaEncoding: "der" });
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: "public-key",
      response: { clientDataJSON: b64u(client), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null },
    };
  }
}
