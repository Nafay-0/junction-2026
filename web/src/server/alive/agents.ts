import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { generateEd25519KeyPair } from "@/core/keys";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { addDaysIso, isoWeekday, localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate, type Mandate } from "@/core/mandate";
import { AIVEN_BUYER } from "@/server/aiven/showcase/buyer";
import { currentDemoMandate } from "@/server/console-kitchens";
import { KITCHEN_ORG, demoKitchenKeyPair } from "@/server/demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { localFetch } from "@/server/local-transport";
import type { Runtime } from "@/server/runtime";
import { attachConsoleContext } from "@/server/console-context";
import { ONSITE_HOST } from "@/server/ops/door";
import type { Json, Reply } from "@/server/show/agent";
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
export type Who = "kaari" | "laakso" | "partner" | "aiven" | "hotel-lumo" | "koulu-metsola" | "kahvila-sointu" | `sbx_${string}`;
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
  if (who.startsWith("sbx_")) {
    // A sample kitchen (sampleKitchens below): its mandate was signed for the whole sample week when it was opened.
    const [creds, m] = [await rt.sandboxes.agentCredentials(who), await rt.sandboxes.mandateOf(who)];
    if (!creds || !m) throw new Error(`the sample kitchen ${who} has closed`);
    return { mandateToken: creds.mandateToken, agentId: creds.agentId, mandate: m, orgId: m.issuer.orgId, name: m.issuer.name };
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

/**
 * The on-site agent of a kitchen's store, as the show drives it (Dock's REST routes in-process, the on-site door),
 * with the store door it came through (typed, or voice for a spoken request).
 */
export class OnsiteAgent {
  constructor(
    private readonly c: { mandateToken: string; agentId: string },
    private readonly ctx: { kitchen: string; share: string; door?: "typed" | "voice" },
  ) {}
  async call<T = Json>(method: "GET" | "POST", path: string, body?: unknown): Promise<Reply<T>> {
    const headers: Record<string, string> = { accept: "application/json", authorization: `Mandate ${this.c.mandateToken}`, "dock-agent-id": this.c.agentId };
    if (body !== undefined) headers["content-type"] = "application/json";
    const req = new Request(`http://${ONSITE_HOST}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    attachConsoleContext(req, { kitchen: this.ctx.kitchen, session: this.ctx.share, ...(this.ctx.door ? { door: this.ctx.door as "typed" } : {}) });
    const res = await localFetch(req);
    let parsed: Json = {};
    try {
      parsed = (await res.json()) as Json;
    } catch {
      parsed = { error: { code: "not_json", message: `HTTP ${res.status}` } };
    }
    return { status: res.status, body: parsed as Reply<T>["body"] };
  }
  withdraw(orderId: string, reason: string, by: string) {
    return this.call<{ order: Json }>("POST", `/api/v1/orders/${orderId}/withdraw`, { reason, by });
  }
}

export function onsiteAgent(c: Credentials, kitchen: string, share: string, door?: "typed" | "voice"): OnsiteAgent {
  return new OnsiteAgent({ mandateToken: c.mandateToken, agentId: c.agentId }, { kitchen, share, ...(door ? { door } : {}) });
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

/**
 * The sample's own kitchens: visitor kitchens (server/sandboxes.ts) opened by the sample itself, which no person can
 * sign into (their approver session is never handed out). Everything that stays open after a sample plays (orders
 * waiting for a person, a staged stock-out, a held renewal, offers not yet answered, a reissued mandate) lives here,
 * never in a kitchen a judge or a tester signs into. Each is reissued once with a mandate valid for the sample week
 * (the same terms, valid from eight days back), so beats days ago carry a mandate that was valid then. They close
 * with the visitor kitchens' timer (DOCK_SANDBOX_TTL_MINUTES); their orders stay in the ledger.
 */
const gs = globalThis as typeof globalThis & { __dockSampleApprovers?: Map<string, SoftwareAuthenticator> };
/** Per sample kitchen (its organisation), its purchasing manager's passkey: in this process only, never handed out. */
export const sampleApprover: Map<string, SoftwareAuthenticator> = (gs.__dockSampleApprovers ??= new Map());
/** The relying party the sample's passkeys belong to: not this site's, so they sign nothing anywhere else. */
export const SAMPLE_RP = { id: "sample.aimopilot.invalid", name: "AimoPilot sample activity", origins: ["https://sample.aimopilot.invalid"] };

export async function openSampleKitchens(rt: Runtime, n: number): Promise<`sbx_${string}`[]> {
  const out: `sbx_${string}`[] = [];
  for (let i = 0; i < n; i++) {
    // Joined with a passkey made in this process (a software authenticator, for a relying party of the sample's own):
    // the kitchen's purchasing manager signs through the real passkey ceremony, and nobody else holds the key.
    const auth = new SoftwareAuthenticator(SAMPLE_RP.origins[0]);
    const { options } = await rt.sandboxes.beginJoin(SAMPLE_RP);
    const { sandbox } = await rt.sandboxes.completeJoin(auth.register(options));
    sampleApprover.set(sandbox.orgId, auth);
    const m = (await rt.sandboxes.mandateOf(sandbox.sandboxId))!;
    // The fourth (the stage kitchen) buys more than milk: dairy too, with no claim required, so a product with a poor
    // delivery record can be ordered there (the backup) whatever the catalogue.
    const wider = i === 3 ? { allowedCategories: [...new Set([...m.allowedCategories, "cream", "yoghurt"])], requiredAttributes: [] } : {};
    await rt.sandboxes.reissue(sandbox.sandboxId, { ...m, ...wider, validFrom: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    out.push(sandbox.sandboxId as `sbx_${string}`);
  }
  return out;
}
