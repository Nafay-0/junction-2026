import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import type { Pool } from "pg";
import type { AivenHandle } from "./index";
import { aivenSwitches, errMessage, kafkaConfig, pgConnectionString, valkeyUrl } from "./env";
import { kafkaClient } from "./kafka";
import { metrics } from "./metrics";
import { createPool } from "./pg/pool";
import { valkeyClient } from "./valkey";

export type ServiceName = "postgres" | "opensearch" | "valkey" | "kafka";
export type ServiceHealth = {
  service: ServiceName;
  /** Its address is in the environment. */
  configured: boolean;
  /** An adapter of this process uses it. */
  inUse: boolean;
  /** null when not configured. */
  reachable: boolean | null;
  ms: number | null;
  detail: string;
};
export type HealthReport = {
  /** Every service an adapter uses answered. */
  ok: boolean;
  at: string;
  switches: ReturnType<typeof aivenSwitches> | { error: string };
  services: ServiceHealth[];
  counters: Record<string, number>;
  ledger?: ReturnType<NonNullable<AivenHandle["ledger"]>["status"]>;
  actions?: Record<string, number | string | boolean>;
  sink?: Record<string, number | string | boolean>;
  search?: Record<string, unknown>;
  /** Smart search's recall: which backend answers first, how often each answered, fallbacks (server/search/recall-router.ts). */
  recall?: Record<string, unknown>;
};

const TIMEOUT_MS = 3_000;

function deadline<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise<T>((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`no answer within ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), ok(v)),
      (e) => (clearTimeout(t), fail(e)),
    );
  });
}

async function timed(service: ServiceName, configured: boolean, inUse: boolean, run: () => Promise<string>): Promise<ServiceHealth> {
  if (!configured) return { service, configured, inUse, reachable: null, ms: null, detail: "not configured" };
  const t0 = performance.now();
  try {
    const detail = await deadline(run());
    return { service, configured, inUse, reachable: true, ms: Math.round(performance.now() - t0), detail };
  } catch (err) {
    return { service, configured, inUse, reachable: false, ms: Math.round(performance.now() - t0), detail: errMessage(err) };
  }
}

/**
 * One cheap round trip to each configured Aiven service, timed: reachable or not, and how long it took. Reuses
 * the adapters' own clients when they are on (so it measures what the app really uses), else opens a short-lived
 * client. Results are cached for 5 s, so a health route polled every second costs one check per 5 s.
 */
export async function checkServices(h?: AivenHandle): Promise<HealthReport> {
  const now = Date.now();
  if (cache && now - cache.at < 5_000 && cache.handle === h) return cache.report;
  const report = await runChecks(h);
  cache = { at: now, handle: h, report };
  return report;
}
let cache: { at: number; handle?: AivenHandle; report: HealthReport } | undefined;

async function runChecks(h?: AivenHandle): Promise<HealthReport> {
  let switches: HealthReport["switches"];
  try {
    switches = h?.switches ?? aivenSwitches();
  } catch (err) {
    switches = { error: errMessage(err) };
  }
  const sw = "error" in switches ? undefined : switches;
  const services = await Promise.all([
    timed("postgres", Boolean(pgConnectionString()), Boolean(h?.pool), async () => {
      const own = !h?.pool;
      const pool: Pool = h?.pool ?? createPool(undefined, 1);
      try {
        const r = await pool.query<{ v: string; n: string }>(`select current_setting('server_version') as v, (select count(*) from pg_stat_activity where datname = current_database()) as n`);
        return `PostgreSQL ${r.rows[0].v}, ${r.rows[0].n} connections open on this database (plan limit 20)`;
      } finally {
        if (own) await pool.end().catch(() => undefined);
      }
    }),
    timed("opensearch", Boolean(process.env.OPENSEARCH_URL?.trim()), Boolean(h?.search), async () => {
      if (h?.search) {
        const r = await h.search.health();
        if (!r.ok) throw new Error(r.detail);
        return r.detail;
      }
      const client = new OpenSearchClient({ node: process.env.OPENSEARCH_URL!.trim(), requestTimeout: TIMEOUT_MS, maxRetries: 0 });
      try {
        const r = await client.cluster.health();
        if (r.body.status === "red") throw new Error("cluster red");
        return `cluster ${r.body.status}`;
      } finally {
        await client.close().catch(() => undefined);
      }
    }),
    timed("valkey", Boolean(valkeyUrl()), Boolean(h?.valkey), async () => {
      const client = h?.valkey ?? valkeyClient(valkeyUrl()!, "dock-health");
      try {
        const pong = await client.ping();
        return `PING ${pong}`;
      } finally {
        if (!h?.valkey) client.disconnect();
      }
    }),
    timed("kafka", Boolean(kafkaConfig()), Boolean(h?.kafka), async () => {
      const admin = (h?.kafka ?? kafkaClient(kafkaConfig()!, "dock-health")).admin();
      await admin.connect();
      try {
        const c = await admin.describeCluster();
        return `${c.brokers.length} broker(s)`;
      } finally {
        await admin.disconnect().catch(() => undefined);
      }
    }),
  ]);
  const ok = services.every((s) => !s.inUse || s.reachable === true) && !h?.ledger?.status().diverged;
  return {
    ok,
    at: new Date().toISOString(),
    switches,
    services,
    counters: metrics.snapshot(),
    ledger: h?.ledger?.status(),
    actions: sw && sw.actions !== "off" ? h?.actions.stats() : undefined,
    sink: h?.sink?.stats(),
    search: h?.routed ? { ...h.routed.routingStats() } : undefined,
    recall: await import("@/server/search/service").then((m) => m.recallStats()).catch(() => undefined),
  };
}

const g = globalThis as typeof globalThis & { __dockAivenHandles?: Set<AivenHandle> };

/** For the health route: the running app's adapters if they are up, otherwise a check of whatever is configured. */
export async function aivenHealth(): Promise<HealthReport> {
  const h = [...(g.__dockAivenHandles ?? [])][0];
  return checkServices(h);
}
