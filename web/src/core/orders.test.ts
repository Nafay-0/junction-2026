import { beforeEach, describe, expect, it } from "vitest";
import { compactVerify } from "jose";
import { InMemoryOutbox } from "./approval";
import { InMemoryCatalog, MeteredCatalog } from "./catalog";
import { generateEd25519KeyPair, type KeyPair } from "./keys";
import { Ledger } from "./ledger";
import { createTrustRegistry, signMandate, type Mandate } from "./mandate";
import { DockError, InMemoryDockRepository, createDock, type AgentSession, type Dock } from "./orders";
import { SEED_PRODUCTS, SEED_STOCK } from "./seed";
import { sampleMandate } from "./test-fixtures";
import { addMinutes } from "./util";

const START = new Date("2026-11-13T10:00:00.000Z");

let now: Date;
let buyer: KeyPair;
let wholesaler: KeyPair;
let outbox: InMemoryOutbox;
let ledger: Ledger;
let catalog: MeteredCatalog;
let inner: InMemoryCatalog;
let dock: Dock;
let mandate: Mandate;
let token: string;
let session: AgentSession;

beforeEach(async () => {
  now = START;
  buyer = await generateEd25519KeyPair("laakso-key-1");
  wholesaler = await generateEd25519KeyPair("dock-wholesaler-1");
  outbox = new InMemoryOutbox();
  ledger = new Ledger(undefined, () => now);
  inner = new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, () => now);
  catalog = new MeteredCatalog(inner);
  dock = createDock({
    catalog,
    repo: new InMemoryDockRepository(),
    ledger,
    trustedIssuers: createTrustRegistry([{ kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey }]),
    wholesalerKey: wholesaler,
    notifier: outbox,
    now: () => now,
  });
  mandate = sampleMandate(START);
  token = await signMandate(mandate, buyer);
  session = await dock.authenticate(token, mandate.agentId);
});

const linesOf = (q: { lines: { productId: string; quantity: number; unitPriceCents: number }[] }) =>
  q.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));

const tokenFrom = (link: string) => new URL(link, "http://x").searchParams.get("token")!;

async function smallOrder() {
  const req = await dock.openRequest(session, { text: "20 L lactose-free milk" });
  const { quote, quoteToken } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
  return { req, quote, quoteToken, order: await dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) }) };
}

describe("authentication", () => {
  it("accepts a valid mandate for the agent it names", () => {
    expect(session.mandate.mandateId).toBe("mnd_test_1");
  });

  it("refuses a missing, tampered or foreign mandate with a named rule, and logs the refusal", async () => {
    await expect(dock.authenticate(undefined, "agent_buyer_1")).rejects.toMatchObject({ status: 401, code: "mandate_missing" });
    const [h, p, s] = token.split(".");
    const body = JSON.parse(Buffer.from(p, "base64url").toString());
    body.mandate.weeklyBudgetCents = 99_999_999;
    const tampered = [h, Buffer.from(JSON.stringify(body)).toString("base64url"), s].join(".");
    await expect(dock.authenticate(tampered, "agent_buyer_1")).rejects.toMatchObject({ status: 401, code: "mandate_signature_invalid" });
    const stranger = await generateEd25519KeyPair("stranger");
    await expect(dock.authenticate(await signMandate(mandate, stranger), "agent_buyer_1")).rejects.toMatchObject({ code: "mandate_unknown_issuer" });
    expect(ledger.entries().filter((e) => e.type === "refusal")).toHaveLength(3);
  });

  it("refuses a mandate presented by a different agent", async () => {
    await expect(dock.authenticate(token, "agent_intruder")).rejects.toMatchObject({ status: 403, code: "mandate_agent_mismatch", rule: "mandate_agent" });
  });

  it("refuses an expired mandate", async () => {
    now = new Date(Date.parse(mandate.validUntil) + 1);
    await expect(dock.authenticate(token, mandate.agentId)).rejects.toMatchObject({ status: 401, code: "mandate_expired" });
  });
});

