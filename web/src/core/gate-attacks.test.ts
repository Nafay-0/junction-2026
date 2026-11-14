import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryOutbox } from "./approval";
import { InMemoryCatalog, MeteredCatalog } from "./catalog";
import { addDaysIso, localNow } from "./kitchen";
import { generateEd25519KeyPair, type KeyPair } from "./keys";
import { Ledger } from "./ledger";
import { createTrustRegistry, signMandate, type Mandate } from "./mandate";
import { InMemoryDockRepository, createDock, type AgentSession, type Dock } from "./orders";
import { SEED_PRODUCTS, SEED_STOCK } from "./seed";
import { sampleMandate } from "./test-fixtures";
import { addMinutes } from "./util";

/**
 * Attempts to get an order past the gate that the other core tests do not already make (see orders.test.ts,
 * policy.test.ts, mandate.test.ts, quote.test.ts, passkeys.test.ts, ledger.test.ts for forged and replayed
 * mandates, quotes and sign-offs). A passing test here is the evidence that a path is closed. A test marked
 * `it.fails` is an open finding: it states what should happen, fails today, and turns the suite red the day
 * someone closes it, as the reminder to remove the mark.
 */
const START = new Date("2026-11-13T10:00:00.000Z");
const UNKNOWN_STOCK = Number.MAX_SAFE_INTEGER; // a product whose stock the wholesaler reports as a placeholder

let now: Date;
let wholesaler: KeyPair;
let outbox: InMemoryOutbox;
let ledger: Ledger;
let dock: Dock;
let laakso: { key: KeyPair; mandate: Mandate; session: AgentSession };
let other: { key: KeyPair; mandate: Mandate; session: AgentSession };

const linesOf = (q: { lines: { productId: string; quantity: number; unitPriceCents: number }[] }) => q.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));
const tokenFrom = (link: string) => new URL(link, "http://x").searchParams.get("token")!;

async function party(orgId: string, agentId: string, overrides: Partial<Mandate> = {}) {
  const key = await generateEd25519KeyPair(`${orgId}-key`);
  const mandate = sampleMandate(START, { mandateId: `mnd_${orgId}`, issuer: { orgId, name: orgId }, agentId, ...overrides });
  return { key, mandate };
}

beforeEach(async () => {
  now = START;
  wholesaler = await generateEd25519KeyPair("dock-wholesaler-1");
  outbox = new InMemoryOutbox();
  ledger = new Ledger(undefined, () => now);
  const a = await party("org_laakso", "agent_buyer_1");
  const b = await party("org_other", "agent_other_1");
  dock = createDock({
    catalog: new MeteredCatalog(new InMemoryCatalog(SEED_PRODUCTS, { ...SEED_STOCK, "VA-1002": { ...SEED_STOCK["VA-1002"], availablePacks: UNKNOWN_STOCK } }, () => now)),
    repo: new InMemoryDockRepository(),
    ledger,
    trustedIssuers: createTrustRegistry([
      { kid: a.key.kid, orgId: "org_laakso", publicKey: a.key.publicKey },
      { kid: b.key.kid, orgId: "org_other", publicKey: b.key.publicKey },
    ]),
    wholesalerKey: wholesaler,
    notifier: outbox,
    now: () => now,
  });
  laakso = { ...a, session: await dock.authenticate(await signMandate(a.mandate, a.key), a.mandate.agentId) };
  other = { ...b, session: await dock.authenticate(await signMandate(b.mandate, b.key), b.mandate.agentId) };
});

async function quoteFor(who: { session: AgentSession }, productId: string, quantity: number, request: { deliverOn?: string } = {}) {
  const req = await dock.openRequest(who.session, { text: "lactose-free milk", ...request });
  const q = await dock.requestQuote(who.session, { requestId: req.requestId, lines: [{ productId, quantity }] });
  return { req, ...q };
}

