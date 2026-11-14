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
    expect(story).toEqual(["request", "lookup", "lookup", "lookup", "refusal", "lookup", "quote", "decision", "approval_requested", "approval", "order"]); // every live call is on the ledger, quotes' too
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

  const bigOrder = async () => {
    const req = await dock.openRequest(session, { text: "milk" });
    const { quote, quoteToken } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 700 }] });
    return dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) }); // €1,043: needs sign-off
  };
  const budgetRule = (o: { decision: { rules: { rule: string; outcome: string }[] } }) => o.decision.rules.find((r) => r.rule === "weekly_budget")?.outcome;

  it("committed spend is a hard weekly limit; money held by a waiting order sends the next one to a person", async () => {
    const first = await bigOrder();
    expect(first.status).toBe("pending_approval");
    // €1,043 waiting + €1,043 > €2,000: the agent may not spend the held money alone, a person decides (F-PENDING-HOLDS-BUDGET).
    const second = await bigOrder();
    expect(second.status).toBe("pending_approval");
    expect(budgetRule(second)).toBe("escalate");
    expect(second.decision.rules.find((r) => r.rule === "weekly_budget")?.reason).toContain(first.orderId);

    // Both signed: the first commits, the second's re-check now sees €1,043 committed and refuses it.
    const [m1, m2] = outbox.messages();
    expect((await dock.decideApproval(m1.approvalId, { decision: "approve", proof: { kind: "link_token", token: tokenFrom(m1.link) } })).status).toBe("committed");
    const late = await dock.decideApproval(m2.approvalId, { decision: "approve", proof: { kind: "link_token", token: tokenFrom(m2.link) } });
    expect(late.status).toBe("rejected");
    expect(budgetRule(late)).toBe("fail");
    // Committed money: a third is refused outright.
    const third = await bigOrder();
    expect(third.status).toBe("rejected");
    expect(budgetRule(third)).toBe("fail");
  });

  it("a declined, withdrawn or expired order stops holding the budget", async () => {
    const a = await bigOrder();
    const [msg] = outbox.messages();
    await dock.decideApproval(msg.approvalId, { decision: "decline", proof: { kind: "link_token", token: tokenFrom(msg.link) }, note: "Too much" });
    expect((await dock.getOrder(session, a.orderId)).status).toBe("declined");
    expect((await dock.budget(session)).spentCents).toBe(0);

    const b = await bigOrder();
    expect((await dock.budget(session)).heldCents).toBe(b.totalCents);
    const w = await dock.withdrawOrder(session, b.orderId, { reason: "ordered by phone instead", by: "Aino" });
    expect(w.status).toBe("withdrawn");
    expect(w.approval?.status).toBe("withdrawn");
    expect((await dock.budget(session)).spentCents).toBe(0);
    expect(ledger.entries().at(-1)?.summary).toMatch(/withdrawn before sign-off, at the request of Aino \(relayed by the agent, not verified\)/);
    await expect(dock.withdrawOrder(session, b.orderId)).rejects.toMatchObject({ status: 409, code: "order_not_pending" });
    const bApproval = outbox.messages().at(-1)!;
    await expect(dock.decideApproval(bApproval.approvalId, { decision: "approve", proof: { kind: "link_token", token: tokenFrom(bApproval.link) } })).rejects.toMatchObject({ status: 409, code: "approval_not_pending" });

    const c = await bigOrder();
    expect((await dock.budget(session)).heldCents).toBe(c.totalCents);
    now = addMinutes(START, 31); // the quote held its price for 30 minutes
    expect(await dock.budget(session)).toMatchObject({ spentCents: 0, heldCents: 0 });
    expect((await dock.getOrder(session, c.orderId)).status).toBe("expired");
    expect(ledger.entries().some((e) => e.orderId === c.orderId && /expired unsigned/.test(e.summary))).toBe(true);
  });

  it("only the organisation's own pending order can be withdrawn", async () => {
    const other = await generateEd25519KeyPair("other-org");
    const d2 = createDock({
      catalog,
      repo: new InMemoryDockRepository(),
      ledger,
      trustedIssuers: createTrustRegistry([{ kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey }, { kid: other.kid, orgId: "org_other", publicKey: other.publicKey }]),
      wholesalerKey: wholesaler,
      notifier: outbox,
      now: () => now,
    });
    const mine = await d2.authenticate(token, mandate.agentId);
    const m2 = { ...sampleMandate(START), mandateId: "mnd_other", issuer: { orgId: "org_other", name: "Other" } };
    const theirs = await d2.authenticate(await signMandate(m2, other), m2.agentId);
    const req = await d2.openRequest(mine, { text: "milk" });
    const { quote, quoteToken } = await d2.requestQuote(mine, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 700 }] });
    const o = await d2.placeOrder(mine, { requestId: req.requestId, quoteToken, lines: linesOf(quote) });
    await expect(d2.withdrawOrder(theirs, o.orderId)).rejects.toMatchObject({ status: 404 });
    const small = await d2.openRequest(mine, { text: "milk" });
    const sq = await d2.requestQuote(mine, { requestId: small.requestId, lines: [{ productId: "VA-1001", quantity: 2 }] });
    const committed = await d2.placeOrder(mine, { requestId: small.requestId, quoteToken: sq.quoteToken, lines: linesOf(sq.quote) });
    await expect(d2.withdrawOrder(mine, committed.orderId)).rejects.toMatchObject({ status: 409, code: "order_not_pending" });
  });

  it("works out substitutes from what the request asked for, whatever the agent declares (F-SUBST-SELF-DECLARED)", async () => {
    const strict = await dock.authenticate(await signMandate({ ...mandate, mandateId: "mnd_strict", substitution: { rule: "none", maxPriceIncreasePct: 0 } }, buyer), mandate.agentId);
    const req = await dock.openRequest(strict, { text: "20 x VA-1010 (200 L), no substitutes" });
    const q = await dock.requestQuote(strict, { requestId: req.requestId, lines: [{ productId: "AR-2010", quantity: 20 }] }); // not declared
    expect(q.quote.lines[0].substituteFor?.productId).toBe("VA-1010");
    const o = await dock.placeOrder(strict, { requestId: req.requestId, quoteToken: q.quoteToken, lines: linesOf(q.quote) });
    expect(o.status).toBe("rejected");
    expect(o.decision.rules.find((r) => r.rule === "substitution_rule")?.outcome).toBe("fail");

    // The price is compared with the product asked for, not with an 'original' the agent picks.
    const loose = await dock.authenticate(await signMandate({ ...mandate, mandateId: "mnd_loose", weeklyBudgetCents: 10_000_000, substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 } }, buyer), mandate.agentId);
    const r2 = await dock.openRequest(loose, { text: "100 L of VA-1010" });
    const masked = await dock.requestQuote(loose, { requestId: r2.requestId, lines: [{ productId: "JP-3010", quantity: 100, substituteFor: "VA-1201" }] });
    expect(masked.quote.lines[0].substituteFor?.productId).toBe("VA-1010");
    expect(masked.policyPreview.rules.find((r) => r.rule === "substitute_price")?.outcome).toBe("fail");

    // Ids only count when they exist; a plain amount is never read as one.
    const r3 = await dock.openRequest(loose, { text: "1000 L milk, ref 123456789" });
    expect((await dock.requestQuote(loose, { requestId: r3.requestId, lines: [{ productId: "VA-1001", quantity: 2 }] })).quote.lines[0].substituteFor).toBeUndefined();
  });

  it("moves a request's need-by date in one place: validated, logged, and refused once an order stands on it", async () => {
    const req = await dock.openRequest(session, { text: "milk for Friday", neededBy: "2026-11-20" });
    const moved = await dock.changeNeededBy(session, req.requestId, { neededBy: "2026-11-23", by: "Sanna", reason: "the event moved" });
    expect(moved.neededBy).toBe("2026-11-23");
    expect(ledger.entries({ requestId: req.requestId }).at(-1)).toMatchObject({ type: "intake", data: { step: "needed_by", from: "2026-11-20", to: "2026-11-23" } });
    expect((await dock.changeNeededBy(session, req.requestId, { neededBy: null })).neededBy).toBeUndefined();
    await expect(dock.changeNeededBy(session, req.requestId, { neededBy: "2026-11-01" })).rejects.toMatchObject({ status: 400, code: "needed_by_in_past" });
    await expect(dock.changeNeededBy(session, "req_nope", { neededBy: "2026-11-23" })).rejects.toMatchObject({ status: 404 });
    const { req: ordered } = await smallOrder();
    await expect(dock.changeNeededBy(session, ordered.requestId, { neededBy: "2026-11-23" })).rejects.toMatchObject({ status: 409, code: "request_has_order" });
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

  it("an approval after the quote expired does not commit: the order closed as expired when its price ran out", async () => {
    const { order, message, token: t } = await pendingOrder();
    now = addMinutes(START, 31);
    await expect(dock.decideApproval(message.approvalId, { decision: "approve", proof: { kind: "link_token", token: t } })).rejects.toMatchObject({ status: 409, code: "approval_not_pending" });
    const after = await dock.getOrder(session, order.orderId);
    expect(after.status).toBe("expired");
    expect(after.confirmation).toBeUndefined();
    expect(after.approval?.status).toBe("expired");
  });

  it("returns 404 for an unknown approval", async () => {
    await expect(dock.decideApproval("apr_nope", { decision: "approve", proof: { kind: "link_token", token: "x" } })).rejects.toBeInstanceOf(DockError);
  });
});

