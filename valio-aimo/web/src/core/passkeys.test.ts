import { beforeEach, describe, expect, it } from "vitest";
import { compactVerify } from "jose";
import { InMemoryOutbox, approvalChallengeB64, orderDigest, type ApprovalProof } from "./approval";
import { InMemoryCatalog, MeteredCatalog } from "./catalog";
import { InMemoryEventBus, type DockEvent } from "./events";
import { generateEd25519KeyPair, type KeyPair } from "./keys";
import { Ledger } from "./ledger";
import { createTrustRegistry, signMandate } from "./mandate";
import { InMemoryDockRepository, createDock, type AgentSession, type Dock, type PublicOrder } from "./orders";
import { InMemoryPasskeyStore, PasskeyService, type RelyingParty } from "./passkeys";
import { SEED_PRODUCTS, SEED_STOCK } from "./seed";
import { sampleMandate } from "./test-fixtures";
import { SoftwareAuthenticator } from "./test-webauthn";
import { addMinutes } from "./util";

const START = new Date("2026-11-13T10:00:00.000Z");
const RP: RelyingParty = { id: "dock.test", name: "Dock", origins: ["https://dock.test"] };
const ROLE = "purchasing_manager";

let now: Date;
let demoTap: boolean;
let repo: InMemoryDockRepository;
let ledger: Ledger;
let outbox: InMemoryOutbox;
let events: InMemoryEventBus;
let seen: DockEvent[];
let passkeys: PasskeyService;
let registry: ReturnType<typeof createTrustRegistry>;
let wholesaler: KeyPair;
let dock: Dock;

beforeEach(async () => {
  now = START;
  demoTap = false;
  repo = new InMemoryDockRepository();
  ledger = new Ledger(undefined, () => now);
  outbox = new InMemoryOutbox();
  events = new InMemoryEventBus();
  seen = [];
  events.subscribe(() => true, (e) => seen.push(e));
  passkeys = new PasskeyService({ store: new InMemoryPasskeyStore(), now: () => now, demoTapEnabled: () => demoTap });
  registry = createTrustRegistry([]);
  wholesaler = await generateEd25519KeyPair("wholesaler-1");
  dock = createDock({
    catalog: new MeteredCatalog(new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, () => now)),
    repo,
    ledger,
    trustedIssuers: registry,
    wholesalerKey: wholesaler,
    notifier: outbox,
    verifier: passkeys.verifier,
    events,
    now: () => now,
  });
});

type Kitchen = { orgId: string; session: AgentSession; auth: SoftwareAuthenticator; approverId: string; sessionToken: string };

/** A buyer org whose mandate escalates above €500, with one approver who registered a passkey. */
async function kitchen(orgId: string, opts: { passkey?: boolean } = {}): Promise<Kitchen> {
  const key = await generateEd25519KeyPair(`${orgId}-key`);
  registry.add({ kid: key.kid, orgId, publicKey: key.publicKey });
  const mandate = sampleMandate(START, {
    mandateId: `mnd_${orgId}`,
    issuer: { orgId, name: `Kitchen ${orgId}` },
    agentId: `agent_${orgId}`,
    perOrderLimitCents: 50_000,
    weeklyBudgetCents: 1_000_000,
    approvers: [{ role: ROLE, name: `Approver of ${orgId}`, maxApprovalCents: 1_000_000 }],
  });
  const session = await dock.authenticate(await signMandate(mandate, key), mandate.agentId);
  const auth = new SoftwareAuthenticator(RP.origins[0]);
  const approverId = `apv_${orgId}`;
  const account = { approverId, orgId, role: ROLE, name: `Approver of ${orgId}`, userHandle: "", createdAt: START.toISOString() };
  if (opts.passkey === false) {
    await passkeys.enrol(account);
  } else {
    const { options } = await passkeys.registrationOptions(RP, { name: approverId, displayName: account.name }, { orgId });
    const reg = await passkeys.verifyRegistration(auth.register(options));
    expect(reg.context).toEqual({ orgId });
    await passkeys.enrol({ ...account, userHandle: reg.userHandle }, reg.credential);
  }
  const sessionToken = await passkeys.newSession(approverId, addMinutes(START, 120));
  return { orgId, session, auth, approverId, sessionToken };
}

