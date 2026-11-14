import { describe, expect, it } from "vitest";
import { PRICE_BATCH, price } from "./sheet";

describe("an order sheet is priced line by line, every line", () => {
  it("prices a 25-line sheet in batches of ten, no line left at 0,00 €", async () => {
    const calls: string[][] = [];
    const run = {
      t0: Date.now(),
      thread: {},
      turnId: "trn_1",
      store: { step: () => undefined, agentTurn: () => undefined, mark: () => undefined },
      session: {},
      rt: {
        dock: {
          lookupAvailability: async (_s: unknown, req: { productIds: string[]; deliveryDate: string }) => {
            calls.push(req.productIds);
            return { offers: req.productIds.map((productId) => ({ productId, unitPriceCents: 100, deliveryDate: req.deliveryDate })) };
          },
        },
      },
    };
    const lines = Array.from({ length: 25 }, (_, i) => ({ lineId: `L${i + 1}`, productId: `P${i + 1}`, packs: 1 }));
    const sheet = { sheetId: "sh_1", requestId: "req_1", version: 1, turnId: "trn_1", deliveryDate: "2026-11-17", lines, offers: {} as Record<string, unknown> };
    await price(run as never, sheet as never);
    expect(calls.map((c) => c.length)).toEqual([PRICE_BATCH, PRICE_BATCH, 5]);
    expect(Object.keys(sheet.offers)).toHaveLength(25);
  });
});
