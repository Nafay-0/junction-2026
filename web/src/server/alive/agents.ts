import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { generateEd25519KeyPair } from "@/core/keys";
import { addDaysIso, isoWeekday, localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate, type Mandate } from "@/core/mandate";
import { AIVEN_BUYER } from "@/server/aiven/showcase/buyer";
import { currentDemoMandate } from "@/server/console-kitchens";
import { KITCHEN_ORG, demoKitchenKeyPair } from "@/server/demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { localFetch } from "@/server/local-transport";
import type { Runtime } from "@/server/runtime";
import { ShowAgent, type Json, type Reply } from "@/server/show/agent";
import { sampleNow } from "./clock";

/**
 * The sample's agents: each presents a mandate its organisation signed for the beat's moment (so a beat "three days
 * ago" carries a mandate valid then), and talks to Dock through the same doors an outside agent uses:
 *
 *   onsite   the kitchen's own agent in its store (the show's ShowAgent: Dock's REST routes in-process, on-site door)
 *   rest     an outside agent over REST (`localFetch`, an outside host): the door log says REST
 *   mcp      an outside agent over MCP (the stock MCP client against the in-process MCP route)
 *
 * Nothing here verifies a mandate or decides an order: the gate does, on every call.
 */
export type Who = "kaari" | "laakso" | "partner" | "aiven" | "hotel-lumo" | "koulu-metsola" | "kahvila-sointu";
export const PARTNER_AGENT = { agentId: "agent_laakso_partner_02", label: "Laakso's outside purchasing agent (a partner's)" };

export type Credentials = { mandateToken: string; agentId: string; mandate: Mandate; orgId: string; name: string };

export async function credentialsFor(rt: Runtime, who: Who, at: Date = sampleNow(), overrides: Partial<Mandate> = {}): Promise<Credentials> {
  const window = (m: Mandate): Mandate => ({ ...m, ...overrides, validFrom: new Date(at.getTime() - 120_000).toISOString(), validUntil: new Date(Math.max(Date.parse(m.validUntil), at.getTime() + 7 * 86_400_000)).toISOString() });
  if (who === "kaari") {
    const m = window(await currentDemoMandate("kaari", at));
    return { mandateToken: await signMandate(m, await demoKitchenKeyPair(), new Date()), agentId: KITCHEN_ORG.agentId, mandate: m, orgId: KITCHEN_ORG.orgId, name: KITCHEN_ORG.name };
  }
  if (who === "laakso" || who === "partner" || who === "aiven") {
    const base = await currentDemoMandate("laakso", at);
    const m = window(
      who === "laakso"
        ? base
        : who === "partner"
          ? { ...base, mandateId: `mnd_laakso_partner_${localNow(at).date.replaceAll("-", "")}`, agentId: PARTNER_AGENT.agentId }
          : demoMandate(at, { mandateId: `mnd_laakso_aiven_${localNow(at).date.replaceAll("-", "")}`, agentId: AIVEN_BUYER.agentId, weeklyBudgetCents: 2_000_000 }),
    );
    return { mandateToken: await signMandate(m, await demoOrgKeyPair(), new Date()), agentId: m.agentId, mandate: m, orgId: DEMO_ORG.orgId, name: DEMO_ORG.name };
  }
  const k = (await rt.accounts.kitchenOf(who))?.kitchen;
  if (!k) throw new Error(`no test kitchen ${who}`);
  const m = window(k.mandate);
  return { mandateToken: await rt.accounts.signForKitchen(who, m), agentId: k.agentId, mandate: m, orgId: k.orgId, name: k.mandate.issuer.name };
}

/** A mandate signed by a key no organisation registered: what a forger would present. */
export async function forgedToken(at: Date): Promise<{ token: string; agentId: string }> {
  const key = await generateEd25519KeyPair("laakso-catering-2026"); // the real kitchen's key id, a stranger's key
  const m = demoMandate(at, { perOrderLimitCents: 5_000_000, agentId: "agent_unknown_77" });
  return { token: await signMandate(m, key), agentId: "agent_unknown_77" };
}

/** Over REST, as an outside agent: authenticated by the mandate on every call, the door log says REST. */
export class RestAgent {
  constructor(private readonly c: { mandateToken: string; agentId: string }) {}
  async call<T = Json>(method: "GET" | "POST", path: string, body?: unknown): Promise<Reply<T>> {
    const headers: Record<string, string> = { accept: "application/json", authorization: `Mandate ${this.c.mandateToken}`, "dock-agent-id": this.c.agentId };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await localFetch(new Request(`https://sample-agent.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    let parsed: Json = {};
    try {
      parsed = (await res.json()) as Json;
    } catch {
      parsed = { error: { code: "not_json", message: `HTTP ${res.status}` } };
    }
    return { status: res.status, body: parsed as Reply<T>["body"] };
  }
}

/** The on-site agent of a kitchen's store, as the show drives it. */
export function onsiteAgent(c: Credentials, kitchen: string, share: string): ShowAgent {
  return new ShowAgent({ mandateToken: c.mandateToken, agentId: c.agentId }, { kitchen, share });
}

export type McpCall = (name: string, args?: Json) => Promise<Json>;

/** An outside agent over MCP: the stock client, the in-process route. */
export async function mcpAgent(c: { mandateToken: string; agentId: string }, query = ""): Promise<McpCall> {
  const { POST } = await import("@/app/api/mcp/route");
  const client = new Client({ name: "sample-outside-agent", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`/api/mcp${query}`, "https://sample-agent.example"), {
      fetch: async (u: string | URL, init?: RequestInit) => POST(new Request(u, init)),
      requestInit: { headers: { authorization: `Bearer ${c.mandateToken}`, "dock-agent-id": c.agentId } },
    }),
  );
  return async (name, args = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
    if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.structuredContent ?? r.content).slice(0, 300)}`);
    return r.structuredContent as Json;
  };
}

/** The next delivery day `n` delivery days after the beat's day, within the kitchen's weekdays. */
export function deliveryDay(at: Date, n = 1, weekdays = [1, 2, 3, 4, 5]): string {
  let d = localNow(at).date;
  for (let i = 0; i < n; i++) d = nextDeliveryDay(d, weekdays) ?? addDaysIso(d, 1);
  return d;
}

export const isWeekday = (d: string) => isoWeekday(d) <= 5;
