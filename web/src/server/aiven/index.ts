import type Valkey from "iovalkey";
import type { Kafka } from "kafkajs";
import type { Pool } from "pg";
import { InMemoryCatalog, type CatalogPort } from "@/core/catalog";
import { InMemoryEventBus } from "@/core/events";
import { InMemoryIntakeRepository, type IntakeRepository } from "@/core/intake";
import { InMemoryKitchenRepository, type KitchenProfile, type KitchenRepository } from "@/core/kitchen";
import { InMemoryLedgerStore, type LedgerStore } from "@/core/ledger";
import { InMemoryDockRepository, type DockRepository } from "@/core/orders";
import { InMemoryPasskeyStore, type PasskeyStore } from "@/core/passkeys";
import { LiveLookupAllowance } from "@/core/live-allowance";
import { InMemorySandboxStore, type SandboxRecord, type SandboxStore } from "@/server/sandboxes";
import { ValioCatalog } from "@/server/valio/valio-catalog";
import { TappedLedgerStore, noActions, type ActionStream } from "./actions";
import { aivenSwitches, errMessage, kafkaConfig, log, pgSchema, valkeyUrl, type AivenSwitches } from "./env";
import { checkServices, type HealthReport } from "./health";
import { KafkaActionStream, TelemetrySink, kafkaClient } from "./kafka";
import { metrics } from "./metrics";
import { PgDocs } from "./pg/docs";
import { PgLedgerStore } from "./pg/ledger-store";
import { createPool, migrate } from "./pg/pool";
import { PgDockRepository, PgIntakeRepository, PgKitchenRepository, PgPasskeyStore, PgRecordStore } from "./pg/repositories";
import { OpenSearchProductSearch, SearchRoutedCatalog } from "./search";
import { PgActionStream, writeHealthRows, writeMetricRows } from "./telemetry-sink";
import { liveCacheSlots } from "./live-slot";
import { ValkeyCachedCatalog, ValkeyEventBus, ValkeyLiveAllowance, ValkeyLiveCache, valkeyClient, type LiveBudget } from "./valkey";

/** Live handles, for the health route and for shutdown. */
export type AivenHandle = {
  switches: AivenSwitches;
  pool?: Pool;
  schema?: string;
  ledger?: PgLedgerStore;
  actions: ActionStream;
  sink?: TelemetrySink;
  kafka?: Kafka;
  valkey?: Valkey;
  search?: OpenSearchProductSearch;
  routed?: SearchRoutedCatalog;
  /** For the MCP tools: the shared allowance, refreshed from Valkey before each check (undefined: the core's own). */
  liveBudget?: LiveBudget;
  health(): Promise<HealthReport>;
  shutdown(): Promise<void>;
};

/** Everything the runtime plugs into createDock and friends. In-memory unless configuration switches an adapter on. */
export type Adapters = {
  repo: DockRepository;
  kitchens: KitchenRepository;
  intakes: IntakeRepository;
  passkeyStore: PasskeyStore;
  sandboxStore: SandboxStore;
  ledgerStore: LedgerStore;
  events: InMemoryEventBus;
  /** The per-agent live-lookup allowance for createDock: shared through Valkey when DOCK_CACHE=valkey. */
  liveAllowance: LiveLookupAllowance;
  /** The catalogue to wrap in MeteredCatalog: the given one, with the live cache and search routing applied. */
  catalog: CatalogPort;
  aiven: AivenHandle;
};

export type AdapterInput = {
  catalog: InMemoryCatalog | ValioCatalog;
  /** Kitchen profiles to start with (in memory), or to insert once if absent (PostgreSQL). */
  seedKitchens?: KitchenProfile[];
};

const g = globalThis as typeof globalThis & { __dockAivenShutdownHook?: boolean; __dockAivenHandles?: Set<AivenHandle> };

/**
 * Pick each adapter from configuration (see env.ts). Never half-configures: an adapter that is switched on
 * but cannot start (bad address, service down) fails the start with a clear message, except Kafka, OpenSearch
 * and the Valkey bus, which are not on the order path and degrade to logging a warning.
 */
