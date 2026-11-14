/* eslint-disable @typescript-eslint/no-explicit-any -- test harness: replies are untyped JSON. */
/**
 * Dependency 3: the Aiven services, one at a time, with the app's adapters on. The app's DNS for the one service
 * under test is mapped to 127.0.0.1 by dns-preload.cjs, where fault-proxy.ts forwards to the real service; the
 * proxy then refuses, resets or blackholes connections, and forwards again. Needs web/.env.local through the
 * runner's environment (`tsx --env-file=.env.local`); skips cleanly when the variables are absent.
 *
 * Safety (see README): PostgreSQL schema dock_testinfra only (created by the app on start, dropped at the end only
 * if this run created it), pool of 2, one server on PostgreSQL at a time; telemetry.events inserts dropped in the
 * app process by the preload; Kafka on its own topic dock.actions.testinfra with the sink off; Valkey as cache only
 * (DOCK_BUS=memory, the shared event channel is never used) on the seed catalogue, with the live-lookup allowance
 * namespaced by the schema name; OpenSearch read-only search.
 */
import path from "node:path";
import { Pool } from "pg";
import { startFakePartner } from "../fake-partner";
import { FaultProxy, type FaultMode } from "../fault-proxy";
import { missingVars, portFree, reachability, resolveTargets, targets, type ServiceName } from "../lib/aiven-targets";
import { approverSees, orderAudit, visitorCycle, type Cycle } from "../lib/cycle";
import { approverFlow, deliveryDay, driveIntake, secondsUntil } from "../lib/flow";
import { consoleCall, Http, isVisitor, joinAsVisitor, passkeyDecide, type Visitor } from "../lib/http";
import type { Results } from "../lib/results";
import { LOGS, sleep, startDock, WEB, type Dock } from "../lib/server";

export type AivenService = Exclude<ServiceName, never>;

// Ports and schema can be moved for a second engineer on the same machine (DEPS_APP_PORT, DEPS_PROXY_PORT,
// DEPS_PG_SCHEMA). With DEPS_PROXY_PORT the proxy listens there and the preload rewrites the app's connections to
// the service's host:port onto it (DEPS_CONNECT_MAP), instead of listening on the service's own port.
const APP_PORT = Number(process.env.DEPS_APP_PORT || 4633);
const PROXY_PORT = process.env.DEPS_PROXY_PORT ? Number(process.env.DEPS_PROXY_PORT) : undefined;
const PARTNER_PORT = 4693;
const PARTNER_CONTROL = 4694;
/** The only schemas this harness ever creates or drops. */
const TEST_SCHEMAS = ["dock_testinfra", "dock_limits"] as const;
export const TEST_SCHEMA = process.env.DEPS_PG_SCHEMA || "dock_testinfra";
if (!(TEST_SCHEMAS as readonly string[]).includes(TEST_SCHEMA)) throw new Error(`DEPS_PG_SCHEMA must be one of ${TEST_SCHEMAS.join(", ")}`);
const TEST_TOPIC = "dock.actions.testinfra";
const OUTAGE_PROBE_TIMEOUT_MS = 45_000;

const pass = (...names: string[]) => Object.fromEntries(names.filter((n) => process.env[n]).map((n) => [n, process.env[n]!]));

// ---------- the schema: created by this run or not ----------

let schemaExistedBefore: boolean | undefined;

async function withPool<T>(fn: (p: Pool) => Promise<T>): Promise<T> {
  const raw = process.env.DATABASE_URL!.trim();
  const url = new URL(raw);
  if (!url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 8_000, statement_timeout: 10_000 });
  pool.on("error", () => undefined);
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function noteSchemaBefore(): Promise<void> {
  if (schemaExistedBefore !== undefined) return;
  schemaExistedBefore = await withPool(async (p) => (await p.query("select 1 from information_schema.schemata where schema_name = $1", [TEST_SCHEMA])).rowCount! > 0);
}

/** Drop the test schema, only if this run created it. Never any schema outside TEST_SCHEMAS. */
export async function dropTestSchemaIfCreated(results: Results): Promise<void> {
  if (schemaExistedBefore !== false || !process.env.DATABASE_URL) return;
  if (!(TEST_SCHEMAS as readonly string[]).includes(TEST_SCHEMA)) throw new Error(`refusing to drop a schema other than ${TEST_SCHEMAS.join(", ")}`);
  await withPool((p) => p.query(`drop schema if exists ${TEST_SCHEMA} cascade`));
  results.note(`aiven: dropped schema ${TEST_SCHEMA} (created by this run)`);
}

