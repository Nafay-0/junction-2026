import { randomUUID } from "node:crypto";
import type { JWK } from "jose";
import { InMemoryOutbox } from "@/core/approval";
import { InMemoryCatalog, MeteredCatalog } from "@/core/catalog";
import { InMemoryEventBus } from "@/core/events";
import { InMemoryKitchenRepository, type KitchenRepository } from "@/core/kitchen";
import { generateEd25519KeyPair, importEd25519KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { createTrustRegistry } from "@/core/mandate";
import { InMemoryDockRepository, createDock, type Dock } from "@/core/orders";
import { InMemoryPasskeyStore, PasskeyService } from "@/core/passkeys";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { demoTapEnabled, sandboxLimits } from "./config";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenProfile, demoProducts } from "./demo-kitchen";
import { DEMO_ORG, demoOrgKeyPair } from "./dev-fixtures";
import { SandboxService } from "./sandboxes";
import { loadCatalogIndex } from "./valio/index-store";
import { ValioLiveClient } from "./valio/live-client";
import { ValioCatalog } from "./valio/valio-catalog";

/**
 * The one Dock instance of this server process, with in-memory storage.
 * Kept on globalThis so every route bundle (and dev hot reloads) share the same store.
 * To go persistent, replace InMemoryDockRepository and the ledger store here.
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
  /** Kitchen memory (history, stated rules), shared with the Dock instance; the kitchen portal corrects stated rules here. */
  kitchens: KitchenRepository;
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
  const { catalog, catalogSource } = buildCatalog();
  const outbox = new InMemoryOutbox();
  const trustedIssuers = createTrustRegistry([
    { kid: demoOrg.kid, orgId: DEMO_ORG.orgId, publicKey: demoOrg.publicKey },
    { kid: demoKitchen.kid, orgId: KITCHEN_ORG.orgId, publicKey: demoKitchen.publicKey },
  ]);
  const events = new InMemoryEventBus();
  // Approvers who registered a passkey must use it; others (the scripted Laakso demo) keep the link token.
  const passkeys = new PasskeyService({ store: new InMemoryPasskeyStore(), demoTapEnabled });
  // Demo histories come from the catalogue this process runs on (the real one when present), by attribute.
  const products = await demoProducts(catalog);
  const kitchens = new InMemoryKitchenRepository([demoKitchenProfile(new Date(), products)]); // DEV: a returning kitchen with history
  const dock = createDock({
    catalog: new MeteredCatalog(catalog),
    repo: new InMemoryDockRepository(),
    ledger: new Ledger(),
    trustedIssuers,
    wholesalerKey,
    notifier: outbox,
    verifier: passkeys.verifier,
    events,
    kitchens,
  });
  const sandboxes = new SandboxService({ dock, registry: trustedIssuers, passkeys, limits: sandboxLimits, kitchens, products: async () => products });
  return { dock, outbox, catalog, catalogSource, events, passkeys, sandboxes, kitchens };
}

const envValue = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

/** Pick the catalogue from the environment. Never throws for a missing index or key: it falls back to the seed. */
export function buildCatalog(): { catalog: InMemoryCatalog | ValioCatalog; catalogSource: CatalogSource } {
  const apiKey = envValue("VALIO_API_KEY");
  if (envValue("DOCK_CATALOG") !== "seed" && apiKey) {
    const loaded = loadCatalogIndex();
    if (loaded) {
      const live = new ValioLiveClient({ baseUrl: envValue("VALIO_API_BASE") ?? "https://junction26.valioaimo.fi", apiKey, customer: envValue("VALIO_CUSTOMER") });
      return {
        catalog: new ValioCatalog(loaded.index, live),
        catalogSource: { kind: "valio", products: loaded.index.products.length, indexFile: loaded.file, loadMs: loaded.loadMs },
      };
    }
  }
  return { catalog: new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK), catalogSource: { kind: "seed" } };
}
