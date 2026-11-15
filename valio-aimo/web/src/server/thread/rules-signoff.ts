import type { ApprovalProof } from "@/core/approval";
import { DockError } from "@/core/errors";
import { canRead, principalOf } from "@/server/authz";
import { accountOfOrg, phoneJoins } from "@/server/accounts/phone-join";
import { resolveKitchen } from "@/server/console-kitchens";
import { currentApprover, sessionTokenOf } from "@/server/approver-session";
import type { RelyingParty } from "@/core/passkeys";
import type { Runtime } from "@/server/runtime";
import { rulesDecline, rulesLapse, rulesSignOff, rulesSignOffOptions, threadStore } from "./engine";
import { lapsed, proposalByApproval, waitingProposals, type Proposal } from "./rules";
import type { StoredThread } from "./store";

/**
 * A change to a kitchen's rules that widens what its agent may do, on the approver's phone: the same link, QR code and
 * passkey ceremony as an order over the limit (/approve/{approvalId}, the approver's home), with its own id space
 * (rch_...) so one can never stand in for the other. The phone sees exactly what would change, who asked and when, and
 * signs or declines with its passkey; the conversation that asked updates in place and carries on (engine.ts).
 *
 *   GET  /ui-api/rules-changes/{approvalId}             -> { view }
 *   POST /ui-api/rules-changes/{approvalId}/challenge   { decision }            -> { options }
 *   POST /ui-api/rules-changes/{approvalId}             { decision, proof, note? } -> { view }
 *
 * Who may read it: the kitchen's approver on their signed-in phone, the kitchen's own signed-in account, the
 * operations desk (server/authz.ts canRead). Anyone else gets 404, as for an order's sign-off.
 */

export type RulesChangeView = {
  approvalId: string;
  kind: "rules_change";
  /** pending: waiting for this person; signed / declined: decided; expired: nobody signed in time; closed: dropped. */
  state: "pending" | "signed" | "declined" | "expired" | "closed";
  kitchenName: string;
  approverName: string;
  approverRole: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt?: string;
  serverNow: string;
  /** Exactly what is signed, field by field (server/thread/rules.ts diffOf, as shown when it was asked). */
  changes: { field: string; before: string; after: string; widens: boolean }[];
  /** What waits on it in the conversation ("burger buns"), when the change was asked to buy something. */
  thenWhat?: string;
  signIn: "passkey" | "no_passkey";
  viewerIsApprover: boolean;
  outcome?: { decision: "approved" | "declined"; by: string; at: string; method: string; note?: string };
  details: { approvalId: string; orgId: string; mandateId: string; digest: string };
};

type Found = { thread: StoredThread; proposal: Proposal };

/** The thread and proposal a rules-change sign-off belongs to; 404 for an id that is not one (an order's included). */
export async function findRulesChange(approvalId: string): Promise<Found> {
  if (!/^rch_[A-Za-z0-9_]{4,60}$/.test(approvalId)) throw new DockError(404, "approval_not_found", "No such sign-off.", "data_access");
  const store = await threadStore();
  for (const thread of store.all()) {
    const proposal = proposalByApproval(thread, approvalId);
    if (proposal) return { thread, proposal };
  }
  throw new DockError(404, "approval_not_found", "No such sign-off. It may have been dropped when the conversation started over.", "data_access");
}

/** May this caller see it? The kitchen's approver phone, its own account, operations; 404 for anyone else. */
export async function requireRulesChangeReader(rt: Runtime, req: Request, f: Found): Promise<void> {
  if (canRead(await principalOf(req, rt), f.thread.orgId)) return;
  // A shared test kitchen or a fresh kitchen: any phone joins from the kitchen's screen (accounts/phone-join.ts).
  if (phoneJoins(await accountOfOrg(rt, f.thread.orgId))) throw new DockError(403, "approval_on_signer_phone", "Tap “Send to my phone” again on the other screen and scan the new code.", "data_access", { join: true });
  throw new DockError(404, "approval_not_found", "No such sign-off for you. Open it on the approver's phone.", "data_access");
}

const stateOf = (p: Proposal): RulesChangeView["state"] => (p.state === "waiting" ? (lapsed(p) ? "expired" : "pending") : p.state === "signed" ? "signed" : p.state === "declined" ? "declined" : p.state === "expired" ? "expired" : "closed");

