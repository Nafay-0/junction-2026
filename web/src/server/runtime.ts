import { randomUUID } from "node:crypto";
import type { JWK } from "jose";
import { InMemoryOutbox } from "@/core/approval";
import { InMemoryCatalog, MeteredCatalog } from "@/core/catalog";
import type { InMemoryEventBus } from "@/core/events";
import type { KitchenRepository } from "@/core/kitchen";
import { generateEd25519KeyPair, importEd25519KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { createTrustRegistry } from "@/core/mandate";
import { createDock, type Dock } from "@/core/orders";
import { PasskeyService } from "@/core/passkeys";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { demoTapEnabled, sandboxLimits } from "./config";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenProfile, demoProducts } from "./demo-kitchen";
import { DEMO_ORG, demoOrgKeyPair } from "./dev-fixtures";
import { selectAdapters, type AivenHandle } from "./aiven";
import { LiveCacheSlot, liveCacheSlots } from "./aiven/live-slot";
import { MandateBook } from "./mandates";
import { attachTimeMachine } from "./mariadb/attach";
import { admission } from "./ops/onsite";
import { suspensions } from "./ops/suspensions";
import { recallLayer } from "./radar/gate";
import { radar } from "./radar/registry";
import { alternativesSource } from "./knowledge/service";
import { SandboxService } from "./sandboxes";
import { AccountService } from "./accounts/service";
import { scheduleTestAccountResets } from "./accounts/schedule";
import { loadCatalogIndex, resolveCatalogIndex } from "./valio/index-store";
import { ValioLiveClient } from "./valio/live-client";
import { ValioCatalog } from "./valio/valio-catalog";

/**
 * The one Dock instance of this server process, with in-memory storage.
 * Kept on globalThis so every route bundle (and dev hot reloads) share the same store.
 * Storage is in memory by default; the Aiven adapters (PostgreSQL, Kafka, Valkey, OpenSearch) replace each store
 * when switched on by configuration (see the AIVEN ADAPTERS block and src/server/aiven/env.ts).
 *
 * Catalogue: the partner's real catalogue (ValioCatalog) when the index exists (`pnpm index:build`) and
 * VALIO_API_KEY is set; otherwise the 12-product seed, so a fresh clone runs with no partner data.
 * DOCK_CATALOG=seed forces the seed. Demo histories (the returning kitchen, visitor hotels) are drawn from whichever
 * catalogue is in use, by attribute.
 */
export type CatalogSource = { kind: "seed" } | { kind: "valio"; products: number; indexFile: string; loadMs: number };
export type Runtime = {
  dock: Dock;
  outbox: InMemoryOutbox;
  catalog: InMemoryCatalog | ValioCatalog;
  catalogSource: CatalogSource;
  /** Live events for phones and the big screen (SSE). */
  events: InMemoryEventBus;
  /** Approvers' passkeys and sessions. */
  passkeys: PasskeyService;
  /** Visitor kitchens created by scanning the join QR code. */
  sandboxes: SandboxService;
  /** Which Aiven adapters are on, their health check and shutdown (src/server/aiven). */
  aiven: AivenHandle;
  /** Kitchen memory (history, stated rules), shared with the Dock instance; the kitchen portal corrects stated rules here. */
  kitchens: KitchenRepository;
  /** Restaurant and buyer accounts: one account, one kitchen (server/accounts). */
  accounts: AccountService;
  /** The kitchens' reissued mandates: the register the gate reads, and what each kitchen added (server/mandates.ts). */
  mandates: MandateBook;
};

const g = globalThis as typeof globalThis & { __dockRuntime?: Promise<Runtime> };

export function getRuntime(): Promise<Runtime> {
  g.__dockRuntime ??= buildRuntime();
  return g.__dockRuntime;
}

/** For tests and the in-process demo: start over with an empty store. */
export function resetRuntime(): void {
  g.__dockRuntime = undefined;
}

