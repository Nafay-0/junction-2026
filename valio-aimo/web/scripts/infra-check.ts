/**
 * pnpm infra:check
 *
 * One harmless round trip to each Aiven service configured in the environment (web/.env.local is
 * loaded if present), one line per service: PASS, FAIL or "not configured". Never prints a secret:
 * every message is scrubbed of the configured passwords, keys and URL credentials before printing.
 *
 *   postgres    DATABASE_URL                          select version(), max_connections, extensions
 *   opensearch  OPENSEARCH_URL                        cluster health
 *   valkey      VALKEY_URL                            SET with a 30 s expiry, GET, DEL
 *   kafka       KAFKA_BOOTSTRAP_SERVERS + KAFKA_*      cluster metadata (brokers, topics)
 *   aiven-api   AIVEN_API_TOKEN + AIVEN_PROJECT        list services and their state and plan
 *
 * Exits 1 if any configured service fails; unconfigured services do not fail the run.
 * With --record, also writes one telemetry.events row per service (the Grafana "Latest infra:check" table).
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client as PgClient } from "pg";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import Valkey from "iovalkey";
import { Kafka, logLevel } from "kafkajs";

// kafkajs schedules a negative timeout on newer Node versions; the warning is noise here.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "TimeoutNegativeWarning") console.warn(`${w.name}: ${w.message}`);
});

const envFile = resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const TIMEOUT_MS = 15_000;

type Result = { status: "PASS" | "FAIL" | "not configured"; detail: string };
type Check = { name: string; run: () => Promise<Result> };

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};
/** PEM values may arrive with literal "\n" (one-line .env) or real newlines (Aiven Runtime). */
const pem = (k: string) => env(k)?.replace(/\\n/g, "\n");

/** Every secret-looking value we know of, so error text can be scrubbed before printing. */
function secrets(): string[] {
  const out: string[] = [];
  for (const k of ["DATABASE_URL", "OPENSEARCH_URL", "VALKEY_URL"]) {
    const v = env(k);
    if (!v) continue;
    out.push(v);
    try {
      const u = new URL(v);
      if (u.password) out.push(u.password, decodeURIComponent(u.password));
    } catch {
      /* not a URL */
    }
  }
  for (const k of ["KAFKA_ACCESS_KEY", "KAFKA_ACCESS_CERT", "AIVEN_API_TOKEN"]) {
    const v = env(k);
    if (v) out.push(v, v.replace(/\\n/g, "\n"));
  }
  return out.filter((s) => s.length >= 6).sort((a, b) => b.length - a.length);
}

