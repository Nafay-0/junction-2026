import { auditFor, type WholesalerAuditEntry } from "@/core/audit";
import type { IssuedClaim } from "@/core/claims";
import type { LedgerEntry } from "@/core/ledger";
import { readerName } from "@/core/second-reading";
import type { Mandate } from "@/core/mandate";
import { DockError, type AgentSession } from "@/core/orders";
import { RULES } from "@/core/policy";
import { eur, humanize, roleLabel } from "@/app/_ui/plain";
import { LIVE_LOOKUP_LIMITS } from "../mcp/live-lookup-guard";
import { MAX_LIVE_IDS_PER_CALL } from "@/core/catalog";
import type { Runtime } from "../runtime";
import { VIA_LABEL, opsContext, type AgentInfo, type OpsContext } from "./context";
import type { Via } from "./door";
import { licenceSource, type LicenceRecord } from "./licences";
import { disclose, isPrivate, type DisclosedEntry } from "./privacy";
import { GROUPS, RULE_INFO, allRules, ruleInfo, ruleTitleOf, type RuleGroup } from "./rules";
import { groundingStats, type GroundingStats } from "@/server/grounding";
import { SUSPENSION_RULE, type Suspension } from "./suspensions";
import { buildTrace, type Trace, type TraceOutcome } from "./trace";

/** Shapes for the operations pages. Plain words on the surface; ids, codes and hashes ride along for "details". */

export type LicenceView = { level: string; name: string; rating?: number; why?: string; ratedAt?: string } | null;

const licenceView = (l: LicenceRecord | undefined): LicenceView => (l ? { level: l.level, name: l.name, rating: l.rating, why: l.why, ratedAt: l.ratedAt } : null);

function traceFor(ctx: OpsContext, requestId: string): Trace {
  return buildTrace({
    requestId,
    entries: ctx.byRequest.get(requestId) ?? [],
    orders: ctx.orders,
    names: ctx.names,
    catalogueSize: ctx.catalogueSize,
    orgName: ctx.orgOfRequest(requestId),
    via: ctx.viaOfRequest(requestId),
    door: ctx.doorOfRequest(requestId),
  });
}

/**
 * Signed claims the wholesaler issued, as the wholesaler's own staff may read them. The core hands claims out per
 * organisation (dock.getClaims checks the audience); operations reads them for the organisation the request
 * belongs to, which is the same audience the claims were issued to.
 */
export async function claimsOf(rt: Runtime, orgId: string, ids: string[]): Promise<IssuedClaim[]> {
  if (!ids.length) return [];
  const asOrg = { mandate: { issuer: { orgId } }, agentId: "operations" } as unknown as AgentSession;
  try {
    return await rt.dock.getClaims(asOrg, [...new Set(ids)].slice(0, 100));
  } catch {
    return [];
  }
}

export type ClaimToken = { claimId: string; type: string; productId: string; sha256: string; token: string; validUntil: string };

function suspensionOf(ctx: OpsContext, agent: AgentInfo | undefined): Suspension | undefined {
  return agent ? ctx.suspensions.find(agent.agentId, agent.orgId) : undefined;
}

// ---------- live view ----------

export type SessionRow = {
  requestId: string;
  orgName: string;
  agentId: string;
  agentLabel: string;
  via?: Via;
  licence: LicenceView;
  asked: string;
  doing: string;
  outcome: TraceOutcome;
  totalCents?: number;
  startedAt: string;
  lastAt: string;
  steps: number;
  refusals: number;
  suspended: boolean;
};

export type DoorAgent = {
  agentId: string;
  agentLabel: string;
  orgName: string;
  orgId: string;
  vias: Via[];
  lastVia?: Via;
  lastAt: string;
  calls: number;
  refused: number;
  suspended?: { since: string; reason: string; scope: "agent" | "org" };
  licence: LicenceView;
  current?: { requestId: string; doing: string };
};

export type Overview = {
  at: string;
  counters: { requests: number; committed: number; byAgentAlone: number; byPerson: number; waiting: number; refused: number; liveCalls: number; suspended: number };
  doors: Record<Via, { agents: number; calls: number; refused: number }>;
  atDoor: DoorAgent[];
  sessions: SessionRow[];
  chain: { ok: boolean; length: number; message?: string };
  catalogue: { kind: "valio" | "seed"; products?: number };
};

const RECENT_MINUTES = 30;

