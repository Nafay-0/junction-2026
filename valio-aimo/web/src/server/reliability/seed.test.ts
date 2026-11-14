import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { addDaysIso, localNow } from "@/core/kitchen";
import { SEED_PRODUCTS } from "@/core/seed";
import { POOR_RECORD, TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import { resolveKitchen } from "@/server/console-kitchens";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { allBackups, offerBackups, setBackup } from "./service";

/**
 * The backup scenario on the public test accounts: each seeds one weekly product with a poor delivery record (when
 * the catalogue has it), and a reset of the test accounts clears every backup offered, lined up or used for them.
 */

const fake = (id: string, name: string, category: string, packSize: number): Product => ({ id, name, brand: "Test", category, unit: "kg", packSize, attributes: ["lactose_free"], allergens: [], certificates: [], deliveryReliability: 0.6, carbonKgPerUnit: 1 });

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
  process.env.DOCK_RELIABILITY_WARN = "0.95";
});
afterEach(() => {
  delete process.env.DOCK_RELIABILITY_WARN;
});

describe("the poor-record product in each test kitchen's seed", () => {
  it("each kitchen buys its product every week when the catalogue has it, and nothing when it does not", () => {
    const products = [...SEED_PRODUCTS, fake(POOR_RECORD.lumo, "Rye rice pie", "cat_41762", 8.1), fake(POOR_RECORD.metsola, "Lollo rosso", "cat_17403", 1), fake(POOR_RECORD.sointu, "Churned butter", "butter", 1)];
    const now = new Date();
    for (const [i, id] of [POOR_RECORD.lumo, POOR_RECORD.metsola, POOR_RECORD.sointu].entries()) {
      const h = TEST_ACCOUNTS[i].profile("org_t", "T", now, products).history.filter((e) => e.lines[0].productId === id);
      expect(h.length).toBe(5);
      expect(new Set(h.map((e) => new Date(`${e.deliveryDate}T12:00:00Z`).getUTCDay())).size).toBe(1); // one weekday: weekly
      expect(TEST_ACCOUNTS[i].profile("org_t", "T", now, SEED_PRODUCTS).history.some((e) => e.lines[0].productId === id)).toBe(false);
    }
  });

  it("a reset of the test accounts clears the backups offered, lined up or used for them", async () => {
    const rt = await getRuntime();
    const k = (await resolveKitchen("hotel-lumo"))!;
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never);
    const day = addDaysIso(localNow(new Date()).date, 3);
    const req = await rt.dock.openRequest(session, { text: "4 × JP-3010", neededBy: day, productIds: ["JP-3010"] });
    const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "JP-3010", quantity: 4 }] });
    const [b] = await offerBackups(rt, session, { requestId: req.requestId, lines: q.quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents, deliveryDate: l.deliveryDate })) });
    expect(b).toBeDefined();
    await setBackup(rt, session, b.backupId, { productId: b.alternatives[0].productId }, { by: "Tester", via: "test" });
    await rt.accounts.resetTestAccounts("in a test");
    expect((await allBackups(rt)).find((x) => x.backupId === b.backupId)?.state).toBe("cleared");
    expect(rt.dock.ledger.entries().some((e) => e.data?.step === "backup_cleared")).toBe(true);
  });
});
