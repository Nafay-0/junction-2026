import type { LedgerEntryType } from "@/core/ledger";
import type { Runtime } from "../runtime";

/**
 * Conditions the partner's live data cannot be relied on to give on cue (a stock-out), set through the catalogue's
 * existing demo hook (`setStock`, as the tests and the scripted scenario use it) and labelled everywhere:
 *
 *   - in the ledger: a "control" entry before and after, naming the product, the show and the kitchen;
 *   - on every live offer the partner catalogue returns meanwhile (`simulated: true`, "(simulated)" in its message);
 *   - on the screen: the step's `simulated` list and the footer.
 *
 * Only the stock figure is pinned. The price, the cut-off and everything else stay live. The override is removed
 * as soon as the step has its quote; the caller holds the catalogue lock (lock.ts) meanwhile, so no other week's
 * step prices the product in between.
 *
 * HOOK NEEDED (worked around): a per-organisation override would let a stock-out be simulated for one kitchen
 * only. ValioCatalog keeps one override per product for the whole process, and `clearStockOverrides()` clears all
 * of them; the show is its only user, so clearing after the step is safe today.
 */
const CONTROL = "control" as LedgerEntryType;

type StockHook = {
  setStock(productId: string, patch: { availablePacks?: number }): void;
  clearStockOverrides?: () => void;
  getLiveStatus?: unknown;
};

export type Simulation = { label: string; productId: string; undo: () => void };

export function simulateStockOut(rt: Pick<Runtime, "catalog" | "dock">, input: { productId: string; productName: string; kitchenName: string; orgId: string; runId: string }): Simulation {
  const catalog = rt.catalog as unknown as StockHook & { stock?: Map<string, { availablePacks: number }> };
  const before = catalog.stock instanceof Map ? catalog.stock.get(input.productId)?.availablePacks : undefined;
  catalog.setStock(input.productId, { availablePacks: 0 });
  const label = `Simulated: ${input.productName} out of stock (set by the show; price and cut-off stay live)`;
  rt.dock.ledger.append({
    type: CONTROL,
    actor: "show:director",
    summary: `SIMULATED for the demo: the show set ${input.productId} (${input.productName}) to out of stock with the catalogue's demo hook, for ${input.kitchenName}'s week (run ${input.runId}). Price, cut-off and every other figure stay live. Offers returned meanwhile say "simulated".`,
    data: { simulated: true, action: "set_stock", productId: input.productId, availablePacks: 0, orgId: input.orgId, runId: input.runId },
  });
  let undone = false;
  return {
    label,
    productId: input.productId,
    undo: () => {
      if (undone) return;
      undone = true;
      if (typeof catalog.clearStockOverrides === "function") catalog.clearStockOverrides();
      else if (before !== undefined) catalog.setStock(input.productId, { availablePacks: before });
      rt.dock.ledger.append({
        type: CONTROL,
        actor: "show:director",
        summary: `Simulation ended: ${input.productId} (${input.productName}) is back to the partner's live figures.`,
        data: { simulated: true, action: "clear_stock", productId: input.productId, orgId: input.orgId, runId: input.runId },
      });
    },
  };
}
