/* eslint-disable @typescript-eslint/no-explicit-any -- test harness: tool results are untyped JSON. */
/** An outside agent over MCP (stock client): search, then a live check of a short list. Timed, never throws. */
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { signMandate } from "@/core/mandate";
import { demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";

export type McpProbe = { ok: boolean; ms: number; offers?: number; error?: string };

let n = 0;

export async function mcpLiveCheck(base: string, deliveryDate: string): Promise<McpProbe> {
  const t0 = Date.now();
  const agentId = `agent_deps_mcp_${Date.now().toString(36)}_${n++}`;
  const token = await signMandate(demoMandate(new Date(), { agentId, mandateId: `mnd_deps_mcp_${Date.now().toString(36)}_${n++}` }), await demoOrgKeyPair());
  const client = new Client({ name: "deps-test-agent", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } } as never);
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", base), { requestInit: { headers: { Authorization: `Bearer ${token}`, "Dock-Agent-Id": agentId } } }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
      const text = (r.content ?? []).map((c: any) => (c.type === "text" ? c.text : "")).join("");
      let json: any;
      try {
        json = (r as any).structuredContent ?? JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { isError: !!r.isError, json, text };
    };
    const o = await call("open_request", { text: "deps test: lactose-free milk", neededBy: deliveryDate });
    const requestId = o.json?.request?.requestId ?? o.json?.requestId;
    if (!requestId) return { ok: false, ms: Date.now() - t0, error: `open_request: ${o.text.slice(0, 120)}` };
    const s = await call("search_products", { requestId, text: "milk", attributes: ["lactose_free"], limit: 5 });
    const ids = (s.json?.products ?? []).slice(0, 3).map((p: any) => p.id ?? p.productId).filter(Boolean);
    if (!ids.length) return { ok: false, ms: Date.now() - t0, error: `search: ${s.text.slice(0, 120)}` };
    const a = await call("check_availability", { requestId, productIds: ids, deliveryDate });
    if (a.isError) return { ok: false, ms: Date.now() - t0, error: a.text.slice(0, 160) };
    return { ok: true, ms: Date.now() - t0, offers: (a.json?.offers ?? []).length };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: (err as Error).message.slice(0, 160) };
  } finally {
    await client.close().catch(() => undefined);
  }
}