describe("the partner's example, end to end", () => {
  it("request -> lookup -> partial stock -> substitute -> sign-off -> committed, all on the ledger", async () => {
    const req = await dock.openRequest(session, { text: "1,000 L lactose-free milk by Monday", neededBy: "2026-11-16" });
    const found = await dock.searchProducts(session, { requestId: req.requestId, text: "milk", category: "milk", attributes: ["lactose_free"] });
    expect(found.length).toBeGreaterThan(3);

    const offers = await dock.checkAvailability(session, { requestId: req.requestId, productIds: ["VA-1010", "AR-2010", "VA-1001"] });
    expect(offers.find((o) => o.productId === "VA-1010")?.availablePacks).toBe(60); // only 600 L

    await expect(
      dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1010", quantity: 100 }] }),
    ).rejects.toMatchObject({ status: 409, code: "quote_insufficient_stock", details: { available: 60 } });

    const { quote, quoteToken, policyPreview } = await dock.requestQuote(session, {
      requestId: req.requestId,
      lines: [
        { productId: "VA-1010", quantity: 60 },
        { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" },
      ],
    });
    expect(quote.totalCents).toBe(132_200);
    expect(policyPreview.outcome).toBe("needs_human_approval");

    const order = await dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) });
    expect(order.status).toBe("pending_approval");
    expect(order.decision.outcome).toBe("needs_human_approval");
    expect(order.approval?.approver.role).toBe("kitchen_manager");
    expect(JSON.stringify(order)).not.toMatch(/tokenHash/); // never handed out

    const pending = await dock.listPendingApprovals();
    expect(pending.map((p) => p.orderId)).toEqual([order.orderId]);

    const [message] = outbox.messages();
    expect(message.approver.name).toBe("Aino Virtanen");
    now = addMinutes(START, 3);
    const done = await dock.decideApproval(message.approvalId, { decision: "approve", proof: { kind: "link_token", token: tokenFrom(message.link) } });
    expect(done.status).toBe("committed");
    expect(done.approval?.status).toBe("approved");

    const { payload, protectedHeader } = await compactVerify(done.confirmation!, wholesaler.publicKey);
    expect(protectedHeader.typ).toBe("order+jws");
    const confirmation = JSON.parse(new TextDecoder().decode(payload));
    expect(confirmation).toMatchObject({ orderId: order.orderId, totalCents: 132_200, authorisedBy: { kind: "approver", role: "kitchen_manager" } });
    expect(ledger.verify(confirmation.ledgerHead).ok).toBe(false); // ledger grew after the confirmation was signed
    expect(ledger.entries().find((e) => e.seq === confirmation.ledgerHead.seq)?.hash).toBe(confirmation.ledgerHead.hash);

    const story = ledger.entries({ requestId: req.requestId }).map((e) => e.type);
    expect(story).toEqual(["request", "lookup", "lookup", "refusal", "quote", "decision", "approval_requested", "approval", "order"]);
    expect(ledger.verify().ok).toBe(true);
    expect(catalog.stats()).toMatchObject({ liveCalls: 3 }); // availability + failed quote + quote
    expect(await dock.listPendingApprovals()).toEqual([]);
  });
});

