import { InMemoryOutbox } from "@/core/approval";
import { InMemoryCatalog, MeteredCatalog } from "@/core/catalog";
import { generateEd25519KeyPair } from "@/core/keys";
import { Ledger, type LedgerStore } from "@/core/ledger";
import { createTrustRegistry, signMandate } from "@/core/mandate";
import { createDock, InMemoryDockRepository, type DockRepository } from "@/core/orders";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";

/** A Dock on the seed catalogue with the given stores, signed in as the demo agent. For the adapter tests only. */
export async function createTestDock(ledgerStore?: LedgerStore, repo: DockRepository = new InMemoryDockRepository()) {
  const org = await demoOrgKeyPair();
  const outbox = new InMemoryOutbox();
  const dock = createDock({
    catalog: new MeteredCatalog(new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK)),
    repo,
    ledger: new Ledger(ledgerStore),
    trustedIssuers: createTrustRegistry([{ kid: org.kid, orgId: DEMO_ORG.orgId, publicKey: org.publicKey }]),
    wholesalerKey: await generateEd25519KeyPair("test-wholesaler"),
    notifier: outbox,
  });
  const session = await dock.authenticate(await signMandate(demoMandate(new Date()), org), DEMO_ORG.agentId);
  return { dock, session, outbox };
}
