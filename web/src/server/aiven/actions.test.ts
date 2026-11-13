import { describe, expect, it } from "vitest";
import { InMemoryLedgerStore, Ledger, type LedgerInput } from "@/core/ledger";
import { createTestDock } from "./test-dock";
import { TappedLedgerStore, type ActionEvent, type ActionStream } from "./actions";

class Capture implements ActionStream {
  events: ActionEvent[] = [];
  emit(e: ActionEvent) {
    this.events.push(e);
  }
  async flush() {}
  async close() {}
  stats() {
    return { kind: "capture" };
  }
}

const entries: LedgerInput[] = [
  { type: "request", actor: "agent:a1", requestId: "req_1", summary: "opened", data: {} },
  { type: "lookup", actor: "agent:a1", requestId: "req_1", summary: "live", data: { source: "live", productIds: ["p1", "p2"] } },
  { type: "quote", actor: "dock", requestId: "req_1", summary: "quoted", data: { quoteId: "qt_1", totalCents: 12345 } },
  {
    type: "decision",
    actor: "dock",
    requestId: "req_1",
    orderId: "ord_1",
    summary: "needs sign-off",
    data: { outcome: "needs_human_approval", totalCents: 12345, rules: [{ rule: "per_order_limit", outcome: "escalate" }, { rule: "allergens", outcome: "pass" }] },
  },
  { type: "approval_requested", actor: "dock", requestId: "req_1", orderId: "ord_1", summary: "asked", data: { role: "head_chef" } },
  { type: "approval", actor: "approver:head_chef", requestId: "req_1", orderId: "ord_1", summary: "approved", data: { decision: "approved", signOff: { method: "passkey", verified: true } } },
  { type: "order", actor: "dock", requestId: "req_1", orderId: "ord_1", summary: "committed", data: {} },
  { type: "decision", actor: "dock", requestId: "req_1", orderId: "ord_2", summary: "refused", data: { outcome: "reject", totalCents: 500, rules: [{ rule: "quote_replay", outcome: "fail" }] } },
  { type: "refusal", actor: "agent:a1", summary: "bad mandate", data: { code: "mandate_signature_invalid", rule: "mandate_signature", status: 401 } },
];

describe("ledger entries become action events", () => {
  it("maps every entry type to one event with kind, rule, value and key", () => {
    const cap = new Capture();
    const ledger = new Ledger(new TappedLedgerStore(new InMemoryLedgerStore(), cap));
    for (const e of entries) ledger.append(e);
    const got = cap.events.map((e) => [e.kind, e.rule ?? null, e.value ?? null, e.key, e.agentId ?? null]);
    expect(got).toEqual([
      ["request.opened", null, null, "req_1", "a1"],
      ["lookup.live", null, null, "req_1", "a1"],
      ["quote.issued", null, 123.45, "req_1", "a1"],
      ["gate.escalated", "per_order_limit", 123.45, "ord_1", "a1"],
      ["approval.requested", "head_chef", null, "ord_1", "a1"],
      ["approval.granted", null, null, "ord_1", "a1"],
      ["order.committed", null, 123.45, "ord_1", "a1"], // EUR taken from the order's decision
      ["gate.refused", "quote_replay", 5, "ord_2", "a1"],
      ["gate.refused", "mandate_signature", null, "a1", "a1"],
    ]);
    for (const e of cap.events) {
      expect(e.v).toBe(1);
      expect(e.eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof e.ledgerSeq).toBe("number");
      expect(e.ledgerHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(ledger.verify().ok).toBe(true);
  });

  it("never lets a broken stream fail the append", () => {
    const broken: ActionStream = Object.assign(new Capture(), { emit: () => { throw new Error("kafka down"); } });
    const ledger = new Ledger(new TappedLedgerStore(new InMemoryLedgerStore(), broken));
    expect(() => ledger.append(entries[0])).not.toThrow();
    expect(ledger.entries()).toHaveLength(1);
  });

  it("covers a real order flow: decisions, refusals and the commit all produce events", async () => {
    const cap = new Capture();
    const { dock, session } = await createTestDock(new TappedLedgerStore(new InMemoryLedgerStore(), cap));
    const req = await dock.openRequest(session, { text: "20 L lactose-free milk" });
    const q = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const lines = q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));
    const order = await dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines });
    expect(order.status).toBe("committed");
    const replay = await dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines });
    expect(replay.status).toBe("rejected");
    const kinds = cap.events.map((e) => e.kind);
    expect(kinds).toEqual(["request.opened", "quote.issued", "gate.allowed", "order.committed", "gate.refused"]);
    expect(cap.events.at(-1)?.rule).toBe("quote_replay");
    expect(cap.events[3].value).toBe(order.totalCents / 100);
  });
});
