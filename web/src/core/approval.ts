import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Approver } from "./mandate";
import type { QuoteLine } from "./quote";
import { canonicalJson, sha256Hex } from "./util";

/**
 * Human sign-off.
 *
 * Every approval is bound to `orderDigest`, a hash of the order's exact content (lines, products, quantities,
 * unit prices, line totals, delivery dates, substitutes, total). A proof is checked against the digest
 * recomputed from the stored order at decision time, so a sign-off cannot be moved to another order or
 * survive an edit of this one.
 *
 * Proof kinds:
 *   link_token        one-time secret from the approval link (legacy approvers with no passkey enrolled)
 *   webauthn          a passkey assertion whose challenge is derived from orderDigest (see approvalChallenge)
 *   approver_session  the device session set when the approver registered their passkey; decline only
 *   demo_tap          DEMO ONLY, off unless DOCK_DEMO_TAP_APPROVAL=1; recorded as an unverified sign-off
 *
 * The passkey implementation lives in ./passkeys.ts. The order flow only sees ApprovalVerifier.
 */

// ---------- proofs ----------

const B64Url = z.string().regex(/^[A-Za-z0-9_-]*$/, "base64url");

/** What @simplewebauthn/browser's startAuthentication() returns. */
export const WebAuthnAssertionSchema = z.object({
  id: B64Url.min(1),
  rawId: B64Url.min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: B64Url.min(1),
    authenticatorData: B64Url.min(1),
    signature: B64Url.min(1),
    userHandle: B64Url.optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
});
export type WebAuthnAssertion = z.infer<typeof WebAuthnAssertionSchema>;

export const ApprovalProofSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link_token"), token: z.string() }),
  z.object({ kind: z.literal("webauthn"), response: WebAuthnAssertionSchema }),
  z.object({ kind: z.literal("approver_session"), sessionToken: z.string().min(1) }),
  z.object({ kind: z.literal("demo_tap"), sessionToken: z.string().min(1) }),
]);
export type ApprovalProof = z.infer<typeof ApprovalProofSchema>;

export type ApprovalDecision = "approve" | "decline";

// ---------- what was signed ----------

/**
 * The evidence kept with the order and written to the ledger: who signed, when, how, and for exactly what.
 * A passkey sign-off carries everything needed to re-verify it offline: the credential's public key,
 * the raw assertion, and the inputs of the challenge.
 */
export type SignOff =
  | { method: "link_token"; verified: true; decision: ApprovalDecision; at: string; orderDigest: string }
  | {
      method: "passkey";
      verified: true;
      decision: ApprovalDecision;
      at: string;
      orderDigest: string;
      approverId: string;
      approverName: string;
      credentialId: string;
      /** COSE public key of the credential, base64url. */
      credentialPublicKey: string;
      rpId: string;
      origin: string;
      userVerified: boolean;
      counter: number;
      /** base64url(sha256(canonicalJson({ purpose, approvalId, orderDigest, nonce, decision }))) */
      challenge: string;
      nonce: string;
      assertion: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle?: string };
    }
  | { method: "approver_session"; verified: true; decision: "decline"; at: string; orderDigest: string; approverId: string; approverName: string }
  | {
      method: "demo_tap";
      verified: false;
      decision: ApprovalDecision;
      at: string;
      orderDigest: string;
      approverId: string;
      approverName: string;
      warning: string;
    };

export type Approval = {
  approvalId: string;
  approver: Approver;
  status: "pending" | "approved" | "declined";
  orderDigest: string; // sha256 of the order's canonical content: what the approver signs off
  tokenHash: string;
  requestedAt: string;
  decidedAt?: string;
  note?: string;
  signOff?: SignOff;
};

/** The content an approval covers. Any change to any of these fields changes the digest. */
export type DigestibleOrder = { orderId: string; quoteId: string; orgId: string; lines: QuoteLine[]; totalCents: number };

export function orderDigest(o: DigestibleOrder): string {
  return sha256Hex(
    canonicalJson({
      orderId: o.orderId,
      quoteId: o.quoteId,
      orgId: o.orgId,
      currency: "EUR",
      lines: o.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        packSize: l.packSize,
        unit: l.unit,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        deliveryDate: l.deliveryDate,
        substituteFor: l.substituteFor?.productId,
      })),
      totalCents: o.totalCents,
    }),
  );
}