export async function overview(rt: Runtime): Promise<Overview> {
  const ctx = await opsContext(rt);
  const traces = [...ctx.requests.keys()].map((id) => traceFor(ctx, id));
  const sessions: SessionRow[] = traces
    .map((t) => {
      const agent = ctx.agents.get(t.agentId);
      const last = t.steps.at(-1);
      const order = ctx.orders.filter((o) => o.requestId === t.requestId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      return {
        requestId: t.requestId,
        orgName: t.orgName,
        agentId: t.agentId,
        agentLabel: agent?.label ?? t.agentId,
        via: t.via,
        licence: licenceView(ctx.licence(t.agentId)),
        asked: humanize(t.asked, ctx.names),
        doing: last?.title ?? "Opened",
        outcome: t.outcome,
        totalCents: order?.totalCents,
        startedAt: t.startedAt,
        lastAt: t.endedAt,
        steps: t.steps.length,
        refusals: t.steps.filter((s) => s.phase === "refused" || (s.phase === "gate" && s.checks?.some((c) => c.outcome === "fail"))).length,
        suspended: !!suspensionOf(ctx, agent),
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  const since = ctx.now.getTime() - RECENT_MINUTES * 60_000;
  const byAgent = new Map<string, DoorAgent>();
  for (const c of ctx.door.all()) {
    const agent = ctx.agents.get(c.agentId);
    const a: DoorAgent = byAgent.get(c.agentId) ?? {
      agentId: c.agentId,
      agentLabel: agent?.label ?? c.agentId,
      orgName: agent?.orgName ?? c.orgName ?? "Unknown organisation",
      orgId: agent?.orgId ?? c.orgId ?? "unknown",
      vias: [],
      lastAt: c.at,
      calls: 0,
      refused: 0,
      licence: licenceView(ctx.licence(c.agentId)),
    };
    if (!a.vias.includes(c.via)) a.vias.push(c.via);
    a.lastVia = c.via;
    a.lastAt = c.at;
    a.calls += 1;
    if (!c.ok) a.refused += 1;
    byAgent.set(c.agentId, a);
  }
  for (const a of byAgent.values()) {
    const s = suspensionOf(ctx, ctx.agents.get(a.agentId) ?? { agentId: a.agentId, orgId: a.orgId, orgName: a.orgName, label: a.agentLabel, kind: "outside" });
    if (s) a.suspended = { since: s.at, reason: s.reason, scope: s.scope };
    const cur = sessions.find((r) => r.agentId === a.agentId);
    if (cur) a.current = { requestId: cur.requestId, doing: cur.doing };
  }
  const atDoor = [...byAgent.values()].filter((a) => Date.parse(a.lastAt) >= since || a.suspended).sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  const doors: Overview["doors"] = { onsite: { agents: 0, calls: 0, refused: 0 }, mcp: { agents: 0, calls: 0, refused: 0 }, rest: { agents: 0, calls: 0, refused: 0 } };
  const agentsPerDoor: Record<Via, Set<string>> = { onsite: new Set(), mcp: new Set(), rest: new Set() };
  for (const c of ctx.door.all()) {
    doors[c.via].calls += 1;
    if (!c.ok) doors[c.via].refused += 1;
    agentsPerDoor[c.via].add(c.agentId);
  }
  for (const v of Object.keys(doors) as Via[]) doors[v].agents = agentsPerDoor[v].size;

  const committed = ctx.orders.filter((o) => o.status === "committed");
  const chain = rt.dock.ledger.verify();
  return {
    at: ctx.now.toISOString(),
    counters: {
      requests: ctx.requests.size,
      committed: committed.length,
      byAgentAlone: committed.filter((o) => !o.approval).length,
      byPerson: committed.filter((o) => o.approval?.status === "approved").length,
      waiting: ctx.orders.filter((o) => o.status === "pending_approval").length,
      refused: refusalCases(ctx).length,
      liveCalls: rt.dock.stats().liveCalls,
      suspended: ctx.suspensions.active().length,
    },
    doors,
    atDoor,
    sessions: sessions.slice(0, 60),
    chain: chain.ok ? { ok: true, length: chain.length } : { ok: false, length: ctx.entries.length, message: chain.message },
    catalogue: rt.catalogSource.kind === "valio" ? { kind: "valio", products: rt.catalogSource.products } : { kind: "seed", products: ctx.catalogueSize },
  };
}

// ---------- the trace ----------

export type TraceView = Trace & {
  agentLabel: string;
  licence: LicenceView;
  viaLabel?: string;
  /** The conversation the request came from, when a kitchen's agent thread opened it (/ops/conversation/<id>). */
  conversation?: string;
  chain: { ok: boolean; length: number; head: { seq: number; hash: string } | null; message?: string };
  others: { requestId: string; label: string; at: string }[];
  /** The signed claims named in the trace, by id, so the page can verify each against the published keys. */
  claims: Record<string, ClaimToken>;
};

export async function traceView(rt: Runtime, requestId: string): Promise<TraceView> {
  const ctx = await opsContext(rt);
  if (!ctx.requests.has(requestId)) throw new DockError(404, "request_not_found", `No request ${requestId} on this server.`);
  const t = traceFor(ctx, requestId);
  const chain = rt.dock.ledger.verify();
  const orgId = ctx.orders.find((o) => o.requestId === requestId)?.orgId ?? ctx.agents.get(t.agentId)?.orgId;
  const issued = orgId ? await claimsOf(rt, orgId, t.steps.flatMap((s) => s.claimIds ?? [])) : [];
  return {
    ...t,
    claims: Object.fromEntries(issued.map((c) => [c.claimId, { claimId: c.claimId, type: c.type, productId: c.productId, sha256: c.sha256, token: c.token, validUntil: c.validUntil }])),
    asked: t.asked,
    agentLabel: ctx.agents.get(t.agentId)?.label ?? t.agentId,
    licence: licenceView(ctx.licence(t.agentId)),
    viaLabel: t.via && VIA_LABEL[t.via],
    conversation: (ctx.entries.find((e) => e.type === "agent" && e.requestId === requestId)?.data as { thread?: { threadId?: string } } | undefined)?.thread?.threadId,
    chain: chain.ok ? { ok: true, length: chain.length, head: chain.head } : { ok: false, length: ctx.entries.length, head: rt.dock.ledger.head(), message: chain.message },
    others: [...ctx.requests.values()]
      .slice(-40)
      .reverse()
      .map((e) => ({ requestId: e.requestId!, label: `${ctx.orgOfRequest(e.requestId!) ?? "?"}: ${humanize(String(e.data.text ?? ""), ctx.names).slice(0, 70)}`, at: e.at })),
  };
}

/** The latest request, for /ops/trace without an id. */
export async function latestRequestId(rt: Runtime): Promise<string | undefined> {
  return rt.dock.ledger.entries().filter((e) => e.type === "request").at(-1)?.requestId;
}

// ---------- safeguards ----------

type Case = { at: string; seq: number; rule: string; outcome: "fail" | "escalate"; orgName: string; agentLabel: string; via?: Via; requestId?: string; orderId?: string; reason: string; tried: string };

const TRIED_BY_CODE: [RegExp, string][] = [
  [/^mandate_|^agent_id_missing/, "Connected to the gate"],
  [/agent_suspended|organisation_suspended/, "Called the gate while suspended"],
  [/^live_lookup|^catalog_|too_many/, "Asked live prices for many products"],
  [/^quote_insufficient|^quote_no_offer|^quote_unknown|^quote_invalid/, "Asked for a fixed-price quote"],
  [/^quote_/, "Placed an order with a quote"],
  [/^approval_/, "Tried to sign off an order"],
  [/^intake_/, "Went around the buyer's confirmation"],
];

function triedOf(code: string | undefined, rule: string | undefined, path?: string): string {
  if (code) for (const [re, label] of TRIED_BY_CODE) if (re.test(code)) return label;
  if (rule === "live_lookup_limit") return "Asked live prices for many products";
  return path ? `Called ${path}` : "Called the gate";
}

function refusalCases(ctx: OpsContext): Case[] {
  const out: Case[] = [];
  const agentOf = (actor: string) => ctx.agents.get(actor.replace(/^agent:/, ""));
  for (const e of ctx.entries) {
    const d = e.data as Record<string, unknown>;
    if (e.type === "refusal") {
      const rule = typeof d.rule === "string" ? d.rule : "unknown";
      const agent = agentOf(e.actor);
      out.push({
        at: e.at,
        seq: e.seq,
        rule,
        outcome: "fail",
        orgName: (e.requestId && ctx.orgOfRequest(e.requestId)) || agent?.orgName || (e.actor.startsWith("approver") ? "An approver" : "Unknown caller"),
        agentLabel: agent?.label ?? (e.actor.startsWith("agent:") ? e.actor.slice(6) : e.actor === "dock" ? "AimoPilot" : "Unknown"),
        via: (typeof d.via === "string" ? (d.via as Via) : undefined) ?? (e.requestId ? ctx.viaOfRequest(e.requestId) : agent ? ctx.door.viaAt(agent.agentId, e.at)?.via : undefined),
        requestId: e.requestId,
        orderId: e.orderId,
        reason: humanize(e.summary.replace(/^Refused: /, ""), ctx.names),
        tried: triedOf(typeof d.code === "string" ? d.code : undefined, rule, typeof d.path === "string" ? d.path : undefined),
      });
    } else if (e.type === "decision" && e.data.outcome === "reject") {
      out.push(...decisionCases(ctx, e, "fail"));
    }
  }
  return out.sort((a, b) => b.seq - a.seq);
}

/** One case per failing (or escalating) rule of a gate decision, with its reason. */
function decisionCases(ctx: OpsContext, e: LedgerEntry, outcome: "fail" | "escalate"): Case[] {
  const d = e.data as { rules?: { rule: string; outcome: string }[]; reasons?: string[]; totalCents?: number };
  const order = ctx.orders.find((o) => o.orderId === e.orderId);
  const hits = (d.rules ?? []).filter((r) => r.outcome === outcome);
  const reasons = d.reasons ?? [];
  const agent = order ? ctx.agents.get(order.agentId) : undefined;
  return hits.map((r, i) => ({
    at: e.at,
    seq: e.seq,
    rule: r.rule,
    outcome,
    orgName: order?.orgName ?? (e.requestId && ctx.orgOfRequest(e.requestId)) ?? "Unknown organisation",
    agentLabel: agent?.label ?? order?.agentId ?? "Buyer agent",
    via: e.requestId ? ctx.viaOfRequest(e.requestId) : undefined,
    requestId: e.requestId,
    orderId: e.orderId,
    reason: humanize(order?.decision.rules.find((x) => x.rule === r.rule)?.reason ?? reasons[i] ?? "", ctx.names),
    tried: `Placed an order for ${eur(Number(d.totalCents ?? 0))}`,
  }));
}

export type RuleRow = {
  rule: string;
  title: string;
  does: string;
  where: string;
  refused: number;
  sentToPerson: number;
  passed: number;
  recent: Case[];
};

export type Safeguards = {
  at: string;
  groups: { id: RuleGroup; title: string; blurb: string; rules: RuleRow[] }[];
  refusedFeed: Case[];
  live: {
    catalogue?: number;
    searches: number;
    liveCalls: number;
    productsPriced: number;
    distinctPriced: number;
    considered: number;
    avoidedShare: number | null;
    catalogueUntouchedShare: number | null;
    limits: { maxPerCall: number; windowMinutes: number; maxCallsPerAgent: number; maxProductsPerAgent: number };
    refusedLookups: number;
  };
  totals: { decisions: number; refused: number; sentToPerson: number };
  /** Requests read twice (server/agent/second-reader.ts): how often the readers agreed, differed, or the second was unavailable. */
  secondReading: SecondReadingStats;
  /**
   * The grounding check (server/grounding.ts): how often model text was checked and how often something in it had to
   * be removed, per surface, since this server started. Also the `grounding_check` rule's row: refused = texts in which
   * it removed something, passed = texts it let through unchanged.
   */
  grounding: GroundingStats;
};

export type SecondReadingStats = {
  agreed: number;
  differed: number;
  unavailable: number;
  /** Why the second reader was unavailable, by reason. */
  unavailableBy: Record<string, number>;
  /** How the buyer settled a difference: kept the first reading, took the second, or wrote it again. */
  settled: { keptFirst: number; tookSecond: number; rewrote: number };
  /** The readers, in words ("Claude Opus 5.5", "NVIDIA Nemotron 3 Nano"). */
  readers: { first: string[]; second: string[] };
  recent: { at: string; seq: number; requestId?: string; orgName: string; fields: string[]; line: string }[];
};

/** The second reader's record, from the ledger alone. */
export function secondReadingStats(entries: LedgerEntry[], orgOf: (requestId: string) => string | undefined = () => undefined): SecondReadingStats {
  const out: SecondReadingStats = { agreed: 0, differed: 0, unavailable: 0, unavailableBy: {}, settled: { keptFirst: 0, tookSecond: 0, rewrote: 0 }, readers: { first: [], second: [] }, recent: [] };
  const firsts = new Set<string>();
  const seconds = new Set<string>();
  for (const e of entries) {
    if (e.type !== "intake") continue;
    const d = e.data as Record<string, unknown>;
    if (d.step === "second_reading") {
      const status = d.status;
      if (status === "agreed") out.agreed++;
      else if (status === "differed") {
        out.differed++;
        const diffs = (Array.isArray(d.differences) ? d.differences : []) as { field?: string }[];
        out.recent.push({ at: e.at, seq: e.seq, requestId: e.requestId, orgName: (e.requestId && orgOf(e.requestId)) || "A kitchen", fields: diffs.map((x) => String(x.field ?? "")), line: e.summary });
      } else if (status === "unavailable") {
        out.unavailable++;
        const why = String(d.reason ?? "failed");
        out.unavailableBy[why] = (out.unavailableBy[why] ?? 0) + 1;
      }
      if (typeof d.firstModel === "string") firsts.add(readerName(d.firstModel));
      if (typeof d.secondModel === "string") seconds.add(readerName(d.secondModel));
    } else if ((d.step === "correction" || d.step === "cancelled") && d.code === "readings_differ") {
      if (d.step === "cancelled" || d.correctionId === "rewrite") out.settled.rewrote++;
      else if (d.correctionId === "use_second") out.settled.tookSecond++;
      else out.settled.keptFirst++;
    }
  }
  out.readers = { first: [...firsts], second: [...seconds] };
  out.recent = out.recent.sort((a, b) => b.seq - a.seq).slice(0, 5);
  return out;
}

export async function safeguards(rt: Runtime): Promise<Safeguards> {
  const ctx = await opsContext(rt);
  const grounding = groundingStats();
  const cases = refusalCases(ctx);
  const escalations: Case[] = [];
  const passes = new Map<string, number>();
  let decisions = 0;
  for (const e of ctx.entries) {
    if (e.type !== "decision") continue;
    decisions += 1;
    for (const r of (e.data.rules as { rule: string; outcome: string }[] | undefined) ?? []) if (r.outcome === "pass") passes.set(r.rule, (passes.get(r.rule) ?? 0) + 1);
    if (e.data.outcome === "needs_human_approval") escalations.push(...decisionCases(ctx, e, "escalate"));
  }
  const seen = new Set([...cases.map((c) => c.rule), ...escalations.map((c) => c.rule)].filter((r) => r !== "unknown"));
  const rows = allRules(seen).map((rule): RuleRow & { group: RuleGroup } => {
    const info = ruleInfo(rule);
    const mine = [...cases, ...escalations].filter((c) => c.rule === rule).sort((a, b) => b.seq - a.seq);
    if (rule === "grounding_check") {
      const t = grounding.totals;
      return { rule, group: info.group, title: ruleTitleOf(rule), does: info.does, where: info.where, refused: t.fired, sentToPerson: 0, passed: t.checked - t.fired, recent: groundingCases(grounding) };
    }
    return {
      rule,
      group: info.group,
      title: ruleTitleOf(rule),
      does: info.does,
      where: info.where,
      refused: mine.filter((c) => c.outcome === "fail").length,
      sentToPerson: mine.filter((c) => c.outcome === "escalate").length,
      passed: passes.get(rule) ?? 0,
      recent: mine.slice(0, 3),
    };
  });
  const order = Object.keys(RULE_INFO);
  const rank = (rule: string) => (order.indexOf(rule) + 1 || order.length + 1);
  const groups = GROUPS.map((g) => ({
    ...g,
    rules: rows
      .filter((r) => r.group === g.id)
      .sort((a, b) => rank(a.rule) - rank(b.rule))
      .map(({ group: _g, ...r }) => (void _g, r)),
  })).filter((g) => g.rules.length);

  // How much the live service was spared: per request, products looked at in master data vs the few priced live.
  let considered = 0;
  let pricedSum = 0;
  const distinct = new Set<string>();
  for (const id of ctx.requests.keys()) {
    const t = traceFor(ctx, id);
    considered += Math.max(t.considered, t.priced);
    pricedSum += t.priced;
  }
  for (const e of ctx.entries) if (e.type === "lookup" && e.data.source === "live") for (const id of (e.data.productIds as string[] | undefined) ?? []) distinct.add(id);
  const stats = rt.dock.stats();
  return {
    at: ctx.now.toISOString(),
    groups,
    refusedFeed: cases.slice(0, 40),
    live: {
      catalogue: ctx.catalogueSize,
      searches: stats.searches,
      liveCalls: stats.liveCalls,
      productsPriced: stats.productsPriced,
      distinctPriced: distinct.size,
      considered,
      avoidedShare: considered ? 1 - pricedSum / considered : null,
      catalogueUntouchedShare: ctx.catalogueSize ? 1 - distinct.size / ctx.catalogueSize : null,
      limits: { maxPerCall: MAX_LIVE_IDS_PER_CALL, windowMinutes: LIVE_LOOKUP_LIMITS.windowMinutes, maxCallsPerAgent: LIVE_LOOKUP_LIMITS.maxCalls, maxProductsPerAgent: LIVE_LOOKUP_LIMITS.maxDistinctProducts },
      refusedLookups: cases.filter((c) => c.rule === "live_lookup_limit").length,
    },
    totals: { decisions, refused: cases.length, sentToPerson: escalations.length },
    secondReading: secondReadingStats(ctx.entries, ctx.orgOfRequest),
    grounding,
  };
}

const SURFACE_LABEL: Record<GroundingStats["recent"][number]["surface"], string> = { assistant: "Shop assistant", voice: "Voice agent", menu: "Menu planner", interpret: "Request reader", memory: "Kitchen memory", aiven: "Aiven agent", thread: "Store agent (conversation)" };

/** The latest fires of the grounding check as the rule row's recent cases: what was removed, never the rest of the text. */
function groundingCases(g: GroundingStats): Case[] {
  return g.recent.slice(0, 3).map((f, i) => ({ at: f.at, seq: -1 - i, rule: "grounding_check", outcome: "fail" as const, orgName: SURFACE_LABEL[f.surface], agentLabel: SURFACE_LABEL[f.surface], reason: `Removed before display: ${f.said.map((x) => `"${x}"`).join(", ")} (${f.kinds.join(", ")}), not in the data.`, tried: f.said.join(", ") }));
}

// ---------- control ----------

export type Waiting = {
  approvalId: string;
  orderId: string;
  requestId?: string;
  orgName: string;
  agentLabel: string;
  approverName: string;
  approverRole: string;
  totalCents: number;
  reasons: string[];
  requestedAt: string;
  priceHeldUntil?: string;
  agentSuspended: boolean;
};

export type ControlView = {
  at: string;
  mode: "demo" | "passcode";
  active: Suspension[];
  past: Suspension[];
  agents: { agentId: string; label: string; orgId: string; orgName: string; kind: AgentInfo["kind"]; lastAt?: string; suspended?: string }[];
  orgs: { orgId: string; orgName: string; agents: number; suspended?: string }[];
  waiting: Waiting[];
};

export async function controlView(rt: Runtime, mode: "demo" | "passcode"): Promise<ControlView> {
  const ctx = await opsContext(rt);
  const all = ctx.suspensions.all().sort((a, b) => b.at.localeCompare(a.at));
  const lastSeen = new Map<string, string>();
  for (const c of ctx.door.all()) lastSeen.set(c.agentId, c.at);
  const agents = [...ctx.agents.values()].map((a) => {
    const own = all.find((s) => !s.resumedAt && s.scope === "agent" && s.target === a.agentId);
    return { agentId: a.agentId, label: a.label, orgId: a.orgId, orgName: a.orgName, kind: a.kind, lastAt: lastSeen.get(a.agentId), suspended: own?.suspensionId };
  });
  const orgMap = new Map<string, ControlView["orgs"][number]>();
  for (const a of ctx.agents.values()) {
    if (a.orgId === "unknown") continue;
    const o = orgMap.get(a.orgId) ?? { orgId: a.orgId, orgName: a.orgName, agents: 0, suspended: all.find((s) => !s.resumedAt && s.scope === "org" && s.target === a.orgId)?.suspensionId };
    o.agents += 1;
    orgMap.set(a.orgId, o);
  }
  return {
    at: ctx.now.toISOString(),
    mode,
    active: all.filter((s) => !s.resumedAt),
    past: all.filter((s) => s.resumedAt).slice(0, 20),
    agents,
    orgs: [...orgMap.values()],
    waiting: await waitingSignOffs(rt, ctx),
  };
}

export async function waitingSignOffs(rt: Runtime, ctx?: OpsContext): Promise<Waiting[]> {
  const c = ctx ?? (await opsContext(rt));
  const pending = await rt.dock.listPendingApprovals();
  const out: Waiting[] = [];
  for (const p of pending) {
    let priceHeldUntil: string | undefined;
    try {
      priceHeldUntil = (await rt.dock.approvalContext(p.approvalId)).quoteExpiresAt;
    } catch {
      // the approval vanished between the two reads
    }
    const order = c.orders.find((o) => o.orderId === p.orderId);
    const agent = c.agents.get(p.agentId);
    out.push({
      approvalId: p.approvalId,
      orderId: p.orderId,
      requestId: order?.requestId,
      orgName: p.orgName,
      agentLabel: agent?.label ?? p.agentId,
      approverName: p.approver.name,
      approverRole: roleLabel(p.approver.role),
      totalCents: p.totalCents,
      reasons: p.reasons.map((r) => humanize(r, c.names)),
      requestedAt: p.requestedAt,
      priceHeldUntil,
      agentSuspended: !!suspensionOf(c, agent),
    });
  }
  return out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

export async function suspendTarget(rt: Runtime, input: { scope: "agent" | "org"; target: string; reason: string; by: string }): Promise<Suspension> {
  const ctx = await opsContext(rt);
  if (input.scope === "agent") {
    const a = ctx.agents.get(input.target);
    if (!a) throw new DockError(404, "agent_not_found", `No agent ${input.target} has come to this gate.`);
    return ctx.suspensions.suspend({ scope: "agent", target: a.agentId, label: `${a.label} (${a.orgName})`, reason: input.reason, by: input.by, orgId: a.orgId });
  }
  const a = [...ctx.agents.values()].find((x) => x.orgId === input.target);
  if (!a) throw new DockError(404, "org_not_found", `No organisation ${input.target} has come to this gate.`);
  return ctx.suspensions.suspend({ scope: "org", target: a.orgId, label: a.orgName, reason: input.reason, by: input.by, orgId: a.orgId });
}

// ---------- audit ----------

export type AuditListRow = { orderId: string; requestId: string; orgName: string; status: string; totalCents: number; at: string; signedBy?: string; agentLabel: string };

export async function auditList(rt: Runtime): Promise<AuditListRow[]> {
  const ctx = await opsContext(rt);
  return ctx.orders
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((o) => ({
      orderId: o.orderId,
      requestId: o.requestId,
      orgName: o.orgName,
      status: o.status,
      totalCents: o.totalCents,
      at: o.updatedAt,
      signedBy: o.approval?.status === "approved" ? o.approval.approver.name : undefined,
      agentLabel: ctx.agents.get(o.agentId)?.label ?? o.agentId,
    }));
}

export type AuditRecord = {
  schema: "dock-wholesaler-audit/1";
  exportedAt: string;
  order: {
    orderId: string;
    requestId: string;
    quoteId: string;
    status: string;
    orgId: string;
    orgName: string;
    agentId: string;
    mandateId: string;
    totalCents: number;
    createdAt: string;
    updatedAt: string;
  };
  asked: { text: string; neededBy?: string; understoodAs?: Record<string, unknown> };
  claimed: {
    at: string;
    seq: number;
    products: { productId: string; name: string; unitPriceCents?: number; availablePacks?: number | null; deliveryDate?: string; origin?: string | null; claimIds?: string[] }[];
  }[];
  /** The signed claims (W3C VC 2.0 as vc+jwt) the quote rests on, with their tokens, verifiable offline. */
  signedClaims: { available: boolean; note: string; refs: unknown[]; tokens: ClaimToken[] };
  committed: {
    lines: { productId: string; name: string; quantity: number; unitPriceCents: number; lineTotalCents: number; deliveryDate: string; substituteFor?: string; countryOfOrigin?: string | null }[];
    totalCents: number;
    decision: { outcome: string; rules: { rule: string; title: string; outcome: string; reason: string }[] };
    authorisedBy: string;
    signOff?: { name: string; role: string; method?: string; verified?: boolean; at?: string; orderDigest: string };
    confirmation?: string;
    ledgerHead?: { seq: number; hash: string } | null;
  };
  keys: { jwks: string; kid?: string };
  /** The wholesaler's reading of the ledger (core/audit.ts), and the same entries with hashes for an offline chain check. */
  ledger: { verified: boolean; head: { seq: number; hash: string } | null; explanation: string[]; wholesalerView: WholesalerAuditEntry[]; entries: DisclosedEntry[]; withheld: number };
};

export async function auditRecord(rt: Runtime, orderId: string): Promise<AuditRecord> {
  const ctx = await opsContext(rt);
  const order = ctx.orders.find((o) => o.orderId === orderId);
  if (!order) throw new DockError(404, "order_not_found", `No order ${orderId}.`);
  const entries = ctx.byRequest.get(order.requestId) ?? [];
  const request = entries.find((e) => e.type === "request");
  const need = entries.find((e) => e.type === "intake" && e.data.step === "need")?.data.need as Record<string, unknown> | undefined;
  const products = new Map<string, { origin?: string | null }>();
  try {
    const ids = [...new Set([...order.lines.map((l) => l.productId), ...entries.flatMap((e) => (e.type === "lookup" && e.data.source === "live" ? ((e.data.productIds as string[]) ?? []) : []))])];
    for (const p of await rt.catalog.searchProducts({ ids: ids.slice(0, 100), limit: 100 })) products.set(p.id, { origin: (p as { countryOfOrigin?: string | null }).countryOfOrigin ?? null });
  } catch {
    // origin is optional detail
  }
  const claimed = entries
    .filter((e) => e.type === "lookup" && e.data.source === "live")
    .map((e) => {
      const offers = (e.data.offers as Record<string, unknown>[] | undefined) ?? [];
      return {
        at: e.at,
        seq: e.seq,
        products: ((e.data.productIds as string[] | undefined) ?? []).map((id) => {
          const o = offers.find((x) => x.productId === id);
          const packs = typeof o?.availablePacks === "number" ? (o.availablePacks >= 999_999 ? null : o.availablePacks) : undefined;
          return {
            productId: id,
            name: ctx.names[id] ?? id,
            unitPriceCents: typeof o?.unitPriceCents === "number" ? o.unitPriceCents : undefined,
            availablePacks: packs,
            deliveryDate: typeof o?.deliveryDate === "string" ? o.deliveryDate : undefined,
            origin: products.get(id)?.origin,
            claimIds: o?.claims && typeof o.claims === "object" ? Object.values(o.claims as Record<string, unknown>).filter((x): x is string => typeof x === "string") : undefined,
          };
        }),
      };
    });
  const quoteEntry = entries.find((e) => e.type === "quote" && e.data.quoteId === order.quoteId);
  const evidence = (quoteEntry?.data.evidence as unknown[] | undefined) ?? [];
  const orderEntry = entries.find((e) => e.type === "order" && e.orderId === orderId);
  const approvalEntry = entries.filter((e) => e.type === "approval" && e.orderId === orderId).at(-1);
  const signOff = approvalEntry?.data.signOff as { method?: string; verified?: boolean; at?: string } | undefined;
  const chain = rt.dock.ledger.verify();
  const disclosed = entries.map(disclose);
  const view = auditFor("wholesaler", entries);
  const quoteClaimIds = (evidence as { claimId?: string }[]).map((x) => x.claimId).filter((x): x is string => typeof x === "string");
  const tokens = (await claimsOf(rt, order.orgId, quoteClaimIds)).map((c) => ({ claimId: c.claimId, type: c.type, productId: c.productId, sha256: c.sha256, token: c.token, validUntil: c.validUntil }));
  return {
    schema: "dock-wholesaler-audit/1",
    exportedAt: ctx.now.toISOString(),
    order: {
      orderId: order.orderId,
      requestId: order.requestId,
      quoteId: order.quoteId,
      status: order.status,
      orgId: order.orgId,
      orgName: order.orgName,
      agentId: order.agentId,
      mandateId: order.mandateId,
      totalCents: order.totalCents,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
    asked: { text: String(request?.data.text ?? ""), neededBy: request?.data.neededBy as string | undefined, understoodAs: need },
    claimed,
    signedClaims: evidence.length
      ? { available: true, note: "The quote rests on these signed claims (price, availability, origin); each token is a W3C Verifiable Credential as a compact JWS, verifiable against the published keys.", refs: evidence, tokens }
      : { available: false, note: "This quote names no signed claims; the quote and the order confirmation are signed.", refs: [], tokens: [] },
    committed: {
      lines: order.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        deliveryDate: l.deliveryDate,
        substituteFor: l.substituteFor?.productId,
        countryOfOrigin: products.get(l.productId)?.origin,
      })),
      totalCents: order.totalCents,
      decision: { outcome: order.decision.outcome, rules: order.decision.rules.map((r) => ({ rule: r.rule, title: ruleTitleOf(r.rule), outcome: r.outcome, reason: r.reason })) },
      authorisedBy: order.status !== "committed" ? "not committed" : order.approval?.status === "approved" ? `${order.approval.approver.name} (${roleLabel(order.approval.approver.role)})` : "the mandate alone",
      signOff: order.approval
        ? { name: order.approval.approver.name, role: roleLabel(order.approval.approver.role), method: signOff?.method, verified: signOff?.verified, at: signOff?.at, orderDigest: order.approval.orderDigest }
        : undefined,
      confirmation: order.confirmation,
      ledgerHead: (orderEntry?.data.ledgerHead as { seq: number; hash: string } | null | undefined) ?? undefined,
    },
    keys: { jwks: "/.well-known/jwks.json", kid: rt.dock.wholesalerPublicJwk.kid },
    ledger: { verified: chain.ok, head: rt.dock.ledger.head(), explanation: view.explanation, wholesalerView: view.entries as WholesalerAuditEntry[], entries: disclosed, withheld: disclosed.filter((e) => e.withheld).length },
  };
}

/** The whole chain for a browser check: every entry, with the kitchen's private steps withheld but hashes kept. */
export function ledgerForCheck(rt: Runtime): { entries: DisclosedEntry[]; withheld: number; server: { ok: boolean; length: number; message?: string } } {
  const all = rt.dock.ledger.entries();
  const entries = all.map(disclose);
  const v = rt.dock.ledger.verify();
  return { entries, withheld: all.filter(isPrivate).length, server: v.ok ? { ok: true, length: v.length } : { ok: false, length: all.length, message: v.message } };
}

// ---------- agents and licences ----------

export type AgentRow = {
  agentId: string;
  label: string;
  orgId: string;
  orgName: string;
  kind: AgentInfo["kind"];
  vias: Via[];
  firstAt?: string;
  lastAt?: string;
  licence: LicenceView;
  record: { requests: number; orders: number; committed: number; alone: number; signOffs: number; declined: number; refusals: number; refusalsByRule: { rule: string; title: string; count: number }[] };
  allows: { line: string; detail?: string }[];
  suspended?: { since: string; reason: string; scope: "agent" | "org" };
  expiresAt?: string;
};

function allows(m: Mandate | undefined, l: LicenceRecord | undefined): { line: string; detail?: string }[] {
  if (!m) return [{ line: "Its mandate has not been seen at this gate yet." }];
  const limit = l?.perOrderLimitCents !== undefined ? Math.min(l.perOrderLimitCents, m.perOrderLimitCents) : m.perOrderLimitCents;
  const subRule = l?.substitution === "needs_approval" && m.substitution.rule !== "none" ? "needs_approval" : m.substitution.rule;
  const subs: Record<string, string> = {
    none: "No substitutes at all.",
    same_attributes: "Like-for-like substitutes alone; others refused.",
    needs_approval: "Any substitute needs a person's sign-off.",
    within_preferences: "Like-for-like substitutes alone; others need a person's sign-off.",
  };
  const out = [
    { line: `Buys alone up to ${eur(limit)} per order.`, detail: l?.perOrderLimitCents !== undefined && l.perOrderLimitCents < m.perOrderLimitCents ? `Licence ${l.level} caps the mandate's ${eur(m.perOrderLimitCents)}.` : "Set by the kitchen's mandate." },
    { line: `Never more than ${eur(m.weeklyBudgetCents)} a week, sign-off or not.` },
    { line: subs[subRule] ?? `Substitutes: ${subRule}.`, detail: `At most ${m.substitution.maxPriceIncreasePct} % dearer per unit.` },
    { line: `Only ${m.allowedCategories.map((c) => c.replaceAll("_", " ")).join(", ")}${m.requiredAttributes.length ? `, ${m.requiredAttributes.map((a) => a.replaceAll("_", "-")).join(", ")}` : ""}.` },
    { line: `Sign-off by ${m.approvers.map((a) => `${a.name} (${roleLabel(a.role)}, up to ${eur(a.maxApprovalCents)})`).join(" or ")}.` },
  ];
  return out;
}

export async function agentsView(rt: Runtime): Promise<{ at: string; licenceSource: string; agents: AgentRow[] }> {
  const ctx = await opsContext(rt);
  const cases = refusalCases(ctx);
  const rows: AgentRow[] = [...ctx.agents.values()].map((a) => {
    const calls = ctx.door.all().filter((c) => c.agentId === a.agentId);
    const orders = ctx.orders.filter((o) => o.agentId === a.agentId);
    const requests = [...ctx.requests.values()].filter((e) => e.actor === `agent:${a.agentId}`);
    const mine = cases.filter((c) => {
      if (c.requestId) return requests.some((r) => r.requestId === c.requestId);
      return c.agentLabel === a.label || c.agentLabel === a.agentId;
    });
    const byRule = new Map<string, number>();
    for (const c of mine) byRule.set(c.rule, (byRule.get(c.rule) ?? 0) + 1);
    const lic = ctx.licence(a.agentId);
    const s = suspensionOf(ctx, a);
    return {
      agentId: a.agentId,
      label: a.label,
      orgId: a.orgId,
      orgName: a.orgName,
      kind: a.kind,
      vias: [...new Set(calls.map((c) => c.via))],
      firstAt: calls[0]?.at ?? requests[0]?.at,
      lastAt: calls.at(-1)?.at ?? requests.at(-1)?.at,
      licence: licenceView(lic),
      record: {
        requests: requests.length,
        orders: orders.length,
        committed: orders.filter((o) => o.status === "committed").length,
        alone: orders.filter((o) => o.status === "committed" && !o.approval).length,
        signOffs: orders.filter((o) => o.approval).length,
        declined: orders.filter((o) => o.status === "declined").length,
        refusals: mine.length,
        refusalsByRule: [...byRule.entries()].map(([rule, count]) => ({ rule, title: ruleTitleOf(rule), count })).sort((x, y) => y.count - x.count),
      },
      allows: allows(a.mandate, lic),
      suspended: s && { since: s.at, reason: s.reason, scope: s.scope },
      expiresAt: a.expiresAt,
    };
  });
  rows.sort((x, y) => (y.lastAt ?? "").localeCompare(x.lastAt ?? ""));
  return { at: ctx.now.toISOString(), licenceSource: licenceSource().kind, agents: rows };
}

export const GATE_RULE_COUNT = RULES.length;
export { SUSPENSION_RULE };
