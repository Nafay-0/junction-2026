/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * The MCP interface (/api/mcp) with a stock MCP client: discovery, refusals as tool results, the gate behind the
 * tools, and the human-input tools with and without the elicitation capability.
 */
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { laaksoMandate, kaariMandate, LAAKSO } from "../lib/actors";
import { tamperJws } from "../lib/flow";
import type { Probe } from "../lib/probe";

async function connect(base: string, token?: string, agentId?: string, elicit = false) {
  const client = new Client({ name: "dock-qa", version: "1.0.0" }, { versionNegotiation: { mode: "auto" }, capabilities: elicit ? { elicitation: { form: {} } } : {} });
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (agentId) headers["Dock-Agent-Id"] = agentId;
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", base), { requestInit: { headers } }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = (r.content ?? []).map((c: any) => c.text ?? "").join("\n");
    return { r, text, json: (r.structuredContent as any) ?? safeJson(text) };
  };
  return { client, call };
}
const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
};

export const mcpProbes: Probe[] = [
  {
    id: "mcp.discovery_and_refusals",
    area: "mcp",
    kind: "hostile",
    title: "Tools list without a mandate; every tool call without, or with a forged, mandate is a tool error naming a rule, not a transport failure",
    cases: 3,
    async run({ http, check }) {
      const anon = await connect(http.base);
      const tools = await anon.client.listTools();
      check.expect(tools.tools.length >= 10, `only ${tools.tools.length} tools listed`);
      const r = await anon.call("read_mandate", {});
      check.expect(r.r.isError === true && /mandate/i.test(r.text), `read_mandate with no mandate: isError=${r.r.isError} ${r.text.slice(0, 120)}`);
      const forged = tamperJws(await laaksoMandate(), (p) => { p.mandate.perOrderLimitCents = 1e9; });
      const f = await connect(http.base, forged, LAAKSO.agentId);
      const fr = await f.call("open_request", { text: "qa" });
      check.expect(fr.r.isError === true && /signature|mandate/i.test(fr.text), `forged mandate over MCP: isError=${fr.r.isError} ${fr.text.slice(0, 120)}`);
      await Promise.all([anon.client.close(), f.client.close()]);
    },
  },
  {
    id: "mcp.gate_behind_tools",
    area: "mcp",
    kind: "hostile",
    title: "Through MCP: an altered quote token and edited order lines are refused, a quote buys once",
    cases: 3,
    async run({ http, check }) {
      const agentId = `agent_laakso_mcp_${Date.now().toString(36)}`;
      const m = await connect(http.base, await laaksoMandate({ agentId, weeklyBudgetCents: 1e9, perOrderLimitCents: 1e9 }), agentId);
      const req = await m.call("open_request", { text: "qa mcp: 5 L milk" });
      const requestId = req.json?.request?.requestId ?? req.json?.requestId;
      const q = await m.call("request_quote", { requestId, lines: [{ productId: "VA-1001", quantity: 5 }] });
      const token = q.json?.quoteToken;
      if (!token) return void check.expect(false, `no quote over MCP: ${q.text.slice(0, 200)}`);
      const lines = q.json.quote.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents }));
      const bad = await m.call("place_order", { requestId, quoteToken: tamperJws(token, (p) => { p.lines[0].unitPriceCents = 1; p.lines[0].lineTotalCents = 5; p.totalCents = 5; }), lines: [{ ...lines[0], unitPriceCents: 1 }] });
      check.expect(bad.r.isError === true || bad.json?.order?.status !== "committed", `altered quote over MCP: ${bad.text.slice(0, 160)}`);
      const edited = await m.call("place_order", { requestId, quoteToken: token, lines: [{ ...lines[0], quantity: 50 }] });
      check.expect(edited.json?.order?.status !== "committed", `edited lines over MCP committed`);
      const ok = await m.call("place_order", { requestId, quoteToken: token, lines });
      const again = await m.call("place_order", { requestId, quoteToken: token, lines });
      // Accepted: committed, or waiting for a person (the mistake check flags a repeat of this run's earlier orders).
      check.expect(["committed", "pending_approval"].includes(ok.json?.order?.status), `honest order over MCP: ${ok.json?.order?.status ?? ok.text.slice(0, 160)}`);
      check.expect(!["committed", "pending_approval"].includes(again.json?.order?.status), "the same quote bought twice over MCP");
      await m.client.close();
    },
  },
  {
    id: "mcp.human_input_answered_by_agent",
    area: "mcp",
    kind: "authority",
    title: "respond_to_concerns: an MCP client that declares no elicitation capability answers the buyer's mistake check itself",
    findings: ["F-HUMAN-INPUT-BY-AGENT"],
    async run({ http, check }) {
      const agentId = `agent_kaari_mcp_${Date.now().toString(36)}`;
      const m = await connect(http.base, await kaariMandate({ agentId, weeklyBudgetCents: 1e9 }), agentId, false);
      const s = await m.call("submit_need", { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 1000, unit: "L" } } });
      const step = s.json?.step ?? s.json;
      const c = step?.concerns?.[0];
      if (step?.state !== "needs_confirmation" || !c) return { skip: `no concern raised: ${step?.state}` };
      const responses = step.concerns.map((x: any) => ({ key: x.key, choice: x.confirmable ? "confirm" : x.corrections[0].id }));
      const r = await m.call("respond_to_concerns", { requestId: step.requestId, by: "Sanna Koskinen", responses });
      const after = r.json?.step ?? r.json;
      if (r.r.isError) return;
      // Settled by the agent: then the order it leads to must go to a named person (human_confirmation).
      let st = after;
      if (st?.state === "options_ready") st = (await m.call("choose_option", { requestId: st.requestId, optionId: st.options[0].optionId, by: "Sanna Koskinen" })).json?.step;
      const ex = st?.next?.example ?? st?.nextStep?.example;
      const q = st?.quote;
      if (!q) return void check.note(`after the agent's answer: ${st?.state}`);
      const o = await m.call("place_order", ex ?? { requestId: st.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) });
      const order = o.json?.order;
      check.expect(!(order?.status === "committed" && !order?.approval), `the agent settled the buyer's ${c.code} check over MCP and the order committed with no person`);
      check.note(`MCP relay: order ${order?.status} ${(order?.decision?.rules ?? []).filter((x: any) => x.outcome !== "pass").map((x: any) => x.rule).join(",")}`);
      await m.client.close();
    },
  },
];
