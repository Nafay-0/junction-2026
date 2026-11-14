import { beforeEach, describe, expect, it } from "vitest";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { localFetch } from "./local-transport";
import { resetRuntime } from "./runtime";

const BASE = "http://dock.test";
let mandate: string;

beforeEach(async () => {
  resetRuntime();
  mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await localFetch(
    new Request(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const auth = () => ({ authorization: `Mandate ${mandate}`, "dock-agent-id": DEMO_ORG.agentId });
const agent = (method: string, path: string, body?: unknown) => call(method, path, body, auth());

async function openRequest() {
  const r = await agent("POST", "/api/v1/requests", { text: "milk", neededBy: "2099-01-01" });
  expect(r.status).toBe(201);
  return r.body.request.requestId as string;
}

describe("HTTP API", () => {
  it("lists its endpoints", async () => {
    const r = await call("GET", "/api/v1");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.endpoints)).toContain("POST /api/v1/orders");
  });

  it("refuses calls without a mandate with a structured error naming the rule", async () => {
    const r = await call("POST", "/api/v1/requests", { text: "milk" });
    expect(r).toEqual({
      status: 401,
      body: { error: { code: "mandate_missing", rule: "mandate_signature", message: expect.any(String) } },
    });
  });

  it("refuses a mandate with a bad signature", async () => {
    const broken = mandate.slice(0, mandate.lastIndexOf(".")) + "." + "A".repeat(86);
    const r = await call("POST", "/api/v1/requests", { text: "milk" }, { authorization: `Mandate ${broken}`, "dock-agent-id": DEMO_ORG.agentId });
    expect(r.status).toBe(401);
    expect(r.body.error.rule).toBe("mandate_signature");
  });

  it("validates bodies", async () => {
    expect((await agent("POST", "/api/v1/requests", "{not json")).body.error.code).toBe("invalid_json");
    const r = await agent("POST", "/api/v1/requests", { text: "" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_request");
  });

  it("runs request -> quote -> 202 -> approve -> committed over HTTP", async () => {
    const requestId = await openRequest();
    const search = await agent("GET", `/api/v1/products?requestId=${requestId}&q=milk&attribute=lactose_free&attribute=fat_1_5&category=milk`);
    expect(search.body.products.length).toBeGreaterThan(3);
    expect(search.body.liveCallsSoFar).toBe(0);

    const q = await agent("POST", "/api/v1/quotes", {
      requestId,
      lines: [
        { productId: "VA-1010", quantity: 60 },
        { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" },
      ],
    });
    expect(q.status).toBe(201);
    const lines = q.body.quote.lines.map((l: { productId: string; quantity: number; unitPriceCents: number }) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
    }));
    const placed = await agent("POST", "/api/v1/orders", { requestId, quoteToken: q.body.quoteToken, lines });
    expect(placed.status).toBe(202);

    expect((await call("GET", "/api/v1/approvals")).status).toBe(401); // strangers see no one's sign-offs (F-APPROVALS-OPEN)
    const pending = await agent("GET", "/api/v1/approvals");
    expect(pending.body.approvals).toHaveLength(1);
    expect(JSON.stringify(pending.body)).not.toMatch(/token/i);

    const outbox = await call("GET", "/api/v1/dev/outbox");
    const { approvalId, link } = outbox.body.messages[0];
    const token = new URL(link, BASE).searchParams.get("token");

    const wrong = await call("POST", `/api/v1/approvals/${approvalId}`, { decision: "approve", token: "nope" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.rule).toBe("approver_identity");

    const ok = await call("POST", `/api/v1/approvals/${approvalId}`, { decision: "approve", token });
    expect(ok.status).toBe(200);
    expect(ok.body.order.status).toBe("committed");

    const got = await agent("GET", `/api/v1/orders/${placed.body.order.orderId}`);
    expect(got.body.order.confirmation).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

    // A stranger can verify the chain but reads no entries (F-LEDGER-OPEN); the kitchen's own agent reads its own.
    const anon = await call("GET", `/api/v1/ledger?requestId=${requestId}`);
    expect(anon.body.verification.ok).toBe(true);
    expect(anon.body.entries).toEqual([]);
    const ledger = await agent("GET", `/api/v1/ledger?requestId=${requestId}`);
    expect(ledger.body.verification.ok).toBe(true);
    expect(ledger.body.catalog.liveCalls).toBe(1);
    expect(ledger.body.explanation.length).toBeGreaterThan(5);
  });

  it("returns 422 naming the rule when the gate refuses", async () => {
    const requestId = await openRequest();
    const q = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "PK-4001", quantity: 10 }] });
    expect(q.body.policyPreview.outcome).toBe("reject");
    const r = await agent("POST", "/api/v1/orders", {
      requestId,
      quoteToken: q.body.quoteToken,
      lines: [{ productId: "PK-4001", quantity: 10, unitPriceCents: q.body.quote.lines[0].unitPriceCents }],
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "policy_rejected", rule: "forbidden_allergens" });
    expect(r.body.order.status).toBe("rejected");
  });

  it("returns 409 with the available quantity when stock is short", async () => {
    const requestId = await openRequest();
    const r = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1010", quantity: 100 }] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "quote_insufficient_stock", details: { available: 60 } });
  });

  it("publishes the wholesaler key and 404s unknown routes", async () => {
    const keys = await call("GET", "/api/v1/keys");
    expect(keys.body.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519" });
    expect(keys.body.keys[0].d).toBeUndefined();
    expect((await call("GET", "/api/v1/nope")).status).toBe(404);
  });
});
