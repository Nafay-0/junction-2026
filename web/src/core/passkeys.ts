import { createHash, randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  approvalChallenge,
  approvalChallengeB64,
  checkLinkToken,
  type ApprovalDecision,
  type ApprovalProof,
  type ApprovalVerifier,
  type SignOffContext,
  type SignOffResult,
} from "./approval";

/**
 * Passkeys (WebAuthn) for approvers. No framework, no network: the server routes pass in the relying party
 * (rp id and allowed origins, from env or the request) and the browser's JSON; everything else is here.
 *
 * - An approver is a person bound to one organisation and one mandate role (orgId + role). They register
 *   a passkey once; there is no username or password.
 * - Approving an order is a WebAuthn assertion whose challenge is approvalChallenge(approvalId, orderDigest,
 *   nonce, decision). The ceremony (nonce) is single-use and expires after a few minutes.
 * - The verifier recomputes the challenge from the order as stored at decision time, so an assertion made
 *   for order A cannot approve order B, nor order A after any change to its lines, prices or dates.
 */

export type RelyingParty = { id: string; name: string; origins: string[] };

export type ApproverAccount = {
  approverId: string;
  orgId: string;
  role: string; // the mandate approver role this person fills
  name: string;
  /** WebAuthn user handle, base64url. Random; carries no personal data. */
  userHandle: string;
  createdAt: string;
  expiresAt?: string;
};

export type StoredCredential = {
  credentialId: string; // base64url
  approverId: string;
  publicKey: string; // COSE, base64url
  counter: number;
  transports?: string[];
  rpId: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  createdAt: string;
  lastUsedAt?: string;
};

type CeremonyBase = { challenge: string; rp: RelyingParty; expiresAt: number };
export type Ceremony =
  | (CeremonyBase & { kind: "register"; userHandle: string; context: Record<string, unknown> })
  | (CeremonyBase & { kind: "approve"; approvalId: string; decision: ApprovalDecision; nonce: string; orderDigest: string; approverId: string });

export type ApproverSession = { approverId: string; expiresAt: number };

/** Async so a database can replace it. `takeCeremony` must be atomic (get and delete): that is the replay guard. */
export interface PasskeyStore {
  putAccount(a: ApproverAccount): Promise<void>;
  getAccount(approverId: string): Promise<ApproverAccount | undefined>;
  findApprover(orgId: string, role: string): Promise<ApproverAccount | undefined>;
  deleteAccount(approverId: string): Promise<void>;
  putCredential(c: StoredCredential): Promise<void>;
  getCredential(credentialId: string): Promise<StoredCredential | undefined>;
  credentialsOf(approverId: string): Promise<StoredCredential[]>;
  putCeremony(c: Ceremony): Promise<void>;
  takeCeremony(challenge: string): Promise<Ceremony | undefined>;
  sweepCeremonies(nowMs: number): Promise<number>; // removes expired, returns how many are left
  putSession(tokenHash: string, s: ApproverSession): Promise<void>;
  getSession(tokenHash: string): Promise<ApproverSession | undefined>;
}

export class InMemoryPasskeyStore implements PasskeyStore {
  private accounts = new Map<string, ApproverAccount>();
  private credentials = new Map<string, StoredCredential>();
  private ceremonies = new Map<string, Ceremony>();
  private sessions = new Map<string, ApproverSession>();

  async putAccount(a: ApproverAccount) {
    this.accounts.set(a.approverId, structuredClone(a));
  }
  async getAccount(id: string) {
    const a = this.accounts.get(id);
    return a && structuredClone(a);
  }
  async findApprover(orgId: string, role: string) {
    const a = [...this.accounts.values()].find((x) => x.orgId === orgId && x.role === role);
    return a && structuredClone(a);
  }
  async deleteAccount(id: string) {
    this.accounts.delete(id);
    for (const [k, c] of this.credentials) if (c.approverId === id) this.credentials.delete(k);
    for (const [k, s] of this.sessions) if (s.approverId === id) this.sessions.delete(k);
  }
  async putCredential(c: StoredCredential) {
    this.credentials.set(c.credentialId, structuredClone(c));
  }
  async getCredential(id: string) {
    const c = this.credentials.get(id);
    return c && structuredClone(c);
  }
  async credentialsOf(approverId: string) {
    return structuredClone([...this.credentials.values()].filter((c) => c.approverId === approverId));
  }
  async putCeremony(c: Ceremony) {
    this.ceremonies.set(c.challenge, structuredClone(c));
  }
  async takeCeremony(challenge: string) {
    const c = this.ceremonies.get(challenge);
    this.ceremonies.delete(challenge);
    return c;
  }
  async sweepCeremonies(nowMs: number) {
    for (const [k, c] of this.ceremonies) if (c.expiresAt <= nowMs) this.ceremonies.delete(k);
    return this.ceremonies.size;
  }
  async putSession(h: string, s: ApproverSession) {
    this.sessions.set(h, { ...s });
  }
  async getSession(h: string) {
    const s = this.sessions.get(h);
    return s && { ...s };
  }
}

