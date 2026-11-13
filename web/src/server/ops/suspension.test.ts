import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { GET as controlGet, POST as controlPost } from "@/app/ops-api/control/route";
import { GET as overviewGet } from "@/app/ops-api/overview/route";
import { POST as sessionPost } from "@/app/ops-api/session/route";
import { POST as consoleCall } from "@/app/ui-api/kitchens/[kitchen]/call/route";
import { auditFor } from "@/core/audit";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { KITCHEN_ORG } from "../demo-kitchen";
import { localFetch } from "../local-transport";
import { getRuntime, resetRuntime } from "../runtime";
import { doorLog } from "./door";
import { CONTROL_ENTRY } from "./suspensions";

const BASE = "http://dock.test";
let mandate: string;
let cookie: string;

const agentHeaders = () => ({ "content-type": "application/json", authorization: `Mandate ${mandate}`, "dock-agent-id": DEMO_ORG.agentId });

async function rest(method: string, path: string, body?: unknown) {
  const res = await localFetch(new Request(BASE + path, { method, headers: agentHeaders(), body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

async function enter(passcode?: string) {
  const res = await sessionPost(new Request(`${BASE}/ops-api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Riikka (ops)", passcode }) }));
  const set = res.headers.get("set-cookie") ?? "";
  return { status: res.status, cookie: set.split(";")[0], body: await res.json() };
}

async function control(body: unknown, withCookie = true) {
  const res = await controlPost(new Request(`${BASE}/ops-api/control`, { method: "POST", headers: { "content-type": "application/json", ...(withCookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

async function mcp() {
  const client = new Client({ name: "outside-agent", version: "0.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), {
      fetch: async (url: string | URL, init?: RequestInit) => mcpRoute(new Request(url, init)),
      requestInit: { headers: { authorization: `Bearer ${mandate}`, "dock-agent-id": DEMO_ORG.agentId } },
    }),
  );
  return client;
}

beforeEach(async () => {
  resetRuntime();
  delete process.env.DOCK_OPS_PASSCODE;
  mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
  cookie = (await enter()).cookie;
});

afterEach(() => {
  delete process.env.DOCK_OPS_PASSCODE;
});

describe("suspension", () => {
  it("stops an agent on its next call over REST, MCP and the on-site console, with a named reason, until resumed", async () => {
    expect((await rest("POST", "/api/v1/requests", { text: "milk" })).status).toBe(201);
    const client = await mcp();
    const before = (await client.callTool({ name: "read_mandate", arguments: {} })) as CallToolResult;
    expect(before.isError).toBeFalsy();

    const s = await control({ action: "suspend", scope: "agent", target: DEMO_ORG.agentId, reason: "Ordering in a loop" });
    expect(s.status).toBe(201);
    const suspensionId = s.body.suspension.suspensionId as string;

    // REST: look up, quote, order are all refused at the door.
    for (const [method, path, body] of [
      ["POST", "/api/v1/requests", { text: "milk" }],
      ["GET", "/api/v1/products?requestId=req_x&q=milk", undefined],
      ["POST", "/api/v1/availability", { requestId: "req_x", productIds: ["VA-1010"] }],
      ["POST", "/api/v1/quotes", { requestId: "req_x", lines: [{ productId: "VA-1010", quantity: 1 }] }],
      ["POST", "/api/v1/orders", { requestId: "req_x", quoteToken: "x", lines: [] }],
    ] as const) {
      const r = await rest(method, path, body);
      expect(r.status, path).toBe(403);
      expect(r.body.error).toMatchObject({ code: "agent_suspended", rule: "operator_suspension", message: expect.stringContaining("Ordering in a loop") });
    }

    // MCP: the same refusal as a tool result, with a next step that says not to retry.
    const refused = (await client.callTool({ name: "check_availability", arguments: { requestId: "req_x", productIds: ["VA-1010"] } })) as CallToolResult;
    expect(refused.isError).toBe(true);
    const sc = refused.structuredContent as { ok: boolean; error: { code: string; rule: string; message: string }; nextStep: string };
    expect(sc).toMatchObject({ ok: false, error: { code: "agent_suspended", rule: "operator_suspension" } });
    expect(sc.nextStep).toMatch(/Do not retry/);
    const mandateCall = (await client.callTool({ name: "read_mandate", arguments: {} })) as CallToolResult;
    expect(mandateCall.isError).toBe(true);

    // Other agents keep working.
    const kaari = await consoleCall(new Request(`${BASE}/ui-api/kitchens/kaari/call`, { method: "POST", body: JSON.stringify({ method: "GET", path: "/api/v1/kitchen" }) }), { params: Promise.resolve({ kitchen: "kaari" }) });
    expect(kaari.status).toBe(200);

    // The suspension, every refusal and the resumption are on the ledger, and the chain holds.
    const rt = await getRuntime();
    const refusals = rt.dock.ledger.entries().filter((e) => e.type === "refusal" && e.data.rule === "operator_suspension");
    expect(refusals.length).toBe(7);
    expect(new Set(refusals.map((e) => e.data.via))).toEqual(new Set(["rest", "mcp"]));

    const resumed = await control({ action: "resume", suspensionId, note: "Fixed" });
    expect(resumed.status).toBe(200);
    expect(resumed.body.suspension).toMatchObject({ resumedBy: "Riikka (ops)", refusals: 7 });
    expect((await rest("POST", "/api/v1/requests", { text: "milk" })).status).toBe(201);
    const after = (await client.callTool({ name: "read_mandate", arguments: {} })) as CallToolResult;
    expect(after.isError).toBeFalsy();

    const controls = rt.dock.ledger.entries().filter((e) => e.type === CONTROL_ENTRY);
    expect(controls.map((e) => [e.data.action, e.actor])).toEqual([
      ["suspend", "operator:Riikka (ops)"],
      ["resume", "operator:Riikka (ops)"],
    ]);
    expect(rt.dock.ledger.verify().ok).toBe(true);
    // The wholesaler's audit reads its own control entries (it used to fall through the core's type list).
    const audit = auditFor("wholesaler", rt.dock.ledger.entries());
    const controlled = audit.entries.filter((e) => "kind" in e && e.kind === "control");
    expect(controlled).toHaveLength(2);
    expect(audit.explanation.some((l) => l.includes("[control]"))).toBe(true);
    await client.close();
  });

  it("suspends a whole organisation, including the on-site console and its scripted buyer", async () => {
    const rt = await getRuntime();
    const { sandbox, sessionToken } = await rt.sandboxes.joinWithoutPasskey();
    const s = await control({ action: "suspend", scope: "org", target: sandbox.orgId, reason: "Visitor kitchen misbehaving" });
    expect(s.status).toBe(201);
    const res = await consoleCall(new Request(`${BASE}/ui-api/kitchens/${sandbox.sandboxId}/call`, { method: "POST", headers: { cookie: `dock_approver=${encodeURIComponent(sessionToken)}` }, body: JSON.stringify({ method: "POST", path: "/api/v1/intake", body: { need: { text: "milk", item: { text: "milk" }, quantity: { amount: 10, unit: "L" } } } }) }), {
      params: Promise.resolve({ kitchen: sandbox.sandboxId }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({ code: "organisation_suspended", rule: "operator_suspension" });
    await expect(rt.sandboxes.runDemoOrder(sandbox.sandboxId)).rejects.toMatchObject({ code: "organisation_suspended" });
    // The door log knows the console is the on-site agent.
    expect(doorLog(rt.dock).all().filter((c) => c.agentId === sandbox.agentId).map((c) => [c.via, c.ok])).toEqual([
      ["onsite", false],
      ["onsite", false],
    ]);
    // Laakso is another organisation and is not affected.
    expect((await rest("POST", "/api/v1/requests", { text: "milk" })).status).toBe(201);
  });

  it("needs a reason, refuses a second suspension of the same target, and never approves for a customer", async () => {
    expect((await control({ action: "suspend", scope: "agent", target: KITCHEN_ORG.agentId, reason: " " })).body.error.code).toBe("reason_required");
    expect((await control({ action: "suspend", scope: "agent", target: KITCHEN_ORG.agentId, reason: "Test" })).status).toBe(201);
    expect((await control({ action: "suspend", scope: "agent", target: KITCHEN_ORG.agentId, reason: "Again" })).body.error.code).toBe("already_suspended");
    expect((await control({ action: "suspend", scope: "agent", target: "agent_nobody", reason: "x" })).status).toBe(404);
    const approve = await control({ action: "approve", approvalId: "apr_x" });
    expect(approve).toMatchObject({ status: 403, body: { error: { code: "ops_cannot_sign_off" } } });
  });
});

describe("operations access", () => {
  it("refuses every /ops-api call without the session cookie", async () => {
    expect((await control({ action: "suspend", scope: "agent", target: DEMO_ORG.agentId, reason: "x" }, false)).status).toBe(401);
    const res = await overviewGet(new Request(`${BASE}/ops-api/overview`));
    expect(res.status).toBe(401);
    const ok = await controlGet(new Request(`${BASE}/ops-api/control`, { headers: { cookie } }));
    expect(ok.status).toBe(200);
  });

  it("needs the passcode when DOCK_OPS_PASSCODE is set", async () => {
    process.env.DOCK_OPS_PASSCODE = "harbour-7";
    expect((await enter()).status).toBe(401);
    expect((await enter("wrong")).body.error.code).toBe("ops_passcode_wrong");
    const ok = await enter("harbour-7");
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^dock_ops=/);
  });
});
