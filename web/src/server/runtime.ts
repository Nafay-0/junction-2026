import { randomUUID } from "node:crypto";
import type { JWK } from "jose";
import { InMemoryOutbox } from "@/core/approval";
import { InMemoryCatalog, MeteredCatalog } from "@/core/catalog";
import { generateEd25519KeyPair, importEd25519KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { createTrustRegistry } from "@/core/mandate";
import { InMemoryDockRepository, createDock, type Dock } from "@/core/orders";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { DEMO_ORG, demoOrgKeyPair } from "./dev-fixtures";

/**
 * The one Dock instance of this server process, with in-memory storage.
 * Kept on globalThis so every route bundle (and dev hot reloads) share the same store.
 * To go persistent, replace InMemoryDockRepository and the ledger store here; to use the partner's API,
 * replace InMemoryCatalog with an adapter implementing CatalogPort.
 */
export type Runtime = { dock: Dock; outbox: InMemoryOutbox; catalog: InMemoryCatalog };

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
  const catalog = new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK);
  const outbox = new InMemoryOutbox();
  const dock = createDock({
    catalog: new MeteredCatalog(catalog),
    repo: new InMemoryDockRepository(),
    ledger: new Ledger(),
    trustedIssuers: createTrustRegistry([{ kid: demoOrg.kid, orgId: DEMO_ORG.orgId, publicKey: demoOrg.publicKey }]),
    wholesalerKey,
    notifier: outbox,
  });
  return { dock, outbox, catalog };
}