/** 400 x 1 L at €1.49 = €596: over the €500 per-order limit, so it waits for sign-off. */
async function bigOrder(k: Kitchen, quantity = 400): Promise<PublicOrder> {
  const req = await dock.openRequest(k.session, { text: `${quantity} L lactose-free milk` });
  const { quote, quoteToken } = await dock.requestQuote(k.session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity }] });
  const order = await dock.placeOrder(k.session, {
    requestId: req.requestId,
    quoteToken,
    lines: quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })),
  });
  expect(order.status).toBe("pending_approval");
  return order;
}

async function optionsFor(order: PublicOrder, decision: "approve" | "decline" = "approve") {
  const ctx = await dock.approvalContext(order.approval!.approvalId);
  return passkeys.approvalOptions(RP, { approvalId: ctx.approval.approvalId, orgId: ctx.order.orgId, role: ctx.approval.approver.role, orderDigest: ctx.orderDigest, decision });
}

async function passkeyProof(k: Kitchen, order: PublicOrder, decision: "approve" | "decline" = "approve"): Promise<ApprovalProof> {
  return { kind: "webauthn", response: k.auth.assert(await optionsFor(order, decision)) };
}

const decide = (order: PublicOrder, proof: ApprovalProof, decision: "approve" | "decline" = "approve", note?: string) =>
  dock.decideApproval(order.approval!.approvalId, { decision, proof, note });

const statusOf = async (order: PublicOrder) => (await repo.getOrder(order.orderId))!.status;

