import { handle } from "@/server/http";
import { restWatch } from "@/server/watch/rest";

/** POST /api/v1/watch/backup { orderId, productId?, choice?, by? }: the alternatives for an order's poor-record product, or the buyer's backup (bought only if it cannot come). */
export async function POST(req: Request) {
  return handle(async (rt) => Response.json(await restWatch(rt, req, "line_up_backup")));
}
