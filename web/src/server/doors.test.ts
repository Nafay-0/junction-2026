import { sessionCookieFor } from "./accounts/test-session";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { POST as intakeRoute } from "@/app/api/v1/intake/route";
import * as connectorRoute from "@/app/api/mcp/c/[token]/route";
import * as connectRoute from "@/app/ui-api/connect/[kitchen]/route";
import { POST as consoleCall } from "@/app/ui-api/kitchens/[kitchen]/call/route";
import { noteAssistantHandoff } from "./assistant-handoff";
import { traceView } from "./ops/views";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { kitchenAgent, openNeed } from "./channels/flow";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "./demo-kitchen";
import { getRuntime, resetRuntime } from "./runtime";

/**
 * One path for every door: a remembered rule of the kitchen (Kaari: "Always lactose-free", stated by its head chef)
 * is applied without being asked, on every door, and each use shows as one line on the request.
 */
const BASE = "http://dock.test";
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
const need = () => ({ item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" as const }, deliverBy: day(), optimise: "price" as const });
type Step = { requestId: string; state: string; memoryUsed: { text: string }[]; options: { lines: { productId: string }[] }[]; quote?: { quote: { lines: { productId: string; attributes: string[] }[] } } };

let auth: Record<string, string>;
beforeEach(async () => {
  resetRuntime();
  const m = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
  auth = { authorization: `Bearer ${m}`, "dock-agent-id": KITCHEN_ORG.agentId };
});

async function lactoseFreeEverywhere(step: Step) {
  expect(step.memoryUsed.map((l) => l.text)).toContainEqual(expect.stringMatching(/^Always lactose-free applied: stated by Sanna Koskinen/));
  const { catalog } = await getRuntime();
  const ids = [...step.options.flatMap((o) => o.lines.map((l) => l.productId)), ...(step.quote?.quote.lines.map((l) => l.productId) ?? [])];
  expect(ids.length).toBeGreaterThan(0);
  for (const p of await catalog.searchProducts({ ids, limit: 50 })) expect(p.attributes).toContain("lactose_free");
}

describe("a remembered rule on every door", () => {
  it("REST (and the typed console, which forwards to it)", async () => {
    const res = await intakeRoute(new Request(`${BASE}/api/v1/intake`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ need: need(), by: "Sanna" }) }));
    await lactoseFreeEverywhere(((await res.json()) as { step: Step }).step);
  });

  it("MCP", async () => {
    const client = new Client({ name: "test-agent", version: "0.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { fetch: async (u, i) => mcpRoute(new Request(u, i)), requestInit: { headers: auth } }));
    const r = (await client.callTool({ name: "submit_need", arguments: { need: need(), by: "Sanna" } })) as CallToolResult;
    await lactoseFreeEverywhere((r.structuredContent as { step: Step }).step);
  });

  it("voice and photo (the doors' shared flow)", async () => {
    const a = await kitchenAgent("kaari");
    for (const door of ["voice", "photo"] as const) {
      const step = await openNeed(a, need(), door, door === "voice" ? "speech" : "image", { summary: `test ${door}` });
      await lactoseFreeEverywhere(step as unknown as Step);
    }
  });
});

describe("each door is recorded, and the operations trace shows it", () => {

  async function doorOf(requestId: string) {
    const rt = await getRuntime();
    const t = await traceView(rt, requestId);
    const entry = rt.dock.ledger.entries({ requestId }).find((e) => e.type === "request")!;
    return { door: entry.data.door, traceDoor: t.door, via: t.via };
  }

  it("typed and assistant (the store's console), REST, MCP, connector, voice, photo and the menu planner", async () => {
    const own = await sessionCookieFor(await getRuntime(), "kaari"); // the stage kitchen's own signed-in account
    const cookie = `dock_console=0123456789abcdef0123; ${own}`;
    const viaConsole = async (text: string) => {
      const res = await consoleCall(new Request(`${BASE}/ui-api/kitchens/kaari/call`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ method: "POST", path: "/api/v1/intake", body: { need: { ...need(), text }, by: "Sanna" } }) }), { params: Promise.resolve({ kitchen: "kaari" }) } as never);
      return ((await res.json()) as { step: Step }).step.requestId;
    };
    expect(await doorOf(await viaConsole("100 L milk for Thursday"))).toEqual({ door: "typed", traceDoor: "typed", via: "onsite" });
    noteAssistantHandoff("kaari", "0123456789abcdef0123", "order 100 L milk for Thursday");
    expect(await doorOf(await viaConsole("order 100 L milk for Thursday"))).toEqual({ door: "assistant", traceDoor: "assistant", via: "onsite" });

    const rest = await intakeRoute(new Request(`${BASE}/api/v1/intake`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ need: need() }) }));
    expect(await doorOf(((await rest.json()) as { step: Step }).step.requestId)).toEqual({ door: "rest", traceDoor: "rest", via: "rest" });

    const mcp = new Client({ name: "t", version: "0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await mcp.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { fetch: async (u, i) => mcpRoute(new Request(u, i)), requestInit: { headers: auth } }));
    const viaMcp = ((await mcp.callTool({ name: "submit_need", arguments: { need: need() } })) as CallToolResult).structuredContent as { step: Step };
    expect(await doorOf(viaMcp.step.requestId)).toEqual({ door: "mcp", traceDoor: "mcp", via: "mcp" });

    const addr = ((await (await connectRoute.GET(new Request(`${BASE}/ui-api/connect/kaari`, { headers: { cookie: own } }), { params: Promise.resolve({ kitchen: "kaari" }) } as never)).json()) as { connector: { url: string } }).connector.url;
    const token = new URL(addr).pathname.split("/").pop()!;
    const conn = new Client({ name: "chat", version: "0" });
    await conn.connect(new StreamableHTTPClientTransport(new URL(`/api/mcp/c/${token}`, BASE), { fetch: async (u, i) => connectorRoute.POST(new Request(u, i), { params: Promise.resolve({ token }) } as never), requestInit: { headers: { "user-agent": "Claude-User/1.0" } } }));
    const viaConnector = ((await conn.callTool({ name: "submit_need", arguments: { need: need() } })) as CallToolResult).structuredContent as { step: Step };
    expect(await doorOf(viaConnector.step.requestId)).toEqual({ door: "connector", traceDoor: "connector", via: "mcp" });

    const a = await kitchenAgent("kaari");
    for (const door of ["voice", "photo"] as const) {
      const step = await openNeed(a, need(), door, door === "voice" ? "speech" : "image", { summary: door });
      expect(await doorOf(step.requestId)).toEqual({ door, traceDoor: door, via: "onsite" });
    }
  });
});
