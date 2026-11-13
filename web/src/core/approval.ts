import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Approver } from "./mandate";
import { sha256Hex } from "./util";

/**
 * Human sign-off. Today the approver proves who they are by holding a one-time link token that was sent
 * to them out of band; the agent never sees it. Dock stores only the token's hash.
 *
 * PASSKEY SEAM: phone approval with passkeys plugs in here. Add a proof kind such as
 *   { kind: "webauthn"; credentialId; authenticatorData; clientDataJSON; signature }
 * whose WebAuthn challenge is `orderDigest`, and an ApprovalVerifier that checks the assertion against
 * the approver's registered credential. Nothing else in the order flow has to change.
 */
export type ApprovalProof = { kind: "link_token"; token: string };

export type Approval = {
  approvalId: string;
  approver: Approver;
  status: "pending" | "approved" | "declined";
  orderDigest: string; // sha256 of the order's canonical content: what the approver signs off
  tokenHash: string;
  requestedAt: string;
  decidedAt?: string;
  note?: string;
};

export interface ApprovalVerifier {
  verify(approval: Approval, proof: ApprovalProof): Promise<boolean>;
}

export function newApprovalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

export const linkTokenVerifier: ApprovalVerifier = {
  async verify(approval, proof) {
    if (proof.kind !== "link_token" || typeof proof.token !== "string") return false;
    const a = Buffer.from(sha256Hex(proof.token), "hex");
    const b = Buffer.from(approval.tokenHash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  },
};

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
