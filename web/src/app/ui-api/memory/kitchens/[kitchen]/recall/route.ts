import { z } from "zod";
import { body, kitchenMemoryRoute } from "@/server/memory/http";

/**
 * POST /ui-api/memory/kitchens/{kitchen}/recall  { text?, family?, dish?, productIds?, deliverBy?, site?, person? }
 *   The remembered items that matter for this request, each with how it is used (constrains, pre-selects,
 *   checks, context) and who stands behind it, plus `forInterpreter`: the same in a compact block for the
 *   language model that structures the request.
 */
const Body = z.object({
  text: z.string().max(2000).optional(),
  family: z.string().max(60).optional(),
  dish: z.string().max(200).optional(),
  productIds: z.array(z.string().max(60)).max(20).optional(),
  deliverBy: z.iso.date().optional(),
  site: z.string().max(80).optional(),
  person: z.string().max(120).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/ui-api/memory/kitchens/[kitchen]/recall">) {
  return kitchenMemoryRoute(req, ctx.params, async (k, memory) => memory.recall(k.info.orgId, await body(req, Body)));
}