export async function selectAdapters(input: AdapterInput): Promise<Adapters> {
  const switches = aivenSwitches();
  const handle: AivenHandle = {
    switches,
    actions: noActions,
    health: () => checkServices(handle),
    shutdown: () => shutdown(handle),
  };
  let repo: DockRepository = new InMemoryDockRepository();
  let kitchens: KitchenRepository = new InMemoryKitchenRepository(input.seedKitchens ?? []);
  let intakes: IntakeRepository = new InMemoryIntakeRepository();
  let passkeyStore: PasskeyStore = new InMemoryPasskeyStore();
  let sandboxStore: SandboxStore = new InMemorySandboxStore();
  let ledgerStore: LedgerStore = new InMemoryLedgerStore();
  let events = new InMemoryEventBus();
  let catalog: CatalogPort = input.catalog;
  let liveAllowance = new LiveLookupAllowance();

  const needPg = switches.store === "postgres" || switches.actions !== "off";
  if (needPg) {
    handle.pool = createPool();
    handle.schema = pgSchema();
    await migrate(handle.pool, handle.schema);
  }

  if (switches.store === "postgres") {
    const docs = new PgDocs(handle.pool!, handle.schema!);
    repo = new PgDockRepository(docs);
    const k = new PgKitchenRepository(docs);
    await k.seed(input.seedKitchens ?? []);
    kitchens = k;
    intakes = new PgIntakeRepository(docs);
    passkeyStore = new PgPasskeyStore(docs);
    sandboxStore = new PgRecordStore<SandboxRecord>(docs, "sandbox", (s) => s.sandboxId);
    handle.ledger = await PgLedgerStore.open(handle.pool!, handle.schema!);
    ledgerStore = handle.ledger;
    log("info", "PostgreSQL store on", { schema: handle.schema, ledgerEntries: handle.ledger.all().length, ledgerVerified: handle.ledger.loaded.ok });
  }

  if (switches.actions === "kafka") {
    handle.kafka = kafkaClient(kafkaConfig()!, "dock-app");
    handle.actions = new KafkaActionStream(handle.kafka);
    if (switches.kafkaSink) {
      handle.sink = new TelemetrySink(handle.kafka, handle.pool!);
      void handle.sink.start(); // joins the consumer group in the background; never blocks the start
    }
  } else if (switches.actions === "postgres") {
    handle.actions = new PgActionStream(handle.pool!);
  }
  if (switches.actions !== "off") ledgerStore = new TappedLedgerStore(ledgerStore, handle.actions);

  if (switches.cache === "valkey" || switches.bus === "valkey") handle.valkey = valkeyClient(valkeyUrl()!, "dock-app");
  if (switches.cache === "valkey") {
    const v = handle.valkey!;
    if (input.catalog instanceof ValioCatalog) {
      // buildCatalog's AIVEN HOOK: the slot in front of the partner API (live-slot.ts). Below the demo overrides.
      const slot = liveCacheSlots.get(input.catalog);
      if (slot) slot.attach((inner) => new ValkeyLiveCache(inner, v, { actions: handle.actions }));
      else log("warn", "this ValioCatalog was not built by buildCatalog; the Valkey live cache is not in front of the partner API");
    } else {
      catalog = new ValkeyCachedCatalog(input.catalog, v, { actions: handle.actions });
    }
    const shared = new ValkeyLiveAllowance(v, undefined, undefined, pgSchema());
    liveAllowance = shared;
    handle.liveBudget = shared.asBudget();
  }
  if (switches.bus === "valkey") {
    const sub = valkeyClient(valkeyUrl()!, "dock-app-sub");
    const bus = new ValkeyEventBus(handle.valkey!, sub);
    events = bus;
    handles(handle).subscriber = sub;
  }

  if (switches.search === "opensearch") {
    if (input.catalog instanceof ValioCatalog) {
      const valio = input.catalog;
      handle.search = new OpenSearchProductSearch({ url: process.env.OPENSEARCH_URL!.trim(), byId: (id) => valio.getProduct(id), alias: process.env.DOCK_SEARCH_ALIAS?.trim() || undefined });
      handle.routed = new SearchRoutedCatalog(valio, handle.search);
      catalog = handle.routed;
    } else {
      log("info", "DOCK_SEARCH=opensearch ignored: the seed catalogue is searched in-process (OpenSearch holds the partner catalogue)");
    }
  }

  if (handle.pool) startMetricsFlusher(handle);
  registerShutdownHook(handle);
  return { repo, kitchens, intakes, passkeyStore, sandboxStore, ledgerStore, events, liveAllowance, catalog, aiven: handle };
}