describe("amounts an agent might try", () => {
  it("refuses a negative, zero, fractional or absurdly large quantity with a named error, never a crash", async () => {
    const req = await dock.openRequest(laakso.session, { text: "milk" });
    // VA-1002's stock is a placeholder here, as the partner reports for some products: no stock check stops a huge number.
    for (const quantity of [-5, 0, 0.5, 1_000_001, 1e15, Number.MAX_SAFE_INTEGER, 1e300]) {
      await expect(dock.requestQuote(laakso.session, { requestId: req.requestId, lines: [{ productId: "VA-1002", quantity }] }), `quantity ${quantity}`).rejects.toMatchObject({ name: "DockError", status: 400, code: "quote_invalid_line" });
    }
    for (const quantity of ["7", null, undefined, {}, [3]]) {
      await expect(dock.requestQuote(laakso.session, { requestId: req.requestId, lines: [{ productId: "VA-1002", quantity: quantity as never }] })).rejects.toMatchObject({ name: "DockError", status: 400 });
    }
    expect(await dock.listOrders()).toHaveLength(0);
  });

  it("an order cannot state other amounts or prices than the quote, in either direction", async () => {
    const { req, quote, quoteToken } = await quoteFor(laakso, "VA-1001", 20);
    for (const lines of [
      [{ ...linesOf(quote)[0], quantity: 2000 }],
      [{ ...linesOf(quote)[0], unitPriceCents: 1 }],
      [{ ...linesOf(quote)[0], quantity: 20.0000001 }],
      [{ ...linesOf(quote)[0], unitPriceCents: -149 }],
      [...linesOf(quote), ...linesOf(quote)],
      [],
    ]) {
      const o = await dock.placeOrder(laakso.session, { requestId: req.requestId, quoteToken, lines });
      expect(o.status).toBe("rejected");
      expect(o.decision.rules.find((r) => r.rule === "order_matches_quote")?.outcome).toBe("fail");
    }
    expect((await dock.placeOrder(laakso.session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) })).status).toBe("committed");
  });
});

describe("someone else's papers", () => {
  it("a quote the wholesaler signed for one organisation buys nothing for another", async () => {
    const theirs = await quoteFor(laakso, "VA-1001", 20);
    const mine = await dock.openRequest(other.session, { text: "milk" });
    const o = await dock.placeOrder(other.session, { requestId: mine.requestId, quoteToken: theirs.quoteToken, lines: linesOf(theirs.quote) });
    expect(o.status).toBe("rejected");
    expect(o.decision.rules.find((r) => r.rule === "quote_binding")?.outcome).toBe("fail");
    // Nor can the other agent place it under the first organisation's request.
    await expect(dock.placeOrder(other.session, { requestId: theirs.req.requestId, quoteToken: theirs.quoteToken, lines: linesOf(theirs.quote) })).rejects.toMatchObject({ status: 404, code: "request_not_found" });
  });

  it("the sign-off link of one order does not sign another order of the same kitchen", async () => {
    const a = await quoteFor(laakso, "VA-1001", 700); // €1,043: over the €1,000 limit
    const b = await quoteFor(laakso, "VA-1001", 690);
    const orderA = await dock.placeOrder(laakso.session, { requestId: a.req.requestId, quoteToken: a.quoteToken, lines: linesOf(a.quote) });
    const orderB = await dock.placeOrder(laakso.session, { requestId: b.req.requestId, quoteToken: b.quoteToken, lines: linesOf(b.quote) });
    expect([orderA.status, orderB.status]).toEqual(["pending_approval", "pending_approval"]);
    const tokenA = tokenFrom(outbox.messages().find((m) => m.orderId === orderA.orderId)!.link);
    await expect(dock.decideApproval(orderB.approval!.approvalId, { decision: "approve", proof: { kind: "link_token", token: tokenA } })).rejects.toMatchObject({ status: 403, code: "approval_proof_invalid" });
    expect((await dock.getOrder(laakso.session, orderB.orderId)).status).toBe("pending_approval");
    // The agent holds no proof of any kind: a session or demo-tap proof it makes up is refused too.
    for (const proof of [{ kind: "approver_session" as const, sessionToken: "made-up" }, { kind: "demo_tap" as const, sessionToken: "made-up" }]) {
      await expect(dock.decideApproval(orderA.approval!.approvalId, { decision: "approve", proof })).rejects.toMatchObject({ status: 403, code: "approval_proof_invalid" });
    }
    expect((await dock.getOrder(laakso.session, orderA.orderId)).status).toBe("pending_approval");
  });
});

describe("time", () => {
  it("a sign-off given after the mandate ran out does not commit the order", async () => {
    const short = await party("org_laakso", "agent_buyer_1", { mandateId: "mnd_short", validUntil: addMinutes(START, 10).toISOString() });
    const session = await dock.authenticate(await signMandate(short.mandate, laakso.key), short.mandate.agentId);
    const { req, quote, quoteToken } = await quoteFor({ session }, "VA-1001", 700);
    const order = await dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) });
    expect(order.status).toBe("pending_approval");
    now = addMinutes(START, 15); // the quote still holds (30 minutes); the mandate does not
    const decided = await dock.decideApproval(order.approval!.approvalId, { decision: "approve", proof: { kind: "link_token", token: tokenFrom(outbox.messages()[0].link) } });
    expect(decided.status).toBe("rejected");
    expect(decided.decision.rules.find((r) => r.rule === "mandate_window")?.outcome).toBe("fail");
    expect(decided.confirmation).toBeUndefined();
  });
});

