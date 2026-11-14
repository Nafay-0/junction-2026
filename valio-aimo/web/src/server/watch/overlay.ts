import type { LiveOffer, LiveStatus } from "@/core/catalog";

/**
 * A staged stock-out, laid over the live answers one organisation gets (the core's `liveOverlay`, wired in
 * server/runtime.ts): the intake, quotes, the order sheet, the watch and an outside agent all see the staged product as
 * out of stock until the staged day, for that kitchen only. Staff stage it on /ops/watch for demo and test kitchens
 * (server/watch/service.ts decides who may); every offer it touches says `simulated: true`, so every claim signed
 * from it says so, and its message starts with "STAGED".
 *
 * Kept per Dock instance, so a test's fresh runtime starts with nothing staged; on globalThis, because the bundler
 * may load this module once per route and the operations route that stages must reach the runtime's overlay.
 */
export type StagedStockOut = { stageId: string; productId: string; until: string; by: string };

const g = globalThis as typeof globalThis & { __dockStagedStockOuts?: WeakMap<object, Map<string, StagedStockOut[]>> };
const byDock = (g.__dockStagedStockOuts ??= new WeakMap());

const table = (dock: object) => {
  let t = byDock.get(dock);
  if (!t) byDock.set(dock, (t = new Map()));
  return t;
};

/** Replace what is staged for an organisation (the watch service keeps this in step with its records). */
export function setStaged(dock: object, orgId: string, stages: StagedStockOut[]): void {
  if (stages.length) table(dock).set(orgId, stages);
  else table(dock).delete(orgId);
}

export function stagedFor(dock: object, orgId: string): StagedStockOut[] {
  return byDock.get(dock)?.get(orgId) ?? [];
}

export const STAGED_PREFIX = "STAGED for the demo";

/** One status under a staged stock-out: out of stock until the staged day, the price kept, marked simulated. */
export function stagedStatus(st: LiveStatus, g: StagedStockOut): LiveStatus {
  const offer: LiveOffer | undefined = st.offer ? { ...st.offer, availablePacks: 0, stockKnown: true, deliveryDate: g.until, laterThanRequested: true, simulated: true } : undefined;
  return {
    ...st,
    ...(offer ? { offer } : {}),
    orderable: false,
    // out_of_stock says what; sales_block makes it no offer at all, so a quote is refused with this message.
    problems: [...new Set([...st.problems.filter((p) => p !== "stock_unknown"), "out_of_stock" as const, "sales_block" as const])],
    message: `${STAGED_PREFIX} by ${g.by}: out of stock until ${g.until} (the partner's live answer: ${st.orderable ? "available" : st.problems.join(", ") || "not orderable"}).`,
  };
}

/** The core's liveOverlay for this Dock. */
export function liveOverlay(dock: object): (orgId: string, statuses: LiveStatus[]) => LiveStatus[] {
  return (orgId, statuses) => {
    const staged = stagedFor(dock, orgId);
    if (!staged.length) return statuses;
    return statuses.map((st) => {
      const g = staged.find((x) => x.productId === st.productId);
      return g ? stagedStatus(st, g) : st;
    });
  };
}