// ---------- probes ----------

type Probe = { health: { ms: number; ok?: boolean; reachable?: boolean | null; ledger?: any; actions?: any; search?: any; counters?: any }; join?: { ok: boolean; ms: number; error?: string }; cycle?: Cycle; signPending?: ReturnType<typeof approverSees>; wall?: { status: number; ms: number }; search?: { status: number; ms: number; n: number } };

async function health(http: Http, service: AivenService) {
  const r = await http.get("/api/health");
  const name = { pg: "postgres", valkey: "valkey", kafka: "kafka", opensearch: "opensearch" }[service];
  const s = (r.body?.dataPlane?.services ?? []).find((x: any) => x.service === name);
  return { ms: r.ms, ok: r.body?.dataPlane?.ok, reachable: s?.reachable ?? null, ledger: r.body?.dataPlane?.ledger, actions: r.body?.dataPlane?.actions, search: r.body?.dataPlane?.search, counters: r.body?.dataPlane?.counters };
}

async function catalogSearch(v: Visitor) {
  const r = await v.http.get(`/ui-api/kitchens/${v.sandboxId}/catalog?q=${encodeURIComponent(`lactose-free milk ${Math.random().toString(36).slice(2, 5)}`)}`);
  return { status: r.status, ms: r.ms, n: (r.body?.products ?? r.body?.items ?? []).length };
}