describe("orders", () => {
  it("commits a small compliant order straight away", async () => {
    const { order } = await smallOrder();
    expect(order.status).toBe("committed");
    expect(order.confirmation).toBeTruthy();
    expect(outbox.messages()).toHaveLength(0);
  });

  it("refuses to reuse a quote, and keeps the first order", async () => {
    const { req, quote, quoteToken, order } = await smallOrder();
    const again = await dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) });
    expect(again.status).toBe("rejected");
    expect(again.decision.rules.find((r) => r.rule === "quote_replay")?.outcome).toBe("fail");
    expect((await dock.getOrder(session, order.orderId)).status).toBe("committed");
  });

  it("lets only one of two simultaneous orders on the same quote through", async () => {
    const req = await dock.openRequest(session, { text: "milk" });
    const { quote, quoteToken } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const input = { requestId: req.requestId, quoteToken, lines: linesOf(quote) };
    const results = await Promise.all([dock.placeOrder(session, input), dock.placeOrder(session, input)]);
    expect(results.map((o) => o.status).sort()).toEqual(["committed", "rejected"]);
  });

  it("does not burn the quote on a rejected attempt", async () => {
    const req = await dock.openRequest(session, { text: "milk" });
    const { quote, quoteToken } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const cheat = await dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: [{ productId: "VA-1001", quantity: 20, unitPriceCents: 1 }] });
    expect(cheat.status).toBe("rejected");
    const honest = await dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) });
    expect(honest.status).toBe("committed");
  });

  it("refuses a forged quote before it reaches the policy, and logs it", async () => {
    const forger = await generateEd25519KeyPair("dock-wholesaler-1");
    const req = await dock.openRequest(session, { text: "milk" });
    const { quote } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const { signQuote } = await import("./quote");
    const forged = await signQuote({ ...quote, quoteId: "qt_forged" }, forger);
    await expect(dock.placeOrder(session, { requestId: req.requestId, quoteToken: forged, lines: linesOf(quote) })).rejects.toMatchObject({
      status: 422,
      code: "quote_signature_invalid",
      rule: "quote_signature",
    });
    expect(ledger.entries().at(-1)?.type).toBe("refusal");
  });

  it("counts committed and pending orders against the weekly budget, but not declined ones", async () => {
    const bigOrder = async () => {
      const req = await dock.openRequest(session, { text: "milk" });
      const { quote, quoteToken } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 700 }] });
      return dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) }); // €1,043: needs sign-off
    };
    const first = await bigOrder();
    expect(first.status).toBe("pending_approval");
    const second = await bigOrder(); // €1,043 pending + €1,043 > €2,000
    expect(second.status).toBe("rejected");
    expect(second.decision.rules.find((r) => r.rule === "weekly_budget")?.outcome).toBe("fail");

    const [msg] = outbox.messages();
    await dock.decideApproval(msg.approvalId, { decision: "decline", proof: { kind: "link_token", token: tokenFrom(msg.link) }, note: "Too much" });
    expect((await dock.getOrder(session, first.orderId)).status).toBe("declined");
    expect((await bigOrder()).status).toBe("pending_approval"); // budget freed
  });

  it("refuses a request id that belongs to someone else", async () => {
    await expect(dock.searchProducts(session, { requestId: "req_nope", text: "milk" })).rejects.toMatchObject({ status: 404, code: "request_not_found" });
  });

  it("refuses a bulk live lookup", async () => {
    const req = await dock.openRequest(session, { text: "everything" });
    const ids = SEED_PRODUCTS.map((p) => p.id);
    await expect(dock.checkAvailability(session, { requestId: req.requestId, productIds: ids })).rejects.toMatchObject({ status: 400, code: "too_many_products" });
  });

  it("does not show one organisation's orders to another", async () => {
    const { order } = await smallOrder();
    const other = { mandate: { ...mandate, issuer: { orgId: "org_other", name: "Other" } }, agentId: mandate.agentId };
    await expect(dock.getOrder(other, order.orderId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("approvals", () => {
  async function pendingOrder() {
    const req = await dock.openRequest(session, { text: "milk" });
    const { quote, quoteToken } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 700 }] });
    const order = await dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) });
    const message = outbox.messages().at(-1)!;
    return { order, message, token: tokenFrom(message.link) };
  }

  it("refuses a wrong token and leaves the order pending", async () => {
    const { order, message } = await pendingOrder();
    await expect(
      dock.decideApproval(message.approvalId, { decision: "approve", proof: { kind: "link_token", token: "guess" } }),
    ).rejects.toMatchObject({ status: 403, code: "approval_proof_invalid" });
    expect((await dock.getOrder(session, order.orderId)).status).toBe("pending_approval");
    expect(ledger.entries().at(-1)?.type).toBe("refusal");
  });

  it("cannot be decided twice", async () => {
    const { message, token: t } = await pendingOrder();
    await dock.decideApproval(message.approvalId, { decision: "approve", proof: { kind: "link_token", token: t } });
    await expect(dock.decideApproval(message.approvalId, { decision: "decline", proof: { kind: "link_token", token: t } })).rejects.toMatchObject({
      status: 409,
      code: "approval_not_pending",
    });
  });

  it("re-checks at sign-off: an approval after the quote expired does not commit", async () => {
    const { order, message, token: t } = await pendingOrder();
    now = addMinutes(START, 31);
    const result = await dock.decideApproval(message.approvalId, { decision: "approve", proof: { kind: "link_token", token: t } });
    expect(result.status).toBe("rejected");
    expect(result.decision.rules.find((r) => r.rule === "quote_expiry")?.outcome).toBe("fail");
    expect(result.confirmation).toBeUndefined();
    expect((await dock.getOrder(session, order.orderId)).status).toBe("rejected");
  });

  it("returns 404 for an unknown approval", async () => {
    await expect(dock.decideApproval("apr_nope", { decision: "approve", proof: { kind: "link_token", token: "x" } })).rejects.toBeInstanceOf(DockError);
  });
});