describe("racing", () => {
  it("ten orders placed at once never commit more than the weekly budget", async () => {
    // Each €894, within the €1,000 the agent may spend alone; the week's budget is €2,000: at most two fit.
    const quotes = await Promise.all(Array.from({ length: 10 }, (_, i) => quoteFor(laakso, "VA-1001", 600, { deliverOn: addDaysIso(localNow(START).date, 1 + (i % 4)) })));
    const orders = await Promise.all(quotes.map((q) => dock.placeOrder(laakso.session, { requestId: q.req.requestId, quoteToken: q.quoteToken, lines: linesOf(q.quote) })));
    const spent = orders.filter((o) => o.status === "committed" || o.status === "pending_approval").reduce((s, o) => s + o.totalCents, 0);
    expect(spent).toBeLessThanOrEqual(laakso.mandate.weeklyBudgetCents);
    expect(orders.filter((o) => o.status === "rejected").length).toBeGreaterThanOrEqual(8);
  });
});

describe("the record", () => {
  it("every order, committed, waiting or refused, has its decision in a ledger that verifies", async () => {
    const ok = await quoteFor(laakso, "VA-1001", 20);
    await dock.placeOrder(laakso.session, { requestId: ok.req.requestId, quoteToken: ok.quoteToken, lines: linesOf(ok.quote) });
    const big = await quoteFor(laakso, "VA-1001", 700);
    await dock.placeOrder(laakso.session, { requestId: big.req.requestId, quoteToken: big.quoteToken, lines: linesOf(big.quote) });
    const wrong = await quoteFor(laakso, "VA-1110", 5); // ordinary milk on a lactose-free mandate
    await dock.placeOrder(laakso.session, { requestId: wrong.req.requestId, quoteToken: wrong.quoteToken, lines: linesOf(wrong.quote) });
    const orders = await dock.listOrders();
    expect(orders.map((o) => o.status).sort()).toEqual(["committed", "pending_approval", "rejected"]);
    for (const o of orders) expect(ledger.entries({ orderId: o.orderId }).map((e) => e.type), o.status).toContain("decision");
    expect(ledger.verify().ok).toBe(true);
  });
});

describe("open finding: splitting one need across delivery days", () => {
  it("control: two orders under the limit for the same day are read together and go to a person", async () => {
    const day = addDaysIso(localNow(START).date, 1);
    const first = await quoteFor(laakso, "VA-1001", 600, { deliverOn: day });
    expect((await dock.placeOrder(laakso.session, { requestId: first.req.requestId, quoteToken: first.quoteToken, lines: linesOf(first.quote) })).status).toBe("committed");
    const second = await quoteFor(laakso, "VA-1001", 600, { deliverOn: day });
    expect((await dock.placeOrder(laakso.session, { requestId: second.req.requestId, quoteToken: second.quoteToken, lines: linesOf(second.quote) })).status).toBe("pending_approval");
  });

  // OPEN (design decision, not patched): order_splitting counts earlier orders only for the same request, or the same
  // category AND the same delivery day. Asking for the second half a day later is enough to spend €1,788 alone under a
  // €1,000 per-order limit, minutes apart. The weekly budget still holds. Options: count agent-alone spend per
  // category over the window whatever the day; or add a daily "alone" ceiling to the mandate; or say plainly that the
  // per-order limit is per order and the weekly budget is the ceiling.
  it.fails("two orders under the limit for the same product, a day apart, are read together too", async () => {
    const first = await quoteFor(laakso, "VA-1001", 600, { deliverOn: addDaysIso(localNow(START).date, 1) });
    expect((await dock.placeOrder(laakso.session, { requestId: first.req.requestId, quoteToken: first.quoteToken, lines: linesOf(first.quote) })).status).toBe("committed");
    const second = await quoteFor(laakso, "VA-1001", 600, { deliverOn: addDaysIso(localNow(START).date, 2) });
    expect((await dock.placeOrder(laakso.session, { requestId: second.req.requestId, quoteToken: second.quoteToken, lines: linesOf(second.quote) })).status).toBe("pending_approval");
  });
});