export async function aivenScenario(results: Results, service: AivenService): Promise<void> {
  const missing = missingVars(service);
  if (missing.length) return results.skip(service, `needs ${missing.join(", ")} (run with tsx --env-file=.env.local)`);
  const reach = await reachability(service);
  if (!reach.ok) return results.skip(service, `the service does not answer from this machine (${reach.error}); powered off or unreachable`);
  const [target] = await resolveTargets(targets(service).slice(0, 1));
  if (targets(service).length > 1) results.note(`${service}: ${targets(service).length} bootstrap addresses; only the first is proxied`);
  const listenPort = PROXY_PORT ?? target.port;
  if (!(await portFree(listenPort))) return results.skip(service, "the proxy's port is in use on 127.0.0.1, so the proxy cannot listen there");
  if (service === "pg" || service === "kafka") await noteSchemaBefore();

  // Kafka: the bootstrap address hands out the brokers as IP addresses on the same port; each gets a proxy of its
  // own on 4695+ and the preload rewrites connections to those addresses (DNS never sees them)
  const brokers = service === "kafka" ? await kafkaBrokerHosts().catch(() => [] as string[]) : [];
  const brokerProxies = brokers.map((ip, i) => ({ key: `${ip}:${target.port}`, proxy: new FaultProxy(4695 + i, ip, target.port) }));
  if (service === "kafka") results.note(`kafka: ${brokers.length} advertised broker address(es) besides the bootstrap host, each behind its own proxy`);
  const proxy = new FaultProxy(listenPort, target.ip!, target.port);
  for (const b of brokerProxies) await b.proxy.start();
  const setAll = async (m: FaultMode) => {
    await proxy.setMode(m);
    for (const b of brokerProxies) await b.proxy.setMode(m);
  };
  await proxy.start();
  const preloadLog = path.join(LOGS, `preload-${service}.log`);
  const common = {
    NODE_OPTIONS: `--require ${path.join(WEB, "tests-live/deps/dns-preload.cjs")}`,
    DEPS_DNS_MAP: JSON.stringify(PROXY_PORT ? {} : { [target.host]: "127.0.0.1" }),
    DEPS_CONNECT_MAP: JSON.stringify({
      ...Object.fromEntries(brokerProxies.map((b, i) => [b.key, 4695 + i])),
      ...(PROXY_PORT ? { [`${target.host}:${target.port}`]: PROXY_PORT } : {}),
    }),
    DEPS_DROP_TELEMETRY: "1",
    DEPS_PRELOAD_LOG: preloadLog,
    DOCK_PG_SCHEMA: TEST_SCHEMA,
    DOCK_PG_POOL_MAX: "2",
    DOCK_BUS: "memory",
    DOCK_STORE: "memory",
    DOCK_ACTIONS: "off",
    DOCK_CACHE: "memory",
    DOCK_SEARCH: "in-process",
  };
  const perService: Record<AivenService, Record<string, string>> = {
    pg: { ...pass("DATABASE_URL"), DOCK_STORE: "postgres" },
    valkey: { ...pass("VALKEY_URL"), DOCK_CACHE: "valkey" },
    kafka: { ...pass("DATABASE_URL", "KAFKA_BOOTSTRAP_SERVERS", "KAFKA_ACCESS_KEY", "KAFKA_ACCESS_CERT", "KAFKA_CA_CERT", "KAFKA_SECURITY_PROTOCOL"), DOCK_ACTIONS: "kafka", DOCK_KAFKA_SINK: "0", DOCK_ACTIONS_TOPIC: TEST_TOPIC },
    opensearch: { ...pass("OPENSEARCH_URL"), DOCK_SEARCH: "opensearch", DOCK_CATALOG: "", VALIO_API_BASE: `http://127.0.0.1:${PARTNER_PORT}`, VALIO_API_KEY: "fake-key-for-tests", VALIO_INDEX_PATH: path.join(WEB, ".data/valio/catalog-index.json.gz") },
  };
  const partner = service === "opensearch" ? await startFakePartner(PARTNER_PORT, PARTNER_CONTROL) : undefined;
  let dock: Dock | undefined;
  try {
    dock = await startDock(`aiven-${service}`, APP_PORT, { ...common, ...perService[service] }, { readyTimeoutMs: 120_000 });
    const http = new Http(dock.base);
    const outageHttp = new Http(dock.base, {}, http.log, OUTAGE_PROBE_TIMEOUT_MS);
    const h0 = await health(http, service);
    if (h0.reachable !== true) results.note(`${service}: through the proxy the app reports reachable=${h0.reachable} before any fault`);
    const join = async (h: Http) => joinAsVisitor(h);
    const v0 = await join(http);
    if (!isVisitor(v0)) throw new Error(`baseline join failed: ${v0.error}`);
    const base = await visitorCycle(v0);
    const kafkaSent0 = h0.actions?.sent;
    results.add({
      dependency: service,
      mode: "up (baseline, through the proxy)",
      buyer: base.buyer,
      approver: approverSees(base.approver),
      refusalHeld: base.refusalHeld && base.refusals.length > 0 && base.refusals.every((r) => r.refused),
      lostOrDuplicated: (await orderAudit(v0, base.orderId ? [base.orderId] : [])).lostOrDup,
      recoveryS: null,
      evidence: { health: h0, states: base.trace.states, ms: base.ms },
    });

    const modes: FaultMode[] = service === "pg" ? ["refuse", "blackhole", "reset"] : ["refuse", "blackhole"];
    for (const mode of modes) {
      console.log(`${service}: ${mode}`);
      // an order waiting for sign-off before the outage
      const pending = await visitorCycle(v0, { approve: false });
      const visitorV0 = consoleCall(v0.http, v0.sandboxId);
      const before = await health(http, service);
      await setAll(mode);
      const t0 = Date.now();
      await sleep(1_000);
      const outV0: Visitor = { ...v0, http: new Http(dock.base, { cookie: v0.cookie }, http.log, OUTAGE_PROBE_TIMEOUT_MS) };
      const p: Probe = { health: await health(outageHttp, service) };
      const [joinR, cycle, sign, wall, search] = await Promise.all([
        join(outageHttp).then((j) => (isVisitor(j) ? { ok: true, ms: 0 } : { ok: false, ms: j.ms, error: j.error })),
        visitorCycle(outV0),
        pending.approvalId ? approverFlow(outV0, pending.approvalId, "approve", passkeyDecide) : Promise.resolve(undefined),
        outageHttp.get("/ui-api/wall").then((r) => ({ status: r.status, ms: r.ms })),
        catalogSearch(outV0),
      ]);
      Object.assign(p, { join: joinR, cycle, wall, search });
      // Kafka: give the producer time to try (linger 250 ms, request timeout 15 s), then look, and stay down a while
      if (service === "kafka") await sleep(4_000);
      const kafkaDuring = service === "kafka" ? await health(outageHttp, service) : undefined;
      const held = Date.now() - t0;
      if (held < 20_000) await sleep(20_000 - held); // every outage lasts at least 20 s
      const outageS = Math.round((Date.now() - t0) / 1000);
      await setAll("forward");
      // recovery: the first good end-to-end answer that needs the service
      let recoveryS: number | null;
      if (service === "pg") {
        recoveryS = await secondsUntil(async () => {
          const j = await joinAsVisitor(http);
          return isVisitor(j);
        }, 120_000, 500);
      } else if (service === "kafka") {
        recoveryS = await secondsUntil(async () => {
          const h = await health(http, service);
          return h.actions && Number(h.actions.pending) === 0 && !h.actions.lastError;
        }, 120_000, 1_000);
      } else if (service === "valkey") {
        recoveryS = await secondsUntil(async () => {
          const e0 = Number((await health(http, service)).counters?.["cache.error"] ?? 0);
          const t = await driveIntake(consoleCall(v0.http, v0.sandboxId), { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 120 + Math.floor(Math.random() * 50), unit: "L" }, deliverBy: deliveryDay(3) }, { placeOrder: false });
          const e1 = Number((await health(http, service)).counters?.["cache.error"] ?? 0);
          return t.states.includes("options_ready") && e1 === e0;
        }, 120_000, 1_000);
      } else {
        recoveryS = await secondsUntil(async () => {
          const before = (await health(http, service)).search?.opensearch ?? 0;
          await driveIntake(consoleCall(v0.http, v0.sandboxId), { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 100 + Math.floor(Math.random() * 50), unit: "L" }, deliverBy: deliveryDay(3) }, { placeOrder: false, maxSteps: 1 });
          await sleep(5_200); // the data-plane report is cached for 5 s
          const after = (await health(http, service)).search?.opensearch ?? 0;
          return after > before;
        }, 120_000, 1_000);
      }
      const after = await health(http, service);
      // anything lost or duplicated: every order this visitor placed, in its ledger, once
      const ids = [base.orderId, pending.orderId, cycle.orderId].filter(Boolean) as string[];
      const statuses = await Promise.all(ids.map(async (id) => `${id.slice(-4)}:${(await visitorV0("GET", `/api/v1/orders/${id}`)).body?.order?.status ?? "?"}`));
      const audit = await orderAudit(v0, ids);
      const signAfter = pending.approvalId && sign?.orderStatus !== "committed" ? await approverFlow(v0, pending.approvalId, "approve", passkeyDecide) : undefined;
      const ledgerNote = service === "pg" ? `; ledger pending ${after.ledger?.pending ?? "?"}, diverged ${after.ledger?.diverged ?? "null"}` : "";
      const kafkaNote = service === "kafka" ? `; events sent ${kafkaSent0} -> ${after.actions?.sent}, pending during outage ${kafkaDuring?.actions?.pending}, lastError during "${String(kafkaDuring?.actions?.lastError ?? "").slice(0, 60)}"` : "";
      const searchNote = service === "opensearch" ? `; search routing ${JSON.stringify({ os: after.search?.opensearch, fb: after.search?.fallback })}` : "";
      results.add({
        dependency: service,
        mode: `${mode} for ~${outageS} s`,
        buyer: `health ${p.health.ms} ms (reachable=${p.health.reachable}); join ${joinR.ok ? "ok" : `failed ${joinR.error} in ${(joinR.ms / 1000).toFixed(1)} s`}; order ${cycle.buyer} in ${(cycle.ms / 1000).toFixed(1)} s (${cycle.trace.states.join(">")}); catalogue search ${search.status} in ${(search.ms / 1000).toFixed(1)} s; wall ${wall.status} in ${(wall.ms / 1000).toFixed(1)} s${kafkaNote}${searchNote}`,
        approver: `during: ${approverSees(sign)}${cycle.approver ? `; new order: ${approverSees(cycle.approver)}` : ""}${signAfter ? `; retried after: ${approverSees(signAfter)}` : ""}`,
        refusalHeld: cycle.refusalHeld && cycle.refusals.every((r) => r.refused),
        lostOrDuplicated: `${audit.ledgerOk === false ? "LEDGER DOES NOT VERIFY; " : ""}${audit.lostOrDup}${ledgerNote}; orders ${statuses.join(", ")}`,
        recoveryS,
        evidence: { before, during: p.health, after, join: joinR, cycle: { states: cycle.trace.states, ms: cycle.ms, refusals: cycle.refusals, orderStatus: cycle.orderStatus, err: cycle.trace.firstError }, sign, signAfter, wall, search, audit, proxy: { ...proxy.stats } },
      });
    }

    if (service === "pg") {
      // ---- restart on the same schema: is what the store holds what the app showed? ----
      console.log("pg: restart on the same schema");
      const call = consoleCall(v0.http, v0.sandboxId);
      const ledgerBefore = await call("GET", "/api/v1/ledger");
      const hBefore = await health(http, service);
      await dock.stop();
      dock = await startDock(`aiven-pg-restart`, APP_PORT, { ...common, ...perService.pg }, { readyTimeoutMs: 120_000 });
      const http2 = new Http(dock.base);
      const v1: Visitor = { ...v0, http: http2.with({ cookie: v0.cookie }) };
      const ledgerAfter = await consoleCall(v1.http, v1.sandboxId)("GET", "/api/v1/ledger");
      const h2 = await health(http2, service);
      const ids = [...new Set((ledgerBefore.body?.entries ?? []).map((e: any) => e.orderId).filter(Boolean))] as string[];
      const diff: string[] = [];
      for (const id of ids) {
        const a = (ledgerBefore.body?.entries ?? []).filter((e: any) => e.orderId === id).map((e: any) => e.type).join(",");
        const b = (ledgerAfter.body?.entries ?? []).filter((e: any) => e.orderId === id).map((e: any) => e.type).join(",");
        if (a !== b) diff.push(`${id.slice(-4)}: before ${a} / after ${b}`);
      }
      const statusDiff: string[] = [];
      for (const id of ids) {
        const s1 = (await consoleCall(v1.http, v1.sandboxId)("GET", `/api/v1/orders/${id}`)).body?.order?.status;
        if (!s1) statusDiff.push(`${id.slice(-4)} missing`);
      }
      const after = await visitorCycle(v1);
      results.add({
        dependency: service,
        mode: "restart on the same schema after the outages",
        buyer: `ledger before ${ledgerBefore.body?.entries?.length} entries (verifies ${ledgerBefore.body?.verification?.ok}, app pending ${hBefore.ledger?.pending}) / after restart ${ledgerAfter.body?.entries?.length} (verifies ${ledgerAfter.body?.verification?.ok}); new order: ${after.buyer}`,
        approver: `same passkey and session after restart: ${approverSees(after.approver)}`,
        refusalHeld: after.refusalHeld && after.refusals.every((r) => r.refused),
        lostOrDuplicated: diff.length || statusDiff.length ? `differs after restart: ${[...diff, ...statusDiff].join("; ")}` : "none",
        recoveryS: null,
        evidence: { diff, statusDiff, h2: h2.ledger, before: hBefore.ledger },
      });
    }
    if (service === "kafka") {
      await sleep(3_000);
      const h = await health(http, service);
      const c = await topicCounts().catch((e) => ({ error: (e as Error).message.slice(0, 100) }));
      results.note(`kafka: app says sent=${h.actions?.sent}, pending=${h.actions?.pending}, dropped=${h.counters?.["events.dropped"] ?? 0}; own consumer on ${TEST_TOPIC} read ${JSON.stringify(c)}`);
      const dup = c && "messages" in c ? c.messages - c.distinct : null;
      results.add({
        dependency: "kafka",
        mode: "events on the topic after all outages",
        buyer: "n/a (no buyer-visible effect)",
        approver: "n/a",
        refusalHeld: null,
        lostOrDuplicated: c && "messages" in c ? (c.distinct < Number(h.actions?.sent ?? 0) ? `lost: app sent ${h.actions?.sent}, topic holds ${c.distinct} distinct` : dup ? `${dup} duplicate message(s) (same eventId), app sent ${h.actions?.sent}` : "none") : `not counted: ${JSON.stringify(c)}`,
        recoveryS: null,
        evidence: { app: h.actions, topic: c, dropped: h.counters?.["events.dropped"] },
      });
    }
    results.note(`${service}: proxy ${JSON.stringify(proxy.stats)}${brokerProxies.length ? `; broker proxies ${brokerProxies.map((b) => JSON.stringify(b.proxy.stats)).join(" ")}` : ""}`);
  } finally {
    await dock?.stop();
    await proxy.stop();
    for (const b of brokerProxies) await b.proxy.stop();
    await partner?.close();
  }
}

