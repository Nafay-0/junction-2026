import { base64url } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as catalogGet, HEAD as catalogHead } from "@/app/.well-known/api-catalog/route";
import { GET as manifestGet } from "@/app/.well-known/dock.json/route";
import { GET as jwksGet } from "@/app/.well-known/jwks.json/route";
import { GET as llmsGet } from "@/app/llms.txt/route";
import { signMandate } from "@/core/mandate";
import { extractJws, verifySigned } from "../../scripts/lib/verify-receipt";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { localFetch } from "./local-transport";
import { TOOLS } from "./mcp/tools";
import { resetRuntime } from "./runtime";

const BASE = "http://dock.test";
const get = (fn: (r: Request) => Promise<Response>, path: string) => fn(new Request(BASE + path));

beforeEach(() => resetRuntime());

describe("discovery from the base URL", () => {
  it("serves an RFC 9727 API catalog that points at the OpenAPI document and the MCP endpoint", async () => {
    const res = await get(catalogGet, "/.well-known/api-catalog");
    expect(res.headers.get("content-type")).toBe('application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
    const { linkset } = await res.json();
    expect(linkset[0]).toMatchObject({ anchor: `${BASE}/api/v1`, "service-desc": [{ href: `${BASE}/api/v1/openapi.json` }] });
    expect(linkset[1].anchor).toBe(`${BASE}/api/mcp`);
    const head = await catalogHead(new Request(BASE + "/.well-known/api-catalog", { method: "HEAD" }));
    expect(head.headers.get("link")).toBe(`<${BASE}/.well-known/api-catalog>; rel="api-catalog"`);
  });

  it("serves a manifest naming the MCP endpoint, its tools, the keys and how mandates work", async () => {
    const m = await (await get(manifestGet, "/.well-known/dock.json")).json();
    expect(m.interfaces.mcp).toMatchObject({ url: `${BASE}/api/mcp`, transport: "streamable-http" });
    expect(m.interfaces.mcp.protocolVersions).toContain("2026-07-28");
    expect(m.interfaces.mcp.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(m.interfaces.rest.openapi).toBe(`${BASE}/api/v1/openapi.json`);
    expect(m.verification.jwksUri).toBe(`${BASE}/.well-known/jwks.json`);
    expect(m.authentication.headers).toHaveProperty("Dock-Agent-Id");
    expect(m.ordering.start).toEqual({ mcp: "submit_need", rest: "POST /api/v1/intake" });
    expect(m.interfaces.mcp.humanInput.tools).toEqual(["respond_to_concerns", "answer_questions"]);
  });

  it("serves llms.txt in the llmstxt.org shape with absolute links", async () => {
    const res = await get(llmsGet, "/llms.txt");
    const text = await res.text();
    expect(res.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(text).toMatch(/^# AimoPilot\n\n> /);
    expect(text).toContain(`(${BASE}/api/mcp)`);
    expect(text).toMatch(/do NOT retry/);
    expect(text).toMatch(/Start every order with `submit_need`/);
    expect(text).toMatch(/The buyer answers, not you/);
  });
});

describe("verifiable from the outside", () => {
  it("publishes the wholesaler key as a standard Ed25519 JWK Set, without the private part", async () => {
    const res = await get(jwksGet, "/.well-known/jwks.json");
    expect(res.headers.get("content-type")).toBe("application/jwk-set+json");
    const jwks = await res.json();
    expect(jwks.keys).toHaveLength(1);
    expect(Object.keys(jwks.keys[0]).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x"]);
    expect(jwks.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "Ed25519", use: "sig" });
    const rest = await (await localFetch(new Request(BASE + "/api/v1/keys"))).json();
    expect(rest).toEqual(jwks);
  });

  it("lets anyone verify an order receipt and a quote with only the published keys", async () => {
    const mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
    const h = { authorization: `Bearer ${mandate}`, "dock-agent-id": DEMO_ORG.agentId, "content-type": "application/json" };
    const post = async (path: string, body: unknown) => (await localFetch(new Request(BASE + path, { method: "POST", headers: h, body: JSON.stringify(body) }))).json();
    const { request } = await post("/api/v1/requests", { text: "milk" });
    const q = await post("/api/v1/quotes", { requestId: request.requestId, lines: [{ productId: "VA-1001", quantity: 10 }] });
    const { order } = await post("/api/v1/orders", { requestId: request.requestId, quoteToken: q.quoteToken, lines: [{ productId: "VA-1001", quantity: 10, unitPriceCents: q.quote.lines[0].unitPriceCents }] });
    expect(order.status).toBe("committed");

    const jwks = await (await get(jwksGet, "/.well-known/jwks.json")).json();
    const receipt = await verifySigned(extractJws(JSON.stringify({ order })), jwks);
    expect(receipt).toMatchObject({ typ: "order+jws", payload: { orderId: order.orderId, totalCents: order.totalCents, authorisedBy: { kind: "mandate" } } });
    expect((await verifySigned(q.quoteToken, jwks)).typ).toBe("quote+jws");

    // A receipt with an edited total does not verify.
    const [hd, p, sig] = order.confirmation.split(".");
    const body = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
    body.totalCents = 1;
    await expect(verifySigned([hd, base64url.encode(JSON.stringify(body)), sig].join("."), jwks)).rejects.toThrow(/signature/i);
  });
});
