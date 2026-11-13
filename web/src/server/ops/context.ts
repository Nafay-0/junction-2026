import { decodeJwt } from "jose";
import type { LedgerEntry } from "@/core/ledger";
import type { Mandate } from "@/core/mandate";
import type { PublicOrder } from "@/core/orders";
import { AIVEN_BUYER } from "../aiven/showcase/buyer";
import { KITCHEN_ORG, demoKitchenMandate } from "../demo-kitchen";
import { DEMO_ORG, demoMandate } from "../dev-fixtures";
import type { Runtime } from "../runtime";
import type { SandboxSummary } from "../sandboxes";
import { doorLog, type DoorLog, type Via } from "./door";
import { licenceSource, type LicenceRecord } from "./licences";
import { suspensions, type SuspensionRegistry } from "./suspensions";

/**
 * Everything the operations views read, gathered once per call from the runtime, the way the wall's route does:
 * the ledger, the orders, the visitor kitchens, the door log, suspensions and licences. No view writes anything
 * except the control actions, which go through SuspensionRegistry.
 */
export type AgentInfo = {
  agentId: string;
  orgId: string;
  orgName: string;
  label: string;
  kind: "demo" | "visitor" | "outside";
  mandate?: Mandate;
  approverName?: string;
  expiresAt?: string;
};

export type OpsContext = {
  rt: Runtime;
  now: Date;
  entries: LedgerEntry[];
  orders: PublicOrder[];
  sandboxes: SandboxSummary[];
  door: DoorLog;
  suspensions: SuspensionRegistry;
  names: Record<string, string>;
  catalogueSize?: number;
  agents: Map<string, AgentInfo>;
  /** requestId -> the request entry */
  requests: Map<string, LedgerEntry>;
  /** requestId -> entries */
  byRequest: Map<string, LedgerEntry[]>;
  licence(agentId: string): LicenceRecord | undefined;
  viaOfRequest(requestId: string): Via | undefined;
  orgOfRequest(requestId: string): string | undefined;
};

const g = globalThis as typeof globalThis & { __dockOpsNames?: Map<string, string> };
const NAMES = (g.__dockOpsNames ??= new Map<string, string>());

async function learnNames(rt: Runtime, entries: LedgerEntry[]): Promise<void> {
  const ids = new Set<string>();
  const add = (v: unknown) => typeof v === "string" && ids.add(v);
  for (const e of entries) {
    const d = e.data as Record<string, unknown>;
    for (const id of Array.isArray(d.productIds) ? d.productIds : []) add(id);
    for (const id of Array.isArray(d.resultIds) ? (d.resultIds as unknown[]).slice(0, 10) : []) add(id);
    for (const l of Array.isArray(d.lines) ? d.lines : []) {
      add((l as { productId?: unknown }).productId);
      add((l as { substituteFor?: unknown }).substituteFor);
    }
    for (const o of Array.isArray(d.options) ? d.options : []) for (const l of (o as { lines?: unknown[] }).lines ?? []) add((l as { productId?: unknown }).productId);
    for (const x of Array.isArray(d.excluded) ? (d.excluded as unknown[]).slice(0, 40) : []) add((x as { productId?: unknown }).productId);
  }
  const unknown = [...ids].filter((id) => !NAMES.has(id));
  for (let i = 0; i < unknown.length && i < 400; i += 100) {
    try {
      for (const p of await rt.catalog.searchProducts({ ids: unknown.slice(i, i + 100), limit: 100 })) NAMES.set(p.id, p.name);
    } catch {
      // names are a nicety; ids stay as they are
    }
  }
}

function mandateOfToken(token: string): Mandate | undefined {
  try {
    return (decodeJwt(token) as { mandate?: Mandate }).mandate;
  } catch {
    return undefined;
  }
}