async function buildRuntime(): Promise<Runtime> {
  // Without DOCK_WHOLESALER_JWK the wholesaler key lives only as long as the process; quotes die with it.
  const wholesalerKey = process.env.DOCK_WHOLESALER_JWK
    ? await importEd25519KeyPair("dock-wholesaler", JSON.parse(process.env.DOCK_WHOLESALER_JWK) as JWK)
    : await generateEd25519KeyPair(`dock-wholesaler-${randomUUID().slice(0, 8)}`);
  const demoOrg = await demoOrgKeyPair();
  const demoKitchen = await demoKitchenKeyPair();
  const { catalog, catalogSource } = buildCatalog(wantsRealCatalog() ? await resolveCatalogIndex() : undefined);
  const outbox = new InMemoryOutbox();
  const trustedIssuers = createTrustRegistry([
    { kid: demoOrg.kid, orgId: DEMO_ORG.orgId, publicKey: demoOrg.publicKey },
    { kid: demoKitchen.kid, orgId: KITCHEN_ORG.orgId, publicKey: demoKitchen.publicKey },
  ]);
  // ---- BEGIN AIVEN ADAPTERS (src/server/aiven, owner: data plane) ----
  // Every store below is in memory unless configuration switches its Aiven adapter on: DOCK_STORE=postgres,
  // DOCK_ACTIONS=kafka|postgres, DOCK_CACHE=valkey, DOCK_BUS=valkey, DOCK_SEARCH=opensearch, or DOCK_AIVEN=1 for all
  // configured services (src/server/aiven/env.ts). `stores.catalog` is `catalog` with the live cache and search routing.
  // Demo histories come from the catalogue this process runs on (the real one when present), by attribute.
  const products = await demoProducts(catalog);
  const stores = await selectAdapters({ catalog, seedKitchens: [demoKitchenProfile(new Date(), products)] }); // DEV: a returning kitchen with history
  const { events, aiven } = stores;
  // ---- END AIVEN ADAPTERS ----
  // Approvers who registered a passkey must use it; others (the scripted Laakso demo) keep the link token.
  const passkeys = new PasskeyService({ store: stores.passkeyStore, demoTapEnabled });
  // RECALL RADAR HOOK (src/server/radar/gate.ts): held products read as sales-blocked, and quotes, orders and
  // sign-offs that contain one are refused by the gate with the rule recall_hold (the core's ProductHolds dependency).
  const recall = recallLayer(stores.catalog);
  // REISSUED MANDATES (src/server/mandates.ts): read back before the first mandate is presented, so a kitchen's
  // earlier mandates stay refused after a restart.
  const mandates = new MandateBook();
  await mandates.restore(stores.records("mandate_reissue"));
  const dock = createDock({
    catalog: new MeteredCatalog(recall.catalog),
    holds: recall.holds,
    // ADMISSION (src/server/ops/onsite.ts): the core asks the operations layer on every authenticate, so a
    // suspended agent gets no session through any door.
    admit: admission(() => dock),
    mandates,
    repo: stores.repo,
    ledger: new Ledger(stores.ledgerStore),
    trustedIssuers,
    wholesalerKey,
    notifier: outbox,
    verifier: passkeys.verifier,
    events,
    kitchens: stores.kitchens,
    intakes: stores.intakes,
    liveAllowance: stores.liveAllowance,
    // Live answers reused for option cards (not quotes) for this long; each reuse costs the partner nothing.
    // The product knowledge map proposes alternatives by kitchen use (real catalogue only: the seed's products are not in it).
    ...(catalogSource.kind === "valio" && envValue("DOCK_KNOWLEDGE") !== "off" ? { alternatives: alternativesSource() } : {}),
    // Kitchen memory: one line per remembered item each request used (lazy: the memory service is built on this runtime).
    ...(envValue("DOCK_MEMORY") !== "off" ? { memoryUsage: async (orgId: string, intake: Parameters<NonNullable<Parameters<typeof createDock>[0]["memoryUsage"]>>[1]) => (await (await import("./memory/runtime")).getMemoryService()).usage(orgId, intake) } : {}),
    liveCacheTtlMs: Number(envValue("DOCK_LIVE_CACHE_SECONDS") ?? 120) * 1000 || 0,
  });
  recall.attach(dock);
  // Suspensions outlive a restart: an agent staff stopped before this process started is still stopped.
  await suspensions(dock).restore(stores.records("suspension"));
  const sandboxes = new SandboxService({ dock, registry: trustedIssuers, passkeys, limits: sandboxLimits, kitchens: stores.kitchens, products: async () => products, store: stores.sandboxStore });
  await sandboxes.restore();
  const accounts = new AccountService({
    store: stores.accountStore,
    registry: trustedIssuers,
    passkeys,
    kitchens: stores.kitchens,
    dock,
    sandboxes,
    catalog,
    maxAccounts: () => Number(envValue("DOCK_ACCOUNTS_MAX") ?? 1000) || 1000,
    mandates,
  });
  // Not while the build prerenders pages: restoring hashes passwords (real work off the main thread), which would end
  // prerendering early; a running server restores at its first request.
  if (process.env.NEXT_PHASE !== "phase-production-build") await accounts.restore();
  const rt: Runtime = { dock, outbox, catalog, catalogSource, events, passkeys, sandboxes, aiven, kitchens: stores.kitchens, mandates, accounts };
  scheduleTestAccountResets(accounts); // not under tests or during a build; DOCK_TEST_ACCOUNTS_RESET_MINUTES=0 turns it off
  radar(rt); // starts the recall radar's schedule (not under tests, during a build, or with RADAR_POLL=off)
  // MARIADB TIME MACHINE (src/server/mariadb): only with DOCK_MARIADB_URL. Mirrors what the gate reads into
  // system-versioned tables after the fact; never in the path of an order.
  attachTimeMachine(rt, stores);
  return rt;
}

const envValue = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

const wantsRealCatalog = () => envValue("DOCK_CATALOG") !== "seed" && !!envValue("VALIO_API_KEY");

/**
 * Pick the catalogue from the environment. Never throws for a missing index or key: it falls back to the seed.
 * `indexFile`: where `resolveCatalogIndex()` found the index (a local file, or a copy fetched from PostgreSQL).
 */
export function buildCatalog(indexFile?: string): { catalog: InMemoryCatalog | ValioCatalog; catalogSource: CatalogSource } {
  const apiKey = envValue("VALIO_API_KEY");
  if (wantsRealCatalog() && apiKey) {
    const loaded = loadCatalogIndex(indexFile);
    if (loaded) {
      const client = new ValioLiveClient({ baseUrl: envValue("VALIO_API_BASE") ?? "https://junction26.valioaimo.fi", apiKey, customer: envValue("VALIO_CUSTOMER") });
      // AIVEN HOOK: a slot in front of the partner API where the Valkey live cache plugs in (src/server/aiven/live-slot.ts).
      const live = new LiveCacheSlot(client);
      const valio = new ValioCatalog(loaded.index, live);
      liveCacheSlots.set(valio, live);
      return {
        catalog: valio,
        catalogSource: { kind: "valio", products: loaded.index.products.length, indexFile: loaded.file, loadMs: loaded.loadMs },
      };
    }
  }
  return { catalog: new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK), catalogSource: { kind: "seed" } };
}