export async function rulesChangeView(rt: Runtime, req: Request, f: Found): Promise<RulesChangeView> {
  const a = f.proposal.approval!;
  // A change found past its time is closed once, in the conversation too.
  if (f.proposal.state === "waiting" && lapsed(f.proposal)) await rulesLapse(f.thread.kitchen, f.proposal.proposalId).catch(() => undefined);
  const account = await rt.passkeys.store.findApprover(f.thread.orgId, a.approver.role);
  const hasPasskey = account ? (await rt.passkeys.store.credentialsOf(account.approverId)).length > 0 : false;
  const me = await currentApprover(req, rt);
  const kitchenName = (await resolveKitchen(f.thread.kitchen).catch(() => undefined))?.info.name ?? f.thread.kitchen;
  const thenWhat = (f.thread as unknown as { afterRulesWhat?: Record<string, string> }).afterRulesWhat?.[f.proposal.proposalId];
  return {
    approvalId: a.approvalId,
    kind: "rules_change",
    state: stateOf(f.proposal),
    kitchenName,
    approverName: account?.name ?? a.approver.name,
    approverRole: a.approver.role,
    requestedBy: a.requestedBy ?? kitchenName,
    requestedAt: a.requestedAt,
    ...(a.expiresAt ? { expiresAt: a.expiresAt } : {}),
    serverNow: new Date().toISOString(),
    changes: a.shown ?? [],
    ...(thenWhat ? { thenWhat } : {}),
    signIn: hasPasskey ? "passkey" : "no_passkey",
    viewerIsApprover: !!me && !!account && me.account.approverId === account.approverId,
    ...(a.decided ? { outcome: { ...a.decided } } : {}),
    details: { approvalId: a.approvalId, orgId: f.thread.orgId, mandateId: a.mandateId, digest: a.digest },
  };
}

/** The passkey prompt for one decision on this change, bound to it (engine.ts rulesSignOffOptions). */
export async function rulesChangeOptions(rt: Runtime, req: Request, approvalId: string, decision: "approve" | "decline", rp: RelyingParty) {
  const f = await findRulesChange(approvalId);
  await requireRulesChangeReader(rt, req, f);
  if (f.proposal.state !== "waiting" || lapsed(f.proposal)) throw new DockError(409, "approval_not_pending", "This change is no longer waiting for a sign-off.");
  return rulesSignOffOptions(f.thread.kitchen, f.proposal.proposalId, rp, decision);
}

/**
 * The approver decides. Approve: only a passkey assertion over this change. Decline: a passkey assertion, or the
 * signed-in phone of this approver (as an order's decline). Anything else is refused and changes nothing.
 */
export async function decideRulesChange(rt: Runtime, req: Request, approvalId: string, body: { decision?: unknown; proof?: { kind?: unknown; response?: unknown }; note?: unknown }): Promise<RulesChangeView> {
  const session = sessionTokenOf(req);
  const f = await findRulesChange(approvalId);
  await requireRulesChangeReader(rt, req, f);
  const p = f.proposal;
  if (p.state !== "waiting" || !p.approval) throw new DockError(409, "approval_not_pending", "This change is no longer waiting for a sign-off.");
  if (lapsed(p)) {
    await rulesLapse(f.thread.kitchen, p.proposalId);
    throw new DockError(409, "rules_change_expired", "This change was not signed in time; nothing changed.");
  }
  const decision = body.decision === "decline" ? "decline" : body.decision === "approve" ? "approve" : undefined;
  if (!decision) throw new DockError(400, "invalid_request", 'Send { "decision": "approve" | "decline" }.');
  if (decision === "approve") {
    if (body.proof?.kind !== "webauthn") throw new DockError(400, "passkey_required", "A change that widens what the agent may do is signed with the approver's passkey.", "approver_identity");
    await rulesSignOff(f.thread.kitchen, p.proposalId, { kind: "webauthn", response: body.proof.response });
  } else {
    let proof: ApprovalProof;
    if (body.proof?.kind === "webauthn") proof = { kind: "webauthn", response: body.proof.response as never };
    else if (body.proof?.kind === "session" && session) proof = { kind: "approver_session", sessionToken: session };
    else throw new DockError(401, "approval_proof_missing", "Decline with your passkey, or from the phone you signed in with.", "approver_identity");
    const a = p.approval;
    const v = await rt.passkeys.verifier.verify({ approval: { approvalId: a.approvalId, approver: { role: a.approver.role, name: a.approver.name, maxApprovalCents: 0 } as never, status: "pending", orderDigest: a.digest, tokenHash: "0".repeat(64), requestedAt: a.requestedAt }, orgId: f.thread.orgId, orderDigest: a.digest, decision: "decline", now: new Date() }, proof);
    if (!v.ok) throw new DockError(403, v.reason, v.message, "approver_identity");
    const by = "approverName" in v.signOff ? v.signOff.approverName : a.approver.name;
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;
    await rulesDecline(f.thread.kitchen, p.proposalId, { by, at: v.signOff.at, method: v.signOff.method, ...(note ? { note } : {}) });
  }
  return rulesChangeView(rt, req, await findRulesChange(approvalId));
}

/** The approver's list: every change of this kitchen that waits for them, newest first. */
export async function pendingRulesChanges(orgId: string): Promise<{ approvalId: string; requestedAt: string; changes: RulesChangeView["changes"] }[]> {
  const store = await threadStore();
  return store
    .all()
    .filter((t) => t.orgId === orgId)
    .flatMap((t) => waitingProposals(t))
    .map((p) => ({ approvalId: p.approval!.approvalId, requestedAt: p.approval!.requestedAt, changes: p.approval!.shown ?? [] }))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}