describe("passkey sign-off", () => {
  it("approves with a passkey bound to the order, and keeps a proof anyone can re-check", async () => {
    const k = await kitchen("org_a");
    const order = await bigOrder(k);
    const done = await decide(order, await passkeyProof(k, order), "approve", "Fine");
    expect(done.status).toBe("committed");

    const s = done.approval!.signOff!;
    expect(s).toMatchObject({ method: "passkey", verified: true, decision: "approve", approverId: k.approverId, credentialId: k.auth.id, rpId: RP.id, origin: RP.origins[0], userVerified: true });
    if (s.method !== "passkey") throw new Error("unreachable");
    // The challenge the authenticator signed is derived from exactly this order's content.
    const stored = (await repo.getOrder(order.orderId))!;
    expect(s.orderDigest).toBe(orderDigest(stored));
    expect(s.challenge).toBe(approvalChallengeB64({ approvalId: order.approval!.approvalId, orderDigest: s.orderDigest, nonce: s.nonce, decision: "approve" }));
    expect(JSON.parse(Buffer.from(s.assertion.clientDataJSON, "base64url").toString()).challenge).toBe(s.challenge);

    const entry = ledger.entries({ orderId: order.orderId }).find((e) => e.type === "approval")!;
    expect(entry.summary).toMatch(/signed with a passkey/);
    expect(entry.summary).toMatch(/400 x VA-1001 at €1\.49, delivery 2026-11-14/);
    expect(entry.data.signOff).toMatchObject({ method: "passkey", credentialId: k.auth.id, orderDigest: s.orderDigest });
    expect(ledger.verify().ok).toBe(true);

    const { payload } = await compactVerify(done.confirmation!, wholesaler.publicKey);
    expect(JSON.parse(new TextDecoder().decode(payload)).authorisedBy).toMatchObject({
      kind: "approver",
      role: ROLE,
      signOff: { method: "passkey", verified: true, approverId: k.approverId, credentialId: k.auth.id, orderDigest: s.orderDigest },
    });
    expect(seen.map((e) => e.type)).toEqual(["approval_requested", "approval_approved", "order_committed"]);
    expect(seen.every((e) => e.orgId === "org_a" && e.orderId === order.orderId)).toBe(true);
  });

  it("a proof made for order A does not approve order B", async () => {
    const k = await kitchen("org_a");
    const a = await bigOrder(k);
    const b = await bigOrder(k, 401);
    const proofForA = await passkeyProof(k, a);
    await expect(decide(b, proofForA)).rejects.toMatchObject({ status: 403, code: "approval_proof_invalid", rule: "approver_identity", details: { reason: "challenge_other_approval" } });
    expect(await statusOf(b)).toBe("pending_approval");

    // Signing A's challenge while holding B's prompt does not help either.
    const optsA = await optionsFor(a);
    const optsB = await optionsFor(b);
    const forged = k.auth.assert(optsB, { overrideChallenge: optsA.challenge });
    await expect(decide(b, { kind: "webauthn", response: forged })).rejects.toMatchObject({ details: { reason: "challenge_other_approval" } });
    expect(await statusOf(b)).toBe("pending_approval");
  });

  it("a proof made for order A does not approve A after A was edited", async () => {
    const k = await kitchen("org_a");
    const a = await bigOrder(k);
    const proof = await passkeyProof(k, a);
    const before = (await dock.approvalContext(a.approval!.approvalId)).orderDigest;

    // Someone changes the stored order after the approver saw it: quantity, total, delivery date.
    const stored = (await repo.getOrder(a.orderId))!;
    stored.lines[0] = { ...stored.lines[0], quantity: 4000, lineTotalCents: 4000 * stored.lines[0].unitPriceCents, deliveryDate: "2026-11-20" };
    stored.totalCents = stored.lines[0].lineTotalCents;
    await repo.saveOrder(stored);
    await expect(decide(a, proof)).rejects.toMatchObject({ status: 409, code: "approval_order_changed" });

    // And at the cryptographic level: the verifier recomputes the challenge from the digest it is given.
    const edited = orderDigest(stored);
    expect(edited).not.toBe(before);
    const approval = (await repo.getOrder(a.orderId))!.approval!;
    const opts = await passkeys.approvalOptions(RP, { approvalId: approval.approvalId, orgId: "org_a", role: ROLE, orderDigest: before, decision: "approve" });
    const proof2: ApprovalProof = { kind: "webauthn", response: k.auth.assert(opts) }; // a fresh prompt over the original content
    const result = await passkeys.verifier.verify({ approval, orgId: "org_a", orderDigest: edited, decision: "approve", now }, proof2);
    expect(result).toMatchObject({ ok: false, reason: "order_changed" });
    expect(await statusOf(a)).toBe("pending_approval");
  });

  it("a passkey signature cannot be replayed, on the same order or another", async () => {
    const k = await kitchen("org_a");
    const a = await bigOrder(k);
    const proof = await passkeyProof(k, a);
    expect((await decide(a, proof)).status).toBe("committed");
    await expect(decide(a, proof)).rejects.toMatchObject({ status: 403, details: { reason: "challenge_unknown" } });
    const b = await bigOrder(k, 401);
    await expect(decide(b, proof)).rejects.toMatchObject({ status: 403, details: { reason: "challenge_unknown" } });
    expect(await statusOf(b)).toBe("pending_approval");
  });

  it("a passkey prompt expires after five minutes", async () => {
    const k = await kitchen("org_a");
    const a = await bigOrder(k);
    const proof = await passkeyProof(k, a);
    now = addMinutes(START, 6);
    await expect(decide(a, proof)).rejects.toMatchObject({ details: { reason: "challenge_expired" } });
    expect(await statusOf(a)).toBe("pending_approval");
  });

  it("approving after the fixed-price quote expired does not commit: the order closed as expired", async () => {
    const k = await kitchen("org_a");
    const a = await bigOrder(k);
    now = addMinutes(START, 31); // quotes hold for 30 minutes
    const proof = await passkeyProof(k, a).catch((e: unknown) => e);
    if (!(proof instanceof Error)) await expect(decide(a, proof as never)).rejects.toMatchObject({ status: 409, code: "approval_not_pending" });
    expect(await statusOf(a)).toBe("expired");
    expect(seen.map((e) => e.type)).toEqual(["approval_requested", "approval_expired"]);
  });

  it("refuses the wrong approver: another kitchen's passkey or phone", async () => {
    const a = await kitchen("org_a");
    const b = await kitchen("org_b");
    const order = await bigOrder(a);
    const opts = await optionsFor(order);
    await expect(decide(order, { kind: "webauthn", response: b.auth.assert(opts) })).rejects.toMatchObject({ status: 403, details: { reason: "wrong_approver" } });
    await expect(decide(order, { kind: "approver_session", sessionToken: b.sessionToken }, "decline")).rejects.toMatchObject({ details: { reason: "wrong_approver" } });
    demoTap = true;
    await expect(decide(order, { kind: "demo_tap", sessionToken: b.sessionToken })).rejects.toMatchObject({ details: { reason: "wrong_approver" } });
    expect(await statusOf(order)).toBe("pending_approval");
  });

  it("requires user verification (Face ID, fingerprint or PIN), and the decision the prompt was made for", async () => {
    const k = await kitchen("org_a");
    const a = await bigOrder(k);
    await expect(decide(a, await passkeyProof(k, a, "decline"), "approve")).rejects.toMatchObject({ details: { reason: "challenge_other_decision" } });
    k.auth.userVerified = false;
    await expect(decide(a, await passkeyProof(k, a))).rejects.toMatchObject({ details: { reason: "assertion_invalid" } });
    expect(await statusOf(a)).toBe("pending_approval");
  });

  it("does not accept the link token for an approver who signs with a passkey", async () => {
    const k = await kitchen("org_a");
    const a = await bigOrder(k);
    const token = new URL(outbox.messages()[0].link, "http://x").searchParams.get("token")!;
    await expect(decide(a, { kind: "link_token", token })).rejects.toMatchObject({ details: { reason: "passkey_required" } });
  });

  it("declines in one step from the registered phone, with an optional reason; that phone cannot approve without the passkey", async () => {
    const k = await kitchen("org_a");
    const a = await bigOrder(k);
    await expect(decide(a, { kind: "approver_session", sessionToken: k.sessionToken }, "approve")).rejects.toMatchObject({ details: { reason: "passkey_required" } });
    const done = await decide(a, { kind: "approver_session", sessionToken: k.sessionToken }, "decline", "Too expensive");
    expect(done.status).toBe("declined");
    expect(done.approval).toMatchObject({ status: "declined", note: "Too expensive", signOff: { method: "approver_session", decision: "decline" } });
    expect(seen.map((e) => e.type)).toEqual(["approval_requested", "approval_declined"]);
  });

  it("the demo tap fallback is off by default, and when on is recorded as unverified", async () => {
    const k = await kitchen("org_a", { passkey: false });
    const a = await bigOrder(k);
    await expect(decide(a, { kind: "demo_tap", sessionToken: k.sessionToken })).rejects.toMatchObject({ details: { reason: "demo_tap_disabled" } });
    await expect(decide(a, { kind: "demo_tap", sessionToken: "not-a-session" })).rejects.toMatchObject({ details: { reason: "session_invalid" } });
    expect(await statusOf(a)).toBe("pending_approval");

    demoTap = true;
    const done = await decide(a, { kind: "demo_tap", sessionToken: k.sessionToken });
    expect(done.status).toBe("committed");
    expect(done.approval!.signOff).toMatchObject({ method: "demo_tap", verified: false, warning: expect.stringMatching(/Not equivalent/) });
    const entry = ledger.entries({ orderId: a.orderId }).find((e) => e.type === "approval")!;
    expect(entry.summary).toMatch(/UNVERIFIED/);
    const { payload } = await compactVerify(done.confirmation!, wholesaler.publicKey);
    expect(JSON.parse(new TextDecoder().decode(payload)).authorisedBy.signOff).toMatchObject({ method: "demo_tap", verified: false });
  });

  it("a registration prompt is single-use and expires", async () => {
    const auth = new SoftwareAuthenticator(RP.origins[0]);
    const { options } = await passkeys.registrationOptions(RP, { name: "x", displayName: "X" });
    const response = auth.register(options);
    await passkeys.verifyRegistration(response);
    await expect(passkeys.verifyRegistration(response)).rejects.toMatchObject({ code: "registration_unknown" });

    const late = await passkeys.registrationOptions(RP, { name: "y", displayName: "Y" });
    now = addMinutes(START, 6);
    await expect(passkeys.verifyRegistration(new SoftwareAuthenticator(RP.origins[0]).register(late.options))).rejects.toMatchObject({ code: "registration_expired" });

    const wrongSite = await passkeys.registrationOptions(RP, { name: "z", displayName: "Z" });
    await expect(passkeys.verifyRegistration(new SoftwareAuthenticator("https://evil.test").register(wrongSite.options))).rejects.toMatchObject({ code: "registration_invalid" });
  });
});
