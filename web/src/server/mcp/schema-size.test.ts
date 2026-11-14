import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";

/**
 * Some runtimes (Google ADK) send every tool's output schema to their model on each call, so the published size is
 * a cost. tools/list must stay small: the output schemas are shallow (the full shapes are in the OpenAPI document).
 */
const inProcess = async (url: string | URL, init?: RequestInit) => mcpRoute(new Request(url, init));

describe("tools/list size", () => {
  it("keeps the output schemas small next to the input schemas", async () => {
    const client = new Client({ name: "size", version: "0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", "http://dock.test"), { fetch: inProcess }));
    const { tools } = await client.listTools();
    const out = tools.reduce((s, t) => s + JSON.stringify(t.outputSchema ?? {}).length, 0);
    const input = tools.reduce((s, t) => s + JSON.stringify(t.inputSchema ?? {}).length, 0);
    const all = JSON.stringify(tools).length;
    // Measured 14 Nov 2026: 128,707 bytes in all with 109,078 of output schemas before; 30,385 and 10,756 after.
    expect(out).toBeLessThan(20_000);
    expect(out).toBeLessThan(input * 2);
    // 47,813 on 14 Nov 2026 with the watch's three tools (watch_orders, answer_watch, set_auto_renew), descriptions kept short.
    expect(all).toBeLessThan(48_500);
    // Still a usable shape: the intake tools say a step has a state, and an order a status.
    const submit = tools.find((t) => t.name === "submit_need")!.outputSchema as { properties: Record<string, { properties?: Record<string, { enum?: string[] }> }> };
    expect(submit.properties.step.properties?.state.enum).toContain("quoted");
    expect(submit.properties.nextStep).toBeDefined();
  });
});