const PASSKEY_ERROR = Symbol.for("dock.error.PasskeyError");

/** Branded like DockError (see errors.ts): the passkey service lives in the shared runtime, routes may hold another copy of this class. */
export class PasskeyError extends Error {
  static [Symbol.hasInstance](value: unknown): value is PasskeyError {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[PASSKEY_ERROR] === true;
  }

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PasskeyError";
    Object.defineProperty(this, PASSKEY_ERROR, { value: true });
  }
}

export type PasskeyServiceOptions = {
  store: PasskeyStore;
  now?: () => Date;
  /** How long a registration or approval prompt stays valid. */
  ceremonyTtlMs?: number;
  /** Cap on open ceremonies, so a flood of page loads cannot grow memory without bound. */
  maxOpenCeremonies?: number;
  /** DEMO ONLY: whether tap-to-approve without a passkey is accepted. Read on every call. */
  demoTapEnabled?: () => boolean;
};

const DEMO_TAP_WARNING = "Demo-only tap approval: no passkey, no cryptographic proof of who approved. Not equivalent to a passkey sign-off.";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(Buffer.from(s, "base64url"));
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** The challenge the browser put in clientDataJSON, or undefined when it is not parseable. */
export function challengeOf(clientDataJSON: string): { challenge?: string; type?: string; origin?: string } {
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as Record<string, unknown>;
    return {
      challenge: typeof parsed.challenge === "string" ? parsed.challenge : undefined,
      type: typeof parsed.type === "string" ? parsed.type : undefined,
      origin: typeof parsed.origin === "string" ? parsed.origin : undefined,
    };
  } catch {
    return {};
  }
}

export class PasskeyService {
  readonly store: PasskeyStore;
  private readonly now: () => Date;
  private readonly ttl: number;
  private readonly maxOpen: number;
  readonly demoTapEnabled: () => boolean;

  constructor(opts: PasskeyServiceOptions) {
    this.store = opts.store;
    this.now = opts.now ?? (() => new Date());
    this.ttl = opts.ceremonyTtlMs ?? 5 * 60_000;
    this.maxOpen = opts.maxOpenCeremonies ?? 2000;
    this.demoTapEnabled = opts.demoTapEnabled ?? (() => false);
  }

  private async reserveCeremony(): Promise<number> {
    const nowMs = this.now().getTime();
    if ((await this.store.sweepCeremonies(nowMs)) >= this.maxOpen) {
      throw new PasskeyError(503, "too_many_open_prompts", "Too many passkey prompts are open right now. Try again in a minute.");
    }
    return nowMs + this.ttl;
  }

  // ---------- registration ----------

