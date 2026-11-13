import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { Validator } from "@seriousme/openapi-schema-validator";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as openapiRoute } from "@/app/api/v1/openapi.json/route";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { localFetch } from "./local-transport";
import { API, UNDOCUMENTED_ROUTES, buildOpenApi } from "./openapi";
import { resetRuntime } from "./runtime";

const BASE = "http://dock.test";
const V1 = join(__dirname, "..", "app", "api", "v1");

/** Every exported GET/POST of every route file under src/app/api/v1, as "get /api/v1/orders/{orderId}". */
async function routesOnDisk(): Promise<string[]> {
  const files = readdirSync(V1, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith("route.ts"));
  const found: string[] = [];
  for (const f of files) {
    const dir = relative(V1, join(V1, f, "..")).split("\\").join("/");
    const path = ("/api/v1/" + dir).replace(/\/$/, "").replace(/\[(\w+)\]/g, "{$1}");
    const mod = (await import(/* @vite-ignore */ join(V1, f))) as Record<string, unknown>;
    for (const m of ["GET", "POST"]) if (typeof mod[m] === "function") found.push(`${m.toLowerCase()} ${path}`);
  }
  return found.sort();
}

describe("OpenAPI document", () => {
  it("is a valid OpenAPI 3.1 document", async () => {
    const res = await new Validator().validate(buildOpenApi(BASE));
    expect(res.errors ?? []).toEqual([]);
    expect(res.valid).toBe(true);
  });

  it("documents exactly the routes that exist", async () => {
    const onDisk = (await routesOnDisk()).filter((r) => !UNDOCUMENTED_ROUTES.some((u) => r.endsWith(" " + u)));
    const documented = API.map((op) => `${op.method} ${op.path}`).sort();
    expect(documented).toEqual(onDisk);
  });

  it("is what /api/v1/openapi.json serves", async () => {
    const res = await openapiRoute(new Request(`${BASE}/api/v1/openapi.json`));
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(buildOpenApi(BASE))));
  });
});

describe("real responses match the documented status codes and schemas", () => {
  let mandate: string;
  beforeEach(async () => {
    resetRuntime();
    mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
  });

  const seen = new Set<string>();
  async function call(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await localFetch(new Request(BASE + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const json = await res.json();
    const pathname = new URL(BASE + path).pathname;
    const op = API.find((o) => o.method === method.toLowerCase() && new RegExp(`^${o.path.replace(/\{\w+\}/g, "[^/]+")}$`).test(pathname));
    expect(op, `${method} ${pathname} is documented`).toBeDefined();
    const documented = op!.responses[res.status];
    expect(documented, `${method} ${op!.path} documents status ${res.status}`).toBeDefined();
    const parsed = documented.schema.safeParse(json);
    expect(parsed.success ? null : parsed.error.issues, `${method} ${op!.path} ${res.status} matches its schema`).toBeNull();
    seen.add(`${op!.method} ${op!.path} ${res.status}`);
    return { status: res.status, body: json };
  }
  const agent = (method: "GET" | "POST", path: string, body?: unknown) => call(method, path, body, { authorization: `Bearer ${mandate}`, "dock-agent-id": DEMO_ORG.agentId });

  it("over the full flow and its refusals", async () => {
    await call("GET", "/api/v1");
    expect((await call("POST", "/api/v1/requests", { text: "milk" })).status).toBe(401);
    expect((await call("POST", "/api/v1/requests", { text: "milk" }, { authorization: `Bearer ${mandate}`, "dock-agent-id": "someone" })).status).toBe(403);
    expect((await agent("POST", "/api/v1/requests", { text: "" })).status).toBe(400);
    const requestId = (await agent("POST", "/api/v1/requests", { text: "1,000 L lactose-free milk", neededBy: "2099-01-01" })).body.request.requestId;

    await agent("GET", `/api/v1/products?requestId=${requestId}&q=milk&attribute=lactose_free&attribute=fat_1_5`);
    expect((await agent("GET", `/api/v1/products?requestId=req_nope`)).status).toBe(404);
    await agent("POST", "/api/v1/availability", { requestId, productIds: ["VA-1010", "AR-2010"] });
    expect((await agent("POST", "/api/v1/availability", { requestId, productIds: Array.from({ length: 11 }, (_, i) => `X-${i}`) })).status).toBe(400);
    expect((await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1010", quantity: 100 }] })).status).toBe(409);

    const sub = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1010", quantity: 60 }, { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" }] });
    const pick = (q: { quote: { lines: { productId: string; quantity: number; unitPriceCents: number }[] } }) => q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));
    const pending = await agent("POST", "/api/v1/orders", { requestId, quoteToken: sub.body.quoteToken, lines: pick(sub.body) });
    expect(pending.status).toBe(202);
    expect((await agent("POST", "/api/v1/orders", { requestId, quoteToken: "a.b.c", lines: [] })).status).toBe(422);

    const small = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1001", quantity: 10 }] });
    expect((await agent("POST", "/api/v1/orders", { requestId, quoteToken: small.body.quoteToken, lines: pick(small.body) })).status).toBe(201);
    const oat = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "PK-4001", quantity: 10 }] });
    expect((await agent("POST", "/api/v1/orders", { requestId, quoteToken: oat.body.quoteToken, lines: pick(oat.body) })).status).toBe(422);

    await call("GET", "/api/v1/approvals");
    const msg = (await localFetch(new Request(`${BASE}/api/v1/dev/outbox`)).then((r) => r.json())).messages[0];
    expect((await call("POST", `/api/v1/approvals/${msg.approvalId}`, { decision: "approve", token: "wrong" })).status).toBe(403);
    expect((await call("POST", `/api/v1/approvals/${msg.approvalId}`, { decision: "approve", token: new URL(msg.link, BASE).searchParams.get("token") })).status).toBe(200);
    expect((await agent("GET", `/api/v1/orders/${pending.body.order.orderId}`)).body.order.status).toBe("committed");
    expect((await agent("GET", "/api/v1/orders/ord_nope")).status).toBe(404);
    await call("GET", `/api/v1/ledger?requestId=${requestId}`);
    await call("GET", "/api/v1/keys");

    // Every documented operation was exercised at least once with a success status.
    const ok = new Set([...seen].filter((k) => /\s2\d\d$/.test(k)).map((k) => k.replace(/\s\d+$/, "")));
    const untested = API.map((o) => `${o.method} ${o.path}`).filter((k) => !ok.has(k) && k !== "get /api/v1/openapi.json");
    expect(untested).toEqual([]);
  });
});
