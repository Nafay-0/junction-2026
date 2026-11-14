import type { Pool } from "pg";
import { checkServices } from "../health";
import type { AivenHandle } from "../index";
import { dailyUsage } from "@/server/limits";
import { aivenApi } from "./aiven-api";
import { mcpStatus, type McpStatus } from "./aiven-mcp";
import { showcaseConfig } from "./config";
import { readOnlyQuery } from "./readonly-db";
import { lag, offsetsAt, streamConfigured, type LagReport } from "./stream";

/**
 * The Aiven story in numbers, all read live: which service does which job, whether it answers and how fast, what it
 * did in the last hour, and what the project costs (plans and prices from the API, balance from the API).
 */
export type ServiceCard = {
  key: string;
  name: string;
  type: string;
  job: string;
  why: string;
  plan?: string;
  cloud?: string;
  state?: string;
  usdPerHour?: number;
  reachable: boolean | null;
  ms: number | null;
  detail: string;
  lastHour: { label: string; value: number | string | null }[];
};

export type PlatformOverview = {
  at: string;
  project?: string;
  services: ServiceCard[];
  cost: { runRateUsdPerHour: number | null; perDay: number | null; balanceUsd: number | null; creditUsd: number; creditShareUsed: number | null; projectedToSundayUsd: number | null; note: string } | null;
  mcp: McpStatus;
  stream?: LagReport;
  grafanaUrl?: string;
  notUsed: { what: string; why: string }[];
  missing: string[];
};

const JOBS: Record<string, { name: string; job: string; why: string }> = {
  "dock-app": { name: "Aiven Runtime", job: "Hosts AimoPilot: the gate, its MCP door and REST API, the portals", why: "The app sits next to its data, gets the services' credentials injected, and Managed Agents reach its MCP endpoint over public HTTPS." },
  "dock-pg": { name: "PostgreSQL", job: "System of record: orders, approvals, the hash-chained ledger, kitchen memory, telemetry", why: "Committing at a fixed price is a transaction; the ledger's hash chain is checked by constraints with pgcrypto; pgvector keeps memory next to its rows." },
  "dock-events": { name: "Kafka", job: "Every agent action and gate decision, in order (topic dock.actions)", why: "Durable and replayable per request key: the trace replays from it, and the telemetry sink is just a consumer group." },
  "dock-cache": { name: "Valkey", job: "Live-price cache, each agent's lookup budget, the event bus", why: "SET with an expiry matches 'this price is valid for N minutes'; INCR+EXPIRE is a rate budget; pub/sub fans out sign-offs." },
  "dock-search": { name: "OpenSearch", job: "Search over 17,546 products in Finnish, Swedish and English", why: "Relevance ranking and language analysers narrow to a short list in master data, so the live price API is asked only about that list." },
  "dock-grafana": { name: "Grafana", job: "The full dashboard: business numbers next to service CPU, memory, disk and app logs", why: "Reads PostgreSQL as a read-only user and the Aiven API with a read-only token; free plans allow no metrics integration." },
  "managed-agents": { name: "Managed Agents", job: "An outside purchasing agent that runs on Aiven and buys through AimoPilot's MCP door", why: "Proves the door is open: an agent AimoPilot does not run, with its own model, held to the same mandate and gate." },
  "aiven-mcp": { name: "Aiven MCP server", job: "The operations copilot's way to service state, logs and metrics", why: "Read-only token, read-only tools: staff ask about the platform without anyone holding admin credentials." },
};

const NOT_USED = [
  { what: "Aiven for Metrics (Thanos)", why: "Free-plan services cannot send metrics to it (no service integrations), so it would store nothing; making it useful means paid plans on every data service." },
  { what: "Kafka Connect (JDBC / OpenSearch sinks)", why: "Not on the free Kafka plan and a paid service of its own; the app's own consumer writes the stream into PostgreSQL instead." },
  { what: "Kafka REST (Karapace)", why: "Would let Aiven MCP read the topic directly; off on the free plan. The server reads the topic with its own client instead." },
  { what: "ClickHouse for event analytics", why: "At hackathon volumes PostgreSQL answers the same questions, and it is already there." },
  { what: "Embedded Grafana panels", why: "Embedding needs anonymous access or public dashboards, which would weaken the dashboard's login; the same queries are drawn here instead." },
];

const SUNDAY_END = Date.parse("2026-11-15T16:00:00Z");

type ApiService = { service_name: string; service_type: string; plan: string; cloud_name: string; state: string };

