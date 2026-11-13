import { beforeEach, describe, expect, it } from "vitest";
import { signMandate } from "@/core/mandate";
import type { AgentSession } from "@/core/orders";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { getRuntime, resetRuntime, type Runtime } from "../runtime";
import { buildTrace, exclusionBucket, groupExclusions } from "./trace";

let rt: Runtime;
let session: AgentSession;

beforeEach(async () => {
  resetRuntime();
  rt = await getRuntime();
  const token = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
  session = await rt.dock.authenticate(token, DEMO_ORG.agentId);
});

const linesOf = (q: { lines: { productId: string; quantity: number; unitPriceCents: number }[] }) => q.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));

async function partnerExample() {
  const { dock, outbox } = rt;
  const neededBy = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const req = await dock.openRequest(session, { text: "1,000 L lactose-free milk by Monday", neededBy });
  await dock.searchProducts(session, { requestId: req.requestId, text: "milk", category: "milk", attributes: ["lactose_free"] });
  await dock.checkAvailability(session, { requestId: req.requestId, productIds: ["VA-1010", "AR-2010", "VA-1001"] });
  const { quote, quoteToken } = await dock.requestQuote(session, {
    requestId: req.requestId,
    lines: [
      { productId: "VA-1010", quantity: 60 },
      { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" },
    ],
  });
  const order = await dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) });
  return { req, quote, quoteToken, order, outbox };
}

const traceOf = async (requestId: string, catalogueSize = 12) =>
  buildTrace({ requestId, entries: rt.dock.ledger.entries(), orders: await rt.dock.listOrders(), catalogueSize, names: { "VA-1010": "Valio lactose-free milk 1.5 %, 10 L bag-in-box" } });

describe("the flow trace", () => {
  it("lays one request out as a path, in ledger order, from the buyer's words to the signed order", async () => {
    const { req, order, outbox } = await partnerExample();
    const [msg] = outbox.messages();
    await rt.dock.decideApproval(msg.approvalId, { decision: "approve", proof: { kind: "link_token", token: new URL(msg.link, "http://x").searchParams.get("token")! } });

    const t = await traceOf(req.requestId);
    expect(t.steps.map((s) => s.phase)).toEqual(["asked", "searched", "priced", "priced", "quoted", "gate", "signoff", "signoff", "committed"]);
    const seqs = t.steps.map((s) => s.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    for (const s of t.steps) expect(rt.dock.ledger.entries().find((e) => e.seq === s.seq)?.hash).toBe(s.ledger.hash); // every step is its ledger entry

    expect(t.steps[0].lines[0]).toContain("1,000 L lactose-free milk by Monday");
    expect(t.priced).toBe(3);
    expect(t.considered).toBeGreaterThanOrEqual(3);
    const live = t.steps.find((s) => s.phase === "priced")!;
    expect(live.untouched).toBe("The other 9 products in the catalogue were not sent to the live service.");
    expect(live.products?.[0].name).toContain("Valio"); // product names, not codes

    const gate = t.steps.find((s) => s.phase === "gate")!;
    expect(gate.tone).toBe("safety");
    expect(gate.title).toContain("Aino Virtanen");
    expect(gate.checks?.find((c) => c.rule === "per_order_limit")).toMatchObject({ outcome: "escalate", reason: expect.stringContaining("per-order limit") });
    expect(gate.checks?.find((c) => c.rule === "substitution_rule")?.outcome).toBe("escalate");
    expect(gate.checks?.every((c) => c.title && !c.title.includes("_"))).toBe(true); // plain words on the surface

    const signed = t.steps.filter((s) => s.phase === "signoff")[1];
    expect(signed.title).toMatch(/Aino Virtanen approved it, through the one-time link/);
    expect(t.steps.at(-1)).toMatchObject({ phase: "committed", tone: "done" });
    expect(t.outcome).toEqual({ kind: "committed", label: "Signed order, approved by Aino Virtanen" });
    expect(t.orderIds).toEqual([order.orderId]);
  });

  it("shows a refused order with the rule that stopped it, and a waiting one as waiting", async () => {
    const { req, quoteToken, quote } = await partnerExample();
    expect((await traceOf(req.requestId)).outcome.kind).toBe("waiting");
    // replaying the same quote: the gate refuses it by name
    await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: linesOf(quote) });
    const t = await traceOf(req.requestId);
    const refused = t.steps.filter((s) => s.phase === "gate").at(-1)!;
    expect(refused.title).toBe("The gate refused it: a quote buys only once");
    expect(refused.checks?.find((c) => c.rule === "quote_replay")?.outcome).toBe("fail");
  });

  it("records a refusal before the gate as its own step", async () => {
    const req = await rt.dock.openRequest(session, { text: "milk" });
    await expect(rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1010", quantity: 100_000 }] })).rejects.toMatchObject({ rule: "quote_availability" });
    const t = await traceOf(req.requestId);
    expect(t.steps.at(-1)).toMatchObject({ phase: "refused", tone: "safety", title: "Refused: only what is in stock" });
    expect(t.outcome.kind).toBe("refused");
  });

  it("keeps the kitchen's memory out: it names that memory was used, never what it holds", () => {
    const entries = [
      { seq: 0, at: "2026-11-13T10:00:00.000Z", type: "request", actor: "agent:a", requestId: "req_1", summary: "Agent a of Kaari opened a request", data: { text: "milk for Friday" }, prevHash: "0", hash: "h0" },
      { seq: 1, at: "2026-11-13T10:00:01.000Z", type: "intake", actor: "dock", requestId: "req_1", summary: "Dock asked 1 question: Which fat?", data: { step: "questions", reasons: ["From memory: Always lactose-free (stated earlier)"] }, prevHash: "h0", hash: "h1" },
      { seq: 2, at: "2026-11-13T10:00:02.000Z", type: "intake", actor: "dock", requestId: "req_1", summary: "Dock found 1 thing", data: { step: "concerns", concerns: [{ key: "k", code: "quantity_tenfold" }], reasons: ["quantity_tenfold: You usually order 100 L; is 1,000 L right?"] }, prevHash: "h1", hash: "h2" },
    ] as never;
    const t = buildTrace({ requestId: "req_1", entries });
    const text = JSON.stringify(t.steps.map((s) => [s.title, s.lines, s.facts]));
    expect(text).not.toContain("Always lactose-free");
    expect(text).not.toContain("100 L");
    expect(text).toContain("came from the kitchen's own memory");
    expect(text).toContain("about ten times the kitchen's usual");
    expect(t.orgName).toBe("Kaari");
  });

  it("groups ruled-out products by why, using the stated code first", () => {
    expect(exclusionBucket("VA-1 lacks required attribute(s): lactose_free.")).toBe("Not lactose-free");
    expect(exclusionBucket("anything", "cutoff_passed")).toBe("Order cut-off has passed");
    expect(exclusionBucket("X has no allergen data from its maker, so nothing shows it is free of nuts.")).toBe("No allergen data from the maker");
    const g = groupExclusions(
      [
        { productId: "A", reason: "order cut-off passed", code: "cutoff_passed" },
        { productId: "B", reason: "x", code: "cutoff_passed" },
        { productId: "C", reason: "C lacks required attribute(s): lactose_free." },
      ],
      (id) => `Product ${id}`,
    );
    expect(g).toEqual([
      { reason: "Order cut-off has passed", count: 2, examples: ["Product A", "Product B"] },
      { reason: "Not lactose-free", count: 1, examples: ["Product C"] },
    ]);
  });
});