export const APPROVAL_CHALLENGE_PURPOSE = "dock.approval.v1";

/**
 * The WebAuthn challenge for one sign-off ceremony: a hash of the approval, the order digest, the decision
 * and a fresh server nonce. The authenticator signs over it, so the assertion is only valid for this order
 * content and this decision, and only once (the nonce's ceremony is consumed on first use).
 */
export function approvalChallenge(input: { approvalId: string; orderDigest: string; nonce: string; decision: ApprovalDecision }): Uint8Array<ArrayBuffer> {
  const json = canonicalJson({ purpose: APPROVAL_CHALLENGE_PURPOSE, ...input });
  return Uint8Array.from(Buffer.from(sha256Hex(json), "hex"));
}

export function approvalChallengeB64(input: Parameters<typeof approvalChallenge>[0]): string {
  return Buffer.from(approvalChallenge(input)).toString("base64url");
}

// ---------- verification ----------

export type SignOffContext = {
  approval: Approval;
  orgId: string;
  /** Recomputed from the stored order at decision time, never taken from the client. */
  orderDigest: string;
  decision: ApprovalDecision;
  now: Date;
};

export type SignOffFailure = { ok: false; reason: string; message: string };
export type SignOffResult = { ok: true; signOff: SignOff } | SignOffFailure;

export interface ApprovalVerifier {
  verify(ctx: SignOffContext, proof: ApprovalProof): Promise<SignOffResult>;
}

export function newApprovalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

export function checkLinkToken(approval: Approval, token: string): boolean {
  const a = Buffer.from(sha256Hex(token), "hex");
  const b = Buffer.from(approval.tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Accepts only the one-time link token. Used where no passkey directory is wired (core tests, scripts). */
export const linkTokenVerifier: ApprovalVerifier = {
  async verify(ctx, proof) {
    if (proof.kind !== "link_token" || typeof proof.token !== "string") {
      return { ok: false, reason: "proof_kind_unsupported", message: `This Dock accepts only the approval link token, not "${proof.kind}".` };
    }
    if (!checkLinkToken(ctx.approval, proof.token)) return { ok: false, reason: "token_mismatch", message: "The approval proof does not match this approval." };
    return { ok: true, signOff: { method: "link_token", verified: true, decision: ctx.decision, at: ctx.now.toISOString(), orderDigest: ctx.orderDigest } };
  },
};

/** One plain sentence for the ledger: who signed what, and how. */
export function describeSignOff(s: SignOff, approver: Approver): string {
  switch (s.method) {
    case "passkey":
      return `${s.approverName} (${approver.role}) signed with a passkey${s.userVerified ? " after Face ID, fingerprint or device PIN" : ""}, credential ${s.credentialId.slice(0, 10)}…, over order digest ${s.orderDigest.slice(0, 12)}…`;
    case "approver_session":
      return `${s.approverName} (${approver.role}) declined from the phone they registered with`;
    case "demo_tap":
      return `${s.approverName} (${approver.role}) tapped the DEMO-ONLY button: UNVERIFIED, no passkey`;
    case "link_token":
      return `${approver.name} (${approver.role}) used the one-time approval link`;
  }
}

// ---------- notifications ----------

/** Where approval requests go. In-memory outbox today; SMS, email or a push to the approver's phone later. */
export type ApprovalMessage = {
  approvalId: string;
  orderId: string;
  approver: Approver;
  totalCents: number;
  reasons: string[];
  /** Path with the one-time token. Prefix with the public base URL to get the link the approver opens. */
  link: string;
  sentAt: string;
};

export interface ApprovalNotifier {
  send(message: ApprovalMessage): Promise<void>;
}

export class InMemoryOutbox implements ApprovalNotifier {
  private readonly items: ApprovalMessage[] = [];
  async send(message: ApprovalMessage): Promise<void> {
    this.items.push(structuredClone(message));
  }
  messages(): ApprovalMessage[] {
    return structuredClone(this.items);
  }
}