// ---------- the Kafka topic: created by this run or not ----------

let topicExistedBefore: boolean | undefined;

async function withAdmin<T>(fn: (admin: import("kafkajs").Admin) => Promise<T>): Promise<T> {
  const { Kafka, logLevel } = await import("kafkajs");
  const { kafkaConfig } = await import("@/server/aiven/env");
  const cfg = kafkaConfig();
  if (!cfg) throw new Error("Kafka is not configured");
  const admin = new Kafka({ clientId: "dock-deps-test", brokers: cfg.brokers, ssl: { ...cfg.ssl, rejectUnauthorized: true }, logLevel: logLevel.NOTHING, connectionTimeout: 8_000 }).admin();
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export async function noteTopicBefore(): Promise<void> {
  if (topicExistedBefore !== undefined || missingVars("kafka").length) return;
  topicExistedBefore = await withAdmin(async (a) => (await a.listTopics()).includes(TEST_TOPIC)).catch(() => undefined);
}

/** Delete dock.actions.testinfra, only if this run created it. Never any other topic. */
export async function deleteTestTopicIfCreated(results: Results): Promise<void> {
  if (topicExistedBefore !== false) return;
  if (TEST_TOPIC !== "dock.actions.testinfra") throw new Error("refusing to delete a topic other than dock.actions.testinfra");
  const deleted = await withAdmin(async (a) => {
    if (!(await a.listTopics()).includes(TEST_TOPIC)) return false;
    await a.deleteTopics({ topics: [TEST_TOPIC] });
    return true;
  }).catch((e) => `failed: ${(e as Error).message.slice(0, 80)}`);
  results.note(`kafka: test topic ${TEST_TOPIC} created by this run; delete: ${deleted}`);
}

/** How many messages are on the test topic and how many distinct event ids (duplicates = at-least-once resends). */
export async function topicCounts(): Promise<{ messages: number; distinct: number } | undefined> {
  const { Kafka, logLevel } = await import("kafkajs");
  const { kafkaConfig } = await import("@/server/aiven/env");
  const cfg = kafkaConfig();
  if (!cfg) return undefined;
  const kafka = new Kafka({ clientId: "dock-deps-test", brokers: cfg.brokers, ssl: { ...cfg.ssl, rejectUnauthorized: true }, logLevel: logLevel.NOTHING });
  const admin = kafka.admin();
  await admin.connect();
  const offsets = await admin.fetchTopicOffsets(TEST_TOPIC).catch(() => []);
  await admin.disconnect().catch(() => undefined);
  const total = offsets.reduce((s, o) => s + Number(o.high) - Number(o.low), 0);
  if (!total) return { messages: 0, distinct: 0 };
  const consumer = kafka.consumer({ groupId: `dock-deps-test-${Date.now().toString(36)}` });
  const ids = new Set<string>();
  let seen = 0;
  await consumer.connect();
  await consumer.subscribe({ topic: TEST_TOPIC, fromBeginning: true });
  await new Promise<void>((resolve) => {
    const stop = setTimeout(resolve, 20_000);
    void consumer.run({
      eachMessage: async ({ message }) => {
        seen++;
        try {
          ids.add(JSON.parse(String(message.value)).eventId);
        } catch {
          /* not ours */
        }
        if (seen >= total) {
          clearTimeout(stop);
          resolve();
        }
      },
    });
  });
  await consumer.disconnect().catch(() => undefined);
  return { messages: seen, distinct: ids.size };
}

/** The broker addresses the Kafka cluster advertises, other than the bootstrap host (kept in memory, never printed). */
async function kafkaBrokerHosts(): Promise<string[]> {
  return withAdmin(async (a) => {
    const c = await a.describeCluster();
    const boot = targets("kafka").map((t) => t.host);
    return [...new Set(c.brokers.map((b) => b.host).filter((h) => !boot.includes(h)))];
  });
}
