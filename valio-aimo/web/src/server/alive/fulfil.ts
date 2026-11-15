import { fulfilments, decideFulfilment } from "@/server/fulfilment/service";
import { play } from "./clock";
import { setOfEntry } from "./marks";
import type { Ctx } from "./story";

/** The sample's wholesaler staff: the person whose name the confirmations carry (marked sample, as every beat). */
export const SAMPLE_STAFF = "Operations (sample)";
/** How many of the set's newest placed orders are left waiting for the wholesaler's team. */
export const LEFT_WAITING = 2;

/**
 * The wholesaler's team confirms the sample set's placed orders for delivery (server/fulfilment), each some minutes
 * after it was placed and never later than now, and leaves the newest one or two waiting, so the operations Orders
 * list has some to confirm. Only orders of this set; one already decided is left alone (a top-up plays this again).
 */
export async function confirmPlaced(c: Ctx): Promise<string> {
  const { rt } = c;
  const decided = await fulfilments(rt);
  const placed = (await rt.dock.listOrders())
    .filter((o) => o.status === "committed" && setOfEntry(rt.dock.ledger, { orderId: o.orderId, requestId: o.requestId, data: {} }) === c.setId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const open = placed.filter((o) => !decided.has(o.orderId));
  const toConfirm = open.slice(0, Math.max(0, open.length - LEFT_WAITING));
  const now = c.now.getTime();
  let n = 0;
  for (const [i, o] of toConfirm.entries()) {
    const at = Math.min(now, Date.parse(o.createdAt) + (20 + ((i * 17) % 50)) * 60_000);
    await play(c.setId, Math.max(0, now - at), "the wholesaler's team confirms placed orders", () => decideFulfilment(rt, o, { decision: "confirm", by: SAMPLE_STAFF, sample: true, now: new Date(at) }));
    n++;
  }
  return `${n} confirmed for delivery, ${open.length - n} left waiting for the wholesaler's team`;
}
