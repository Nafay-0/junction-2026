// TEST ONLY. A software passkey authenticator (ES256, "none" attestation) that produces the same JSON as
// @simplewebauthn/browser, so passkey flows can be tested in Node without a browser. Not used at runtime.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private counter = 0;
  private userHandle?: string;
  /** Set to false to simulate an authenticator that skipped Face ID / fingerprint. */
  userVerified = true;

  constructor(readonly origin: string) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  get id(): string {
    return b64(this.credentialId);
  }

  private flags(extra = 0) {
    return FLAG_UP | (this.userVerified ? FLAG_UV : 0) | extra;
  }

  private coseKey(): Uint8Array {
    const jwk = this.publicKey.export({ format: "jwk" });
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Uint8Array.from(Buffer.from(jwk.x!, "base64url"))],
        [-3, Uint8Array.from(Buffer.from(jwk.y!, "base64url"))],
      ]),
    );
  }

  register(options: PublicKeyCredentialCreationOptionsJSON, origin = this.origin): RegistrationResponseJSON {
    this.userHandle = options.user.id;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(options.rp.id ?? new URL(origin).hostname),
      Buffer.from([this.flags(FLAG_AT)]),
      Buffer.alloc(4), // sign count 0
      Buffer.alloc(16), // aaguid
      idLen,
      this.credentialId,
      Buffer.from(this.coseKey()),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, Parameters<typeof isoCBOR.encode>[0]>([
        ["fmt", "none"],
        ["attStmt", new Map<string, never>()],
        ["authData", Uint8Array.from(authData)],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Sign an assertion for these options. `overrideChallenge` lets a test sign something other than what was asked. */
  assert(options: PublicKeyCredentialRequestOptionsJSON, opts: { origin?: string; overrideChallenge?: string } = {}): AuthenticationResponseJSON {
    this.counter += 1;
    const origin = opts.origin ?? this.origin;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: opts.overrideChallenge ?? options.challenge, origin, crossOrigin: false }));
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(options.rpId ?? new URL(origin).hostname), Buffer.from([this.flags()]), count]);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), { key: this.privateKey, dsaEncoding: "der" });
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