describe("ProductHolds: the gate checks a hold as the named rule recall_hold", () => {
  it("previews, refuses and keeps an order with a held product; the re-check at sign-off refuses one held after it waited", async () => {
    const held = new Set<string>();
    const d = createDock({
      catalog,
      repo: new InMemoryDockRepository(),
      ledger,
      trustedIssuers: createTrustRegistry([{ kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey }]),
      wholesalerKey: wholesaler,
      notifier: outbox,
      now: () => now,
      holds: { holdsFor: (ids) => ids.filter((id) => held.has(id)).map((productId) => ({ productId, reason: "Recall notice 7.", url: "https://notice.test/7" })) },
    });
    const s = await d.authenticate(token, mandate.agentId);
    held.add("VA-1001");
    const req = await d.openRequest(s, { text: "20 L lactose-free milk" });
    const q = await d.requestQuote(s, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
    expect(q.policyPreview.outcome).toBe("reject");
    const o = await d.placeOrder(s, { requestId: req.requestId, quoteToken: q.quoteToken, lines: linesOf(q.quote) });
    expect(o.status).toBe("rejected");
    expect(o.decision.rules.find((r) => r.rule === "recall_hold")).toMatchObject({ outcome: "fail", reason: expect.stringContaining("Notice: https://notice.test/7") });

    held.clear();
    const big = await d.openRequest(s, { text: "1000 L lactose-free milk" });
    const bq = await d.requestQuote(s, { requestId: big.requestId, lines: [{ productId: "VA-1001", quantity: 700 }] });
    const waiting = await d.placeOrder(s, { requestId: big.requestId, quoteToken: bq.quoteToken, lines: linesOf(bq.quote) });
    expect(waiting.status).toBe("pending_approval");
    held.add("VA-1001");
    const msg = outbox.messages().at(-1)!;
    const after = await d.decideApproval(msg.approvalId, { decision: "approve", proof: { kind: "link_token", token: tokenFrom(msg.link) } });
    expect(after.status).toBe("rejected");
    expect(after.decision.rules.find((r) => r.rule === "recall_hold")?.outcome).toBe("fail");
  });
});

// QA F-SLOW-PARTNER-WAIT: when the wholesaler's live service fails, a refusal that needs no price is still given.
describe("the gate when the wholesaler's live service does not answer", () => {
  beforeEach(() => {
    inner.getLiveStatus = async () => {
      throw new (await import("./catalog")).CatalogError("live_unavailable", "The wholesaler's live price and availability service is slow or busy right now (timeout).", 20);
    };
  });

  it("refuses a product the mandate forbids on its master data, naming the rule, without a live answer", async () => {
    const req = await dock.openRequest(session, { text: "oat drink" });
    await expect(dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "PK-4001", quantity: 10 }] })).rejects.toMatchObject({ status: 422, code: "policy_rejected", rule: "forbidden_allergens" });
    const refusal = ledger.entries({ requestId: req.requestId }).find((e) => e.type === "refusal");
    expect(refusal?.data).toMatchObject({ rule: "forbidden_allergens" });
    expect(refusal?.summary).toMatch(/product data alone/);
  });

  it("says a product the mandate allows cannot be priced now, with when to try again", async () => {
    const req = await dock.openRequest(session, { text: "milk" });
    await expect(dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 10 }] })).rejects.toMatchObject({ status: 503, code: "live_unavailable", details: { retryable: true, retryAfterSeconds: 20 } });
  });
});
