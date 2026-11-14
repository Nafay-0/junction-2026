import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { getRuntime, resetRuntime } from "../runtime";

/**
 * What the kitchen's own agent can do, an outside agent can do through the published tools: look up with filters,
 * rank alternatives, order several lines, follow and wait for a sign-off, take back and change an order. Each
 * through the same core functions and the same gate.
 */
const BASE = "http://dock.test";
const inProcess = async (url: string | URL, init?: RequestInit) => mcpRoute(new Request(url, init));
type S = { ok: boolean; error?: { code: string; rule?: string }; nextStep: string } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let client: Client;
const call = async (name: string, args: Record<string, unknown> = {}) => (((await client.callTool({ name, arguments: args })) as CallToolResult).structuredContent as S);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  resetRuntime();
  const m = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
  client = new Client({ name: "hotel-agent", version: "0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { fetch: inProcess, requestInit: { headers: { authorization: `Bearer ${m}`, "dock-agent-id": DEMO_ORG.agentId } } }));
  await client.listTools(); // results are now checked against the published output schemas
});

describe("an outside agent gets what the kitchen's own agent gets", () => {
  it("find_products: one call returns products, prices and availability in structured form, filtered", async () => {
    const r = await call("find_products", { text: "milk", requiredClaims: ["lactose_free"], quantity: { amount: 1000, unit: "L" }, deliverOn: day(3), limit: 4 });
    expect(r.ok).toBe(true);
    expect(r.requestId).toMatch(/^req_/);
    expect(r.products.length).toBeGreaterThan(0);
    for (const p of r.products) {
      expect(p.claims).toContain("lactose_free");
      expect(p).toMatchObject({ pack: { size: expect.any(Number) }, carbon: { basis: expect.any(String) }, allergens: { declared: expect.any(Boolean) } });
      expect(p.live).toMatchObject({ unitPriceCents: expect.any(Number), earliestDelivery: expect.any(String), packsForQuantity: expect.any(Number), meetsDay: expect.any(Boolean) });
    }
    // The 10 L box has 60 packs (600 L): the lookup says it does not cover 1,000 L.
    const box = r.products.find((p: S) => p.productId === "VA-1010");
    if (box) expect(box.live).toMatchObject({ packsForQuantity: 100, availablePacks: 60, coversQuantity: false });
    const brand = await call("find_products", { requestId: r.requestId, text: "milk", brand: "arla", live: false });
    expect(brand.products.every((p: S) => /arla/i.test(p.brand))).toBe(true);
    expect(brand.liveChecked).toBe(0);
    // A product outside the mandate is not offered, and the result says how many were left out.
    const oat = await call("find_products", { requestId: r.requestId, text: "oat", live: false });
    expect(oat.products.map((p: S) => p.productId)).not.toContain("PK-4001");
  });

  it("find_alternatives: good, better, best for a product that is short, each with trade-offs and the gate's preview", async () => {
    const r = await call("find_alternatives", { productId: "VA-1010", quantity: { amount: 1000, unit: "L" }, rankBy: "price" });
    expect(r.ok).toBe(true);
    expect(r.requested).toMatchObject({ productId: "VA-1010", live: { coversQuantity: false } });
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives[0].rank).toBe("best");
    for (const a of r.alternatives) {
      expect(a.claims).toContain("lactose_free"); // a lactose-free milk stays lactose-free
      expect(["auto_approve", "needs_human_approval"]).toContain(a.gate.outcome);
      expect(Array.isArray(a.tradeOffs)).toBe(true);
    }
  });

  it("an order of several lines, placed with just requestId; followed with list_orders and get_order waiting; withdrawn", async () => {
    const opened = await call("open_request", { text: "milk and oat drink for the hotel breakfast" });
    const requestId = opened.request.requestId;
    const q = await call("request_quote", { requestId, lines: [{ productId: "VA-1010", quantity: 60 }, { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" }] });
    expect(q.quote.lines).toHaveLength(2);
    const placed = await call("place_order", { requestId });
    expect(placed).toMatchObject({ ok: true, order: { status: "pending_approval" } });
    const orderId = placed.order.orderId;
    const listed = await call("list_orders", { status: "pending_approval" });
    expect(listed.waitingForSignOff).toBe(1);
    expect(listed.orders[0]).toMatchObject({ orderId, signOff: { status: "pending" }, canTakeBack: { how: expect.stringMatching(/withdraw_order/) } });
    const waited = await call("get_order", { orderId, waitSeconds: 1 });
    expect(waited).toMatchObject({ ok: true, decided: false });
    expect(waited.nextStep).toMatch(/never place it again/);
    const back = await call("withdraw_order", { orderId, reason: "breakfast moved", by: "Hotel buyer" });
    expect(back).toMatchObject({ ok: true, order: { status: "withdrawn" } });
  });

  it("get_order with waitSeconds returns as soon as the person decides", async () => {
    const opened = await call("open_request", { text: "milk" });
    await call("request_quote", { requestId: opened.request.requestId, lines: [{ productId: "VA-1010", quantity: 60 }, { productId: "AR-2010", quantity: 40 }] });
    const placed = await call("place_order", { requestId: opened.request.requestId });
    const { dock, outbox } = await getRuntime();
    const msg = outbox.messages().find((m) => m.orderId === placed.order.orderId)!;
    setTimeout(() => void dock.decideApproval(msg.approvalId, { decision: "approve", proof: { kind: "link_token", token: new URL(msg.link, BASE).searchParams.get("token")! } }), 300);
    const t0 = Date.now();
    const r = await call("get_order", { orderId: placed.order.orderId, waitSeconds: 10 });
    expect(r).toMatchObject({ decided: true, order: { status: "committed" } });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("an order the agent placed alone is taken back before the cut-off; place_order replaces changes an order", async () => {
    const rt = await getRuntime();
    const cutoff = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 16);
    (rt.catalog as unknown as { setStock(id: string, p: Record<string, unknown>): void }).setStock("VA-1001", { orderBy: cutoff });
    const a = await call("open_request", { text: "20 L milk" });
    await call("request_quote", { requestId: a.request.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const first = await call("place_order", { requestId: a.request.requestId });
    expect(first.order.status).toBe("committed");
    const back = await call("withdraw_order", { orderId: first.order.orderId, by: "Hotel buyer" });
    expect(back.order.status).toBe("withdrawn");
    expect(rt.dock.ledger.entries({ orderId: first.order.orderId }).at(-1)).toMatchObject({ data: { decision: "taken_back", verified: false } });
    // Change an order: 30 instead of 20. The new order is placed (the gate decides it as any other), the old one taken back.
    const c = await call("open_request", { text: "20 L milk" });
    await call("request_quote", { requestId: c.request.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const old = await call("place_order", { requestId: c.request.requestId });
    const b = await call("open_request", { text: "make it 30 L" });
    await call("request_quote", { requestId: b.request.requestId, lines: [{ productId: "VA-1001", quantity: 30 }] });
    const second = await call("place_order", { requestId: b.request.requestId, replaces: old.order.orderId });
    expect(second).toMatchObject({ ok: true, replaced: { orderId: old.order.orderId, status: "withdrawn" } });
    expect(["committed", "pending_approval"]).toContain(second.order.status);
    const none = await call("place_order", { requestId: b.request.requestId, replaces: first.order.orderId });
    expect(none.error).toMatchObject({ code: "nothing_to_replace" });
  });

  it("forgives a need's fields sent next to it, and a choice without a name (seen in the 14 Nov runtime runs)", async () => {
    const day3 = day(3);
    const r = await call("submit_need", { need: { item: { text: "lactose-free milk", category: "milk" }, deliverBy: day3 }, quantity: { amount: 40, unit: "L" } });
    expect(r.ok).toBe(true);
    expect(r.step.need.quantity).toMatchObject({ amount: 40, unit: "L" });
    let s = r;
    for (let i = 0; i < 3 && s.step.state !== "options_ready"; i++) s = await call(s.step.state === "needs_confirmation" ? "respond_to_concerns" : "answer_questions", { requestId: r.step.requestId, by: "Hotel buyer", ...(s.step.state === "needs_confirmation" ? { responses: s.step.concerns.map((c: S) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) } : { answers: s.step.questions.map((q: S) => ({ questionId: q.id, optionId: q.options[0].id })) }) });
    expect(s.step.state).toBe("options_ready");
    const chosen = await call("choose_option", { requestId: r.step.requestId, optionId: s.step.options[0].optionId });
    expect(chosen).toMatchObject({ ok: true, step: { state: "quoted" } });
  });
});