export async function opsContext(rt: Runtime, now = new Date()): Promise<OpsContext> {
  const { dock } = rt;
  const entries = dock.ledger.entries();
  const orders = await dock.listOrders();
  const sandboxes = await rt.sandboxes.list();
  const door = doorLog(dock);
  await learnNames(rt, entries);

  const agents = new Map<string, AgentInfo>();
  agents.set(KITCHEN_ORG.agentId, { agentId: KITCHEN_ORG.agentId, orgId: KITCHEN_ORG.orgId, orgName: KITCHEN_ORG.name, label: "Kaari's buyer agent", kind: "demo", mandate: door.mandateOf(KITCHEN_ORG.agentId) ?? demoKitchenMandate(now) });
  agents.set(AIVEN_BUYER.agentId, { agentId: AIVEN_BUYER.agentId, orgId: DEMO_ORG.orgId, orgName: DEMO_ORG.name, label: AIVEN_BUYER.label, kind: "outside", mandate: door.mandateOf(AIVEN_BUYER.agentId) });
  agents.set(DEMO_ORG.agentId, { agentId: DEMO_ORG.agentId, orgId: DEMO_ORG.orgId, orgName: DEMO_ORG.name, label: "Laakso's buyer agent", kind: "demo", mandate: door.mandateOf(DEMO_ORG.agentId) ?? demoMandate(now) });
  for (const s of sandboxes) {
    const creds = await rt.sandboxes.agentCredentials(s.sandboxId);
    agents.set(s.agentId, {
      agentId: s.agentId,
      orgId: s.orgId,
      orgName: `${s.kitchenName}, ${s.city}`,
      label: s.agentName,
      kind: "visitor",
      mandate: door.mandateOf(s.agentId) ?? (creds ? mandateOfToken(creds.mandateToken) : undefined),
      approverName: s.approverName,
      expiresAt: s.expiresAt,
    });
  }
  // Anyone else who came to the door with a mandate Dock trusts (an outside agent of a known kitchen, a closed visitor kitchen).
  for (const c of door.all()) {
    if (agents.has(c.agentId) || !c.orgId) continue;
    agents.set(c.agentId, { agentId: c.agentId, orgId: c.orgId, orgName: c.orgName ?? c.orgId, label: c.agentId, kind: "outside", mandate: door.mandateOf(c.agentId) });
  }

  const requests = new Map<string, LedgerEntry>();
  const byRequest = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    if (!e.requestId) continue;
    if (e.type === "request") requests.set(e.requestId, e);
    const list = byRequest.get(e.requestId) ?? [];
    list.push(e);
    byRequest.set(e.requestId, list);
  }
  for (const [requestId, e] of requests) {
    const agentId = e.actor.replace(/^agent:/, "");
    if (agents.has(agentId)) continue;
    const orgName = orders.find((o) => o.requestId === requestId)?.orgName ?? / of (.+?) opened a request/.exec(e.summary)?.[1] ?? "Unknown organisation";
    agents.set(agentId, { agentId, orgId: orders.find((o) => o.agentId === agentId)?.orgId ?? "unknown", orgName, label: agentId, kind: "outside" });
  }

  const catalogueSize = rt.catalogSource.kind === "valio" ? rt.catalogSource.products : await seedSize(rt);
  const lic = licenceSource();
  return {
    rt,
    now,
    entries,
    orders,
    sandboxes,
    door,
    suspensions: suspensions(dock),
    names: Object.fromEntries(NAMES),
    catalogueSize,
    agents,
    requests,
    byRequest,
    licence: (agentId) => lic.get(agentId),
    viaOfRequest: (requestId) => {
      const r = requests.get(requestId);
      return r ? door.viaAt(r.actor.replace(/^agent:/, ""), r.at)?.via : undefined;
    },
    orgOfRequest: (requestId) => {
      const r = requests.get(requestId);
      return r ? agents.get(r.actor.replace(/^agent:/, ""))?.orgName : undefined;
    },
  };
}

async function seedSize(rt: Runtime): Promise<number | undefined> {
  try {
    return (await rt.catalog.searchProducts({ limit: 100 })).length;
  } catch {
    return undefined;
  }
}

export const VIA_LABEL: Record<Via, string> = {
  onsite: "On-site agent",
  mcp: "Outside agent, MCP",
  rest: "Outside agent, REST",
};