function scrub(text: string): string {
  let t = text;
  for (const s of secrets()) t = t.split(s).join("***");
  return t
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, "//***:***@")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "***")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`${label}: timed out after ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS);
    p.then(
      (v) => (clearTimeout(t), ok(v)),
      (e) => (clearTimeout(t), fail(e)),
    );
  });
}

const notConfigured = (keys: string): Result => ({ status: "not configured", detail: `set ${keys}` });

const checks: Check[] = [
  {
    name: "postgres",
    async run() {
      const raw = env("DATABASE_URL");
      if (!raw) return notConfigured("DATABASE_URL");
      // Aiven URIs carry sslmode=require. node-postgres reads that as verify-full unless libpq
      // compatibility is on; with it, the connection is encrypted (the Aiven Runtime docs do the same).
      const url = new URL(raw);
      if (!url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
      const client = new PgClient({ connectionString: url.toString(), connectionTimeoutMillis: TIMEOUT_MS });
      try {
        await client.connect();
        const { rows } = await client.query<{ version: string; max: string; ext: string | null }>(
          `select current_setting('server_version') as version,
                  current_setting('max_connections') as max,
                  (select string_agg(extname, ',' order by extname) from pg_extension
                    where extname <> 'plpgsql') as ext`,
        );
        const r = rows[0];
        return {
          status: "PASS",
          detail: `PostgreSQL ${r.version} · max_connections ${r.max} · extensions: ${r.ext ?? "none"}`,
        };
      } finally {
        await client.end().catch(() => {});
      }
    },
  },
  {
    name: "opensearch",
    async run() {
      const raw = env("OPENSEARCH_URL");
      if (!raw) return notConfigured("OPENSEARCH_URL");
      const client = new OpenSearchClient({ node: raw, requestTimeout: TIMEOUT_MS });
      try {
        const [health, info] = await Promise.all([client.cluster.health(), client.info()]);
        const indices = await client.cat.indices({ format: "json" });
        const userIndices = (indices.body as Array<{ index?: string }>).filter(
          (i) => i.index && !i.index.startsWith("."),
        ).length;
        return {
          status: health.body.status === "red" ? "FAIL" : "PASS",
          detail: `OpenSearch ${info.body.version.number} · cluster ${health.body.status} · ${health.body.number_of_nodes} node(s) · ${userIndices} index(es)`,
        };
      } finally {
        await client.close().catch(() => {});
      }
    },
  },
  {
    name: "valkey",
    async run() {
      const raw = env("VALKEY_URL");
      if (!raw) return notConfigured("VALKEY_URL");
      const client = new Valkey(raw, {
        lazyConnect: true,
        connectTimeout: TIMEOUT_MS,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      client.on("error", () => {}); // reported through the awaited calls below
      try {
        await client.connect();
        const key = `dock:infra-check:${randomUUID()}`;
        await client.set(key, "ok", "EX", 30);
        const got = await client.get(key);
        await client.del(key);
        const info = await client.info("server");
        const version = /valkey_version:(\S+)/.exec(info)?.[1] ?? /redis_version:(\S+)/.exec(info)?.[1] ?? "?";
        const mem = await client.info("memory");
        const policy = /maxmemory_policy:(\S+)/.exec(mem)?.[1] ?? "?";
        return got === "ok"
          ? { status: "PASS", detail: `Valkey ${version} · set/get/del ok · maxmemory_policy ${policy}` }
          : { status: "FAIL", detail: `read back ${JSON.stringify(got)} instead of "ok"` };
      } finally {
        client.disconnect();
      }
    },
  },
  {
    name: "kafka",
    async run() {
      const brokers = env("KAFKA_BOOTSTRAP_SERVERS");
      if (!brokers) return notConfigured("KAFKA_BOOTSTRAP_SERVERS, KAFKA_ACCESS_KEY, KAFKA_ACCESS_CERT, KAFKA_CA_CERT");
      const key = pem("KAFKA_ACCESS_KEY");
      const cert = pem("KAFKA_ACCESS_CERT");
      const ca = pem("KAFKA_CA_CERT");
      if (!key || !cert || !ca) return notConfigured("KAFKA_ACCESS_KEY, KAFKA_ACCESS_CERT, KAFKA_CA_CERT");
      const kafka = new Kafka({
        clientId: "dock-infra-check",
        brokers: brokers.split(",").map((b) => b.trim()),
        ssl: { ca: [ca], cert, key, rejectUnauthorized: true },
        connectionTimeout: TIMEOUT_MS,
        requestTimeout: TIMEOUT_MS,
        retry: { retries: 1 },
        logLevel: logLevel.NOTHING,
      });
      const admin = kafka.admin();
      try {
        await admin.connect();
        const cluster = await admin.describeCluster();
        const topics = (await admin.listTopics()).filter((t) => !t.startsWith("_"));
        return {
          status: "PASS",
          detail: `${cluster.brokers.length} broker(s) · controller ${cluster.controller ?? "?"} · ${topics.length} topic(s)${topics.length ? `: ${topics.join(", ")}` : ""}`,
        };
      } finally {
        await admin.disconnect().catch(() => {});
      }
    },
  },
  {
    name: "aiven-api",
    async run() {
      const token = env("AIVEN_API_TOKEN");
      const project = env("AIVEN_PROJECT");
      if (!token || !project) return notConfigured("AIVEN_API_TOKEN, AIVEN_PROJECT");
      const res = await fetch(`https://api.aiven.io/v1/project/${encodeURIComponent(project)}/service`, {
        headers: { Authorization: `aivenv1 ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { status: "FAIL", detail: `HTTP ${res.status}` };
      const body = (await res.json()) as {
        services: Array<{ service_name: string; state: string; plan: string }>;
      };
      const list = body.services
        .map((s) => `${s.service_name} ${s.state.toLowerCase()} (${s.plan})`)
        .sort()
        .join(", ");
      const allRunning = body.services.every((s) => s.state === "RUNNING");
      return { status: allRunning ? "PASS" : "FAIL", detail: `${body.services.length} services: ${list}` };
    },
  },
];

async function main() {
  const started = Date.now();
  const results = await Promise.all(
    checks.map(async (c) => {
      const t0 = Date.now();
      try {
        const r = await withTimeout(c.run(), c.name);
        return { name: c.name, ...r, ms: Date.now() - t0 };
      } catch (e) {
        const msg = e instanceof Error ? `${e.name === "Error" ? "" : `${e.name}: `}${e.message}` : String(e);
        return { name: c.name, status: "FAIL" as const, detail: scrub(msg), ms: Date.now() - t0 };
      }
    }),
  );
  for (const r of results) {
    const timing = r.status === "not configured" ? "" : ` (${r.ms} ms)`;
    console.log(`${r.status.padEnd(14)} ${r.name.padEnd(10)} ${scrub(r.detail)}${timing}`);
  }
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${failed ? `${failed} failed` : "all configured services passed"} in ${Date.now() - started} ms`);
  if (process.argv.includes("--record")) await record(results);
  process.exit(failed ? 1 : 0);
}

/** --record: one telemetry.events row per configured service (see infra/telemetry.sql), for Grafana. */
async function record(results: Array<{ name: string; status: Result["status"]; detail: string; ms: number }>) {
  const raw = env("DATABASE_URL");
  if (!raw) return console.log("record: DATABASE_URL not set, nothing recorded");
  const url = new URL(raw);
  if (!url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
  const client = new PgClient({ connectionString: url.toString(), connectionTimeoutMillis: TIMEOUT_MS });
  try {
    await client.connect();
    const rows = results.filter((r) => r.status !== "not configured");
    for (const r of rows) {
      await client.query(
        `insert into telemetry.events (source, kind, rule, value, ok, attrs) values ('infra-check', 'infra.check', $1, $2, $3, $4)`,
        [r.name, r.ms, r.status === "PASS", { detail: scrub(r.detail) }],
      );
    }
    console.log(`record: ${rows.length} rows written to telemetry.events`);
  } catch (e) {
    console.log(`record: failed (${scrub(e instanceof Error ? e.message : String(e))})`);
  } finally {
    await client.end().catch(() => {});
  }
}

void main();