  /** Options for navigator.credentials.create(). `context` comes back from verifyRegistration unchanged. */
  async registrationOptions(
    rp: RelyingParty,
    user: { name: string; displayName: string },
    context: Record<string, unknown> = {},
  ): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; userHandle: string }> {
    const expiresAt = await this.reserveCeremony();
    const userId = Uint8Array.from(randomBytes(16));
    const options = await generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userName: user.name,
      userDisplayName: user.displayName,
      userID: userId,
      challenge: Uint8Array.from(randomBytes(32)),
      timeout: 120_000,
      attestationType: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
      preferredAuthenticatorType: "localDevice",
      supportedAlgorithmIDs: [-7, -8, -257], // ES256 first: every phone platform authenticator has it
    });
    const userHandle = b64(userId);
    await this.store.putCeremony({ kind: "register", challenge: options.challenge, rp, expiresAt, userHandle, context });
    return { options, userHandle };
  }

  /** Check the browser's registration response. Returns the new credential (not yet stored) and the ceremony context. */
  async verifyRegistration(
    response: RegistrationResponseJSON,
  ): Promise<{ credential: Omit<StoredCredential, "approverId">; userHandle: string; context: Record<string, unknown> }> {
    const { challenge } = challengeOf(response?.response?.clientDataJSON ?? "");
    const ceremony = challenge ? await this.store.takeCeremony(challenge) : undefined;
    if (!ceremony || ceremony.kind !== "register") throw new PasskeyError(400, "registration_unknown", "This passkey prompt is unknown or was already used. Start again.");
    if (ceremony.expiresAt <= this.now().getTime()) throw new PasskeyError(400, "registration_expired", "This passkey prompt expired. Start again.");
    let result;
    try {
      result = await verifyRegistrationResponse({
        response,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: ceremony.rp.origins,
        expectedRPID: ceremony.rp.id,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -8, -257],
      });
    } catch (err) {
      throw new PasskeyError(400, "registration_invalid", `The passkey could not be verified: ${(err as Error).message}`);
    }
    if (!result.verified) throw new PasskeyError(400, "registration_invalid", "The passkey could not be verified.");
    const info = result.registrationInfo;
    const at = this.now().toISOString();
    if (await this.store.getCredential(info.credential.id)) throw new PasskeyError(409, "credential_exists", "This passkey is already registered.");
    return {
      credential: {
        credentialId: info.credential.id,
        publicKey: b64(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? response.response.transports,
        rpId: ceremony.rp.id,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        createdAt: at,
      },
      userHandle: ceremony.userHandle,
      context: ceremony.context,
    };
  }

  /** Store an approver and, unless they joined through the demo fallback, their passkey. */
  async enrol(account: ApproverAccount, credential?: Omit<StoredCredential, "approverId">): Promise<void> {
    const existing = await this.store.findApprover(account.orgId, account.role);
    if (existing && existing.approverId !== account.approverId) {
      throw new PasskeyError(409, "approver_exists", `Organisation ${account.orgId} already has a ${account.role} with a passkey.`);
    }
    await this.store.putAccount(account);
    if (credential) await this.store.putCredential({ ...credential, approverId: account.approverId });
  }

  // ---------- sessions (which approver this phone is) ----------

  async newSession(approverId: string, expiresAt: Date): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.store.putSession(hashToken(token), { approverId, expiresAt: expiresAt.getTime() });
    return token;
  }

  async sessionApprover(token: string | undefined): Promise<ApproverAccount | undefined> {
    if (!token) return undefined;
    const s = await this.store.getSession(hashToken(token));
    if (!s || s.expiresAt <= this.now().getTime()) return undefined;
    const a = await this.store.getAccount(s.approverId);
    if (!a || (a.expiresAt && Date.parse(a.expiresAt) <= this.now().getTime())) return undefined;
    return a;
  }

  // ---------- sign-off ----------

  /** Options for navigator.credentials.get(), bound to this approval, its order digest and the decision. */
  async approvalOptions(
    rp: RelyingParty,
    input: { approvalId: string; orgId: string; role: string; orderDigest: string; decision: ApprovalDecision },
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const account = await this.store.findApprover(input.orgId, input.role);
    if (!account) throw new PasskeyError(409, "no_passkey_approver", "Nobody has registered a passkey for this approval.");
    const creds = (await this.store.credentialsOf(account.approverId)).filter((c) => c.rpId === rp.id);
    if (creds.length === 0) throw new PasskeyError(409, "no_passkey_on_this_site", "The approver has no passkey for this site.");
    const expiresAt = await this.reserveCeremony();
    const nonce = randomBytes(16).toString("base64url");
    const challenge = approvalChallenge({ approvalId: input.approvalId, orderDigest: input.orderDigest, nonce, decision: input.decision });
    const options = await generateAuthenticationOptions({
      rpID: rp.id,
      challenge,
      allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: c.transports })),
      userVerification: "required",
      timeout: 120_000,
    });
    await this.store.putCeremony({
      kind: "approve",
      challenge: options.challenge,
      rp,
      expiresAt,
      approvalId: input.approvalId,
      decision: input.decision,
      nonce,
      orderDigest: input.orderDigest,
      approverId: account.approverId,
    });
    return options;
  }

  async hasPasskeyApprover(orgId: string, role: string): Promise<boolean> {
    return (await this.store.findApprover(orgId, role)) !== undefined;
  }

  /**
   * The verifier the order flow calls. Approvers enrolled here must use a passkey (or the demo fallback when
   * switched on); the one-time link token is accepted only for approvers who never enrolled.
   */
  readonly verifier: ApprovalVerifier = {
    verify: (ctx, proof) => this.verify(ctx, proof),
  };

  private async verify(ctx: SignOffContext, proof: ApprovalProof): Promise<SignOffResult> {
    const fail = (reason: string, message: string): SignOffResult => ({ ok: false, reason, message });
    const expected = await this.store.findApprover(ctx.orgId, ctx.approval.approver.role);
    const at = ctx.now.toISOString();

    if (proof.kind === "link_token") {
      if (expected) return fail("passkey_required", `${expected.name} signs with a passkey; the approval link alone is not enough.`);
      if (!checkLinkToken(ctx.approval, proof.token)) return fail("token_mismatch", "The approval proof does not match this approval.");
      return { ok: true, signOff: { method: "link_token", verified: true, decision: ctx.decision, at, orderDigest: ctx.orderDigest } };
    }

    if (!expected) return fail("no_passkey_approver", "Nobody has registered a passkey for this approval; use the approval link.");
    if (expected.expiresAt && Date.parse(expected.expiresAt) <= ctx.now.getTime()) return fail("approver_expired", "This demo kitchen has closed.");

    if (proof.kind === "approver_session" || proof.kind === "demo_tap") {
      const who = await this.sessionApprover(proof.sessionToken);
      if (!who) return fail("session_invalid", "This phone is not signed in as an approver.");
      if (who.approverId !== expected.approverId) return fail("wrong_approver", `This request is for ${expected.name}, not ${who.name}.`);
      if (proof.kind === "approver_session") {
        if (ctx.decision !== "decline") return fail("passkey_required", "Approving needs your passkey; a signed-in phone can only decline.");
        return { ok: true, signOff: { method: "approver_session", verified: true, decision: "decline", at, orderDigest: ctx.orderDigest, approverId: who.approverId, approverName: who.name } };
      }
      if (!this.demoTapEnabled()) return fail("demo_tap_disabled", "Tap-to-approve without a passkey is switched off on this server.");
      return {
        ok: true,
        signOff: { method: "demo_tap", verified: false, decision: ctx.decision, at, orderDigest: ctx.orderDigest, approverId: who.approverId, approverName: who.name, warning: DEMO_TAP_WARNING },
      };
    }

    // webauthn
    const response = proof.response;
    const client = challengeOf(response.response.clientDataJSON);
    if (!client.challenge) return fail("assertion_malformed", "The passkey response is malformed.");
    const ceremony = await this.store.takeCeremony(client.challenge); // single use: a replay finds nothing
    if (!ceremony || ceremony.kind !== "approve") return fail("challenge_unknown", "This passkey signature was already used or was never issued. Approve again.");
    if (ceremony.expiresAt <= ctx.now.getTime()) return fail("challenge_expired", "The passkey prompt expired. Approve again.");
    if (ceremony.approvalId !== ctx.approval.approvalId) return fail("challenge_other_approval", "This passkey signature was made for a different order.");
    if (ceremony.decision !== ctx.decision) return fail("challenge_other_decision", `This passkey signature was made to ${ceremony.decision}, not to ${ctx.decision}.`);

    const credential = await this.store.getCredential(response.id);
    if (!credential) return fail("credential_unknown", "This passkey is not registered here.");
    if (credential.approverId !== expected.approverId || ceremony.approverId !== expected.approverId) {
      return fail("wrong_approver", `This passkey does not belong to ${expected.name}, who must sign this order.`);
    }
    if (credential.rpId !== ceremony.rp.id) return fail("credential_other_site", "This passkey was registered on a different site.");

    // Recompute the challenge from the order as it is now. If anything changed since the prompt, this differs.
    const expectedChallenge = approvalChallengeB64({ approvalId: ctx.approval.approvalId, orderDigest: ctx.orderDigest, nonce: ceremony.nonce, decision: ctx.decision });
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: ceremony.rp.origins,
        expectedRPID: ceremony.rp.id,
        credential: { id: credential.credentialId, publicKey: fromB64(credential.publicKey), counter: credential.counter, transports: credential.transports },
        requireUserVerification: true,
      });
    } catch (err) {
      const message = (err as Error).message;
      if (/challenge/i.test(message)) return fail("order_changed", "The order changed after the passkey prompt was shown; this signature is for different content.");
      return fail("assertion_invalid", `The passkey signature does not verify: ${message}`);
    }
    if (!verified.verified) return fail("assertion_invalid", "The passkey signature does not verify.");

    await this.store.putCredential({ ...credential, counter: verified.authenticationInfo.newCounter, lastUsedAt: at });
    return {
      ok: true,
      signOff: {
        method: "passkey",
        verified: true,
        decision: ctx.decision,
        at,
        orderDigest: ctx.orderDigest,
        approverId: expected.approverId,
        approverName: expected.name,
        credentialId: credential.credentialId,
        credentialPublicKey: credential.publicKey,
        rpId: verified.authenticationInfo.rpID,
        origin: verified.authenticationInfo.origin,
        userVerified: verified.authenticationInfo.userVerified,
        counter: verified.authenticationInfo.newCounter,
        challenge: expectedChallenge,
        nonce: ceremony.nonce,
        assertion: {
          authenticatorData: response.response.authenticatorData,
          clientDataJSON: response.response.clientDataJSON,
          signature: response.response.signature,
          userHandle: response.response.userHandle,
        },
      },
    };
  }
}
