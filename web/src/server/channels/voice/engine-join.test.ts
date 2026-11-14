import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockError } from "@/core/errors";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import { resetRuntime } from "../../runtime";
import { calls, voiceLimits } from "./calls";
import { runTool } from "./tools";

/**
 * The spoken path follows the engine's rules once the caller confirms the read-back (thread/voice-bridge.ts
 * confirmThroughEngine): several items said at once are read back together and become one order sheet, placed by
 * one "yes"; a named day is the delivery day. The reader is replaced by fixed readings per item.
 */

/** The next Thursday at least three days away, as an ISO date. */
const thursday = () => {
  let d = addDaysIso(localNow(new Date()).date, 3);
  while (isoWeekday(d) !== 4) d = addDaysIso(d, 1);
  return d;
};

vi.mock("../flow", async (orig) => {
  const real = await orig<typeof import("../flow")>();
  return {
    ...real,
    readNeed: vi.fn(async (_a: unknown, text: string) => {
      if (/ and /.test(text)) throw new DockError(422, "need_incomplete", "The request does not say how much.", undefined, { missing: ["quantity"] });
      const cream = /cream/.test(text);
      return { need: { text, item: { text: cream ? "cream" : "lactose-free milk", category: cream ? "cream" : "milk", attributes: ["lactose_free"] }, quantity: cream ? { amount: 10, unit: "L" } : { amount: 100, unit: "L" }, deliverBy: thursday() }, model: "test", ms: 1 };
    }),
  };
});

beforeEach(() => {
  resetRuntime();
  (globalThis as { __dockCalls?: unknown }).__dockCalls = undefined;
});

const open = () => calls().open("kaari", "push_to_talk", voiceLimits({})).callId;

describe("the spoken path, through the engine", () => {
  it("reads several items back in one sentence, then makes them one order sheet that one yes orders", async () => {
    const callId = open();
    const words = "10 litres of cream and 100 litres of lactose-free milk for Thursday";
    const rb = await runTool("kaari", { callId, name: "submit_request", args: { request: words }, heard: { text: words, turn: 1 } });
    expect(rb.forModel.state).toBe("read_back");
    expect(rb.forModel.say).toMatch(/10 L .*cream and 100 L .*lactose-free milk, for Thursday .*as one order/);
    expect(rb.screen.pending?.parts).toHaveLength(2);
    const confirmed = await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "yes", turn: 2 } });
    expect(confirmed.forModel.state, JSON.stringify(confirmed.forModel).slice(0, 300)).toBe("order_sheet");
    expect(confirmed.forModel.say).toMatch(/All 2 items are on one order/);
    const placed = await runTool("kaari", { callId, name: "place_order", heard: { text: "yes, order it", turn: 3 } });
    expect(["committed", "pending_approval"], JSON.stringify(placed.forModel)).toContain(placed.forModel.state);
  });

  it("keeps a named day as the delivery day", async () => {
    const callId = open();
    const words = "10 litres of cream for Thursday";
    await runTool("kaari", { callId, name: "submit_request", args: { request: words }, heard: { text: words, turn: 1 } });
    const r = await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "yes", turn: 2 } });
    const need = (r.screen.step?.need ?? {}) as { deliverOn?: string; deliverBy?: string };
    if (r.screen.step) expect(need.deliverOn).toBe(thursday());
    else expect(r.screen.order?.lines[0].deliveryDate).toBe(thursday());
  });
});