async function prices(token: string, project: string): Promise<(type: string, plan: string, cloud: string) => number | undefined> {
  const j = await aivenApi<{ service_types: Record<string, { service_plans: { service_plan: string; regions: Record<string, { price_usd: string }> }[] }> }>(token, "GET", `/project/${project}/service_types`, { cacheMs: 3_600_000, timeoutMs: 15_000 });
  return (type, plan, cloud) => {
    const p = j.service_types[type]?.service_plans.find((x) => x.service_plan === plan);
    const v = p?.regions[cloud]?.price_usd;
    return v === undefined ? undefined : Number(v);
  };
}

async function timedFetch(url: string): Promise<{ ok: boolean; ms: number; detail: string }> {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    return { ok: r.ok, ms: Math.round(performance.now() - t0), detail: `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - t0), detail: err instanceof Error ? err.message : String(err) };
  }
}

const num = (rows: Record<string, unknown>[] | undefined, k: string) => {
  const v = rows?.[0]?.[k];
  return v === null || v === undefined ? null : Number(v);
};

export async function platformOverview(h: AivenHandle | undefined): Promise<PlatformOverview> {
  const cfg = showcaseConfig();
  const miss: string[] = [];
  if (!cfg.readToken || !cfg.project) miss.push("AIVEN_READONLY_TOKEN and AIVEN_PROJECT (service state, plans, cost)");
  if (!cfg.copilotPgUrl) miss.push("DOCK_COPILOT_PG_URL (last-hour numbers)");

  const [health, apiServices, priceOf, project, mcp, stream, hour, ledgerRows, agentsEnv] = await Promise.all([
    checkServices(h),
    cfg.readToken && cfg.project ? aivenApi<{ services: ApiService[] }>(cfg.readToken, "GET", `/project/${cfg.project}/service`, { cacheMs: 15_000 }).then((r) => r.services).catch(() => [] as ApiService[]) : Promise.resolve([] as ApiService[]),
    cfg.readToken && cfg.project ? prices(cfg.readToken, cfg.project).catch(() => undefined) : Promise.resolve(undefined),
    cfg.readToken && cfg.project ? aivenApi<{ project: { estimated_balance?: string } }>(cfg.readToken, "GET", `/project/${cfg.project}`, { cacheMs: 60_000 }).catch(() => undefined) : Promise.resolve(undefined),
    mcpStatus(),
    streamConfigured() ? lag().catch(() => undefined) : Promise.resolve(undefined),
    readOnlyQuery(`select
  count(*) as rows_written,
  count(*) filter (where kind = 'partner_api.cache_hit') as cache_hits,
  count(*) filter (where kind = 'partner_api.call') as partner_calls,
  coalesce(sum(value) filter (where kind = 'metric.search.opensearch'), 0) as searches,
  count(*) filter (where kind = 'lookup.search') as lookups,
  count(*) filter (where kind = 'aiven_agent.run' and ok is not null) as agent_runs,
  count(*) filter (where kind not like 'metric.%' and kind <> 'infra.check' and kind <> 'usage.model' and kind <> 'aiven_agent.run') as gate_events,
  count(distinct agent_id) as agents
from telemetry.ops_events where ts > now() - interval '1 hour'`),
    h?.pool && h.schema ? (h.pool as Pool).query<{ n: string }>(`select count(*) as n from ${h.schema}.ledger where written_at > now() - interval '1 hour'`).then((r) => Number(r.rows[0].n)).catch(() => null) : Promise.resolve(null),
    cfg.readToken && cfg.organization && cfg.project
      ? (async () => {
          const t0 = performance.now();
          const r = await aivenApi<{ environments: { name: string; status: string; plan: string; cloud_name: string }[] }>(cfg.readToken!, "GET", `/organization/${cfg.organization}/project/${cfg.project}/managed-agents/environment`, { cacheMs: 0 });
          return { env: r.environments[0], ms: Math.round(performance.now() - t0) };
        })().catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  let streamHour: number | null = null;
  if (stream) {
    try {
      const at = await offsetsAt(Date.now() - 3_600_000);
      streamHour = stream.partitions.reduce((a, p) => {
        const from = at.find((x) => x.partition === p.partition)?.offset;
        return a + (from && from !== "-1" ? Math.max(0, Number(p.end) - Number(from)) : 0);
      }, 0);
    } catch {
      streamHour = null;
    }
  }
  const rows = hour.ok ? hour.rows : undefined;
  const probe = (s: "postgres" | "opensearch" | "valkey" | "kafka") => health.services.find((x) => x.service === s);
  const byName = new Map(apiServices.map((s) => [s.service_name, s]));
  const grafanaUrl = cfg.project ? `https://dock-grafana-${cfg.project}.e.aivencloud.com/d/dock-overview` : undefined;
  const [grafana, app] = await Promise.all([grafanaUrl ? timedFetch(new URL("/api/health", grafanaUrl).toString()) : undefined, timedFetch(`${cfg.dockUrl}/api/health`)]);
  const usage = dailyUsage();

  const card = (key: string, extra: Partial<ServiceCard>): ServiceCard => {
    const s = byName.get(key);
    const usd = s && priceOf ? priceOf(s.service_type, s.plan, s.cloud_name) : undefined;
    return { key, ...JOBS[key], type: s?.service_type ?? "", plan: s?.plan, cloud: s?.cloud_name, state: s?.state, usdPerHour: usd, reachable: null, ms: null, detail: "", lastHour: [], ...extra };
  };
  const fromProbe = (p: ReturnType<typeof probe>) => ({ reachable: p?.reachable ?? null, ms: p?.ms ?? null, detail: p?.detail ?? "not configured" });

  const services: ServiceCard[] = [
    card("dock-app", { reachable: app.ok, ms: app.ms, detail: `${cfg.dockUrl.replace(/^https?:\/\//, "")} · ${app.detail}`, lastHour: [{ label: "gate events", value: num(rows, "gate_events") }, { label: "agents at the door", value: num(rows, "agents") }, { label: "model spend today", value: `$${usage.llm.usd.toFixed(3)}` }] }),
    card("dock-pg", { ...fromProbe(probe("postgres")), lastHour: [{ label: "telemetry rows written", value: num(rows, "rows_written") }, { label: "ledger entries written", value: ledgerRows }] }),
    card("dock-events", { ...fromProbe(probe("kafka")), lastHour: [{ label: "events through the stream", value: streamHour }, { label: "consumer lag now", value: stream?.totalLag ?? null }] }),
    card("dock-cache", { ...fromProbe(probe("valkey")), lastHour: [{ label: "live prices from cache", value: num(rows, "cache_hits") }, { label: "partner API calls", value: num(rows, "partner_calls") }] }),
    card("dock-search", { ...fromProbe(probe("opensearch")), lastHour: [{ label: "searches served", value: num(rows, "searches") }, { label: "master-data lookups", value: num(rows, "lookups") }] }),
    card("dock-grafana", { reachable: grafana?.ok ?? null, ms: grafana?.ms ?? null, detail: grafana ? `/api/health · ${grafana.detail}` : "not configured", lastHour: [] }),
    {
      key: "managed-agents",
      ...JOBS["managed-agents"],
      type: "managed agents",
      plan: agentsEnv?.env?.plan,
      cloud: agentsEnv?.env?.cloud_name,
      state: agentsEnv?.env?.status?.toUpperCase(),
      usdPerHour: 0,
      reachable: agentsEnv ? agentsEnv.env?.status === "running" : null,
      ms: agentsEnv?.ms ?? null,
      detail: agentsEnv?.env ? `environment ${agentsEnv.env.name}, run by Aiven, free tier` : "not configured",
      lastHour: [{ label: "runs started from this portal", value: num(rows, "agent_runs") }],
    },
    { key: "aiven-mcp", ...JOBS["aiven-mcp"], type: "mcp", usdPerHour: 0, reachable: mcp.reachable, ms: null, detail: mcp.orgEnabled === false ? "switched off for the organisation" : mcp.reachable ? `${mcp.tools} tools with the read-only token` : "not answering", state: mcp.orgEnabled ? "ALLOWED" : mcp.orgEnabled === false ? "OFF" : undefined, lastHour: [] },
  ];

  const billed = apiServices.map((s) => (priceOf ? priceOf(s.service_type, s.plan, s.cloud_name) : undefined));
  const runRate = priceOf && apiServices.length ? billed.reduce<number>((a, v) => a + (v ?? 0), 0) : null;
  const balance = project?.project.estimated_balance !== undefined ? Number(project.project.estimated_balance) : null;
  const hoursLeft = Math.max(0, (SUNDAY_END - Date.now()) / 3_600_000);
  return {
    at: new Date().toISOString(),
    project: cfg.project ? "<project>" : undefined,
    services,
    cost: cfg.readToken
      ? {
          runRateUsdPerHour: runRate,
          perDay: runRate === null ? null : runRate * 24,
          balanceUsd: balance,
          creditUsd: cfg.creditUsd,
          creditShareUsed: balance === null ? null : balance / cfg.creditUsd,
          projectedToSundayUsd: balance === null || runRate === null ? null : balance + runRate * hoursLeft,
          note: "Run rate: the API's hourly price of each service's plan in its region. Used so far: the project's estimated balance this month, which the $50 trial credit covers. Free-plan services and Managed Agents cost nothing.",
        }
      : null,
    mcp,
    stream,
    grafanaUrl,
    notUsed: NOT_USED,
    missing: miss,
  };
}
