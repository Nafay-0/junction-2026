import type { PublicOrder } from "@/core/orders";
import type { ReceiptStatus } from "./service";

/**
 * For outside agents (MCP and REST): whether a committed order's receipt was emailed to the kitchen, additively on the
 * order's result. `{ emailed, to: "m•••@example.com", status }`; absent for an order that is not committed. Mail is
 * sent after the fact, so right after place_order it is usually `sending`; get_order says `sent` once it went.
 */
export async function receiptEmail(order: Pick<PublicOrder, "orderId" | "orgId" | "status">): Promise<ReceiptStatus | undefined> {
  if (order.status !== "committed") return undefined;
  try {
    const [{ getRuntime }, { receiptStatus }] = await Promise.all([import("../runtime"), import("./service")]);
    return await receiptStatus(await getRuntime(), order);
  } catch {
    return undefined; // a mail question never fails an order's answer
  }
}