// ---------- background: counters to telemetry.events, expired documents swept ----------

const extra = new WeakMap<AivenHandle, { subscriber?: Valkey; timer?: NodeJS.Timeout; last?: Record<string, number> }>();
function handles(h: AivenHandle) {
  let x = extra.get(h);
  if (!x) extra.set(h, (x = {}));
  return x;
}

async function flushMetrics(h: AivenHandle): Promise<void> {
  if (!h.pool) return;
  const x = handles(h);
  const now = metrics.snapshot();
  const last = x.last ?? {};
  const deltas: Record<string, number> = {};
  for (const [k, v] of Object.entries(now)) deltas[k] = v - (last[k] ?? 0);
  x.last = now;
  await writeMetricRows(h.pool, deltas, { pid: process.pid });
  const report = await checkServices(h);
  await writeHealthRows(h.pool, report.services);
  if (h.schema && h.switches.store === "postgres") {
    await h.pool.query(`delete from ${h.schema}.docs where collection in ('session', 'ceremony') and expires_at < now() - interval '1 hour'`);
  }
}

function startMetricsFlusher(h: AivenHandle): void {
  const x = handles(h);
  x.timer = setInterval(() => void flushMetrics(h).catch((err) => log("warn", "metrics flush failed", { error: errMessage(err) })), 60_000);
  x.timer.unref();
}

// ---------- shutdown ----------

async function shutdown(h: AivenHandle): Promise<void> {
  const x = handles(h);
  if (x.timer) clearInterval(x.timer);
  await h.ledger?.flush(10_000);
  await h.actions.flush(8_000).catch(() => undefined);
  // Wait (bounded) until the last event this process sent has reached telemetry.events, through whichever sink.
  const last = h.actions.lastEventId?.();
  if (h.sink && last && h.pool) await waitForTelemetry(h.pool, last, 10_000);
  await flushMetrics(h).catch(() => undefined);
  await h.actions.close().catch(() => undefined);
  await h.sink?.stop();
  x.subscriber?.disconnect();
  h.valkey?.disconnect();
  await h.pool?.end().catch(() => undefined);
  g.__dockAivenHandles?.delete(h);
}

async function waitForTelemetry(pool: Pool, eventId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await pool.query(`select 1 from telemetry.events where attrs->>'event_id' = $1`, [eventId]).catch(() => null);
    if (r?.rowCount) return true;
    await new Promise((res) => setTimeout(res, 300));
  }
  log("warn", "the telemetry sink had not written this process's last event before shutdown; it will on its next run", { eventId });
  return false;
}

function registerShutdownHook(h: AivenHandle): void {
  g.__dockAivenHandles ??= new Set();
  g.__dockAivenHandles.add(h);
  if (g.__dockAivenShutdownHook) return;
  g.__dockAivenShutdownHook = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      void shutdownAiven().finally(() => process.exit(0));
    });
  }
}

/** Flush and close every adapter this process opened (scripts call it before exiting; signals call it too). */
export async function shutdownAiven(): Promise<void> {
  await Promise.all([...(g.__dockAivenHandles ?? [])].map((h) => h.shutdown().catch((err) => log("warn", "shutdown step failed", { error: errMessage(err) }))));
}

export { aivenHealth } from "./health";
export type { HealthReport } from "./health";
