import { authenticate, handle, readJson } from "@/server/http";
import { lookupProducts } from "@/server/lookup";

/**
 * POST /api/v1/lookup: products, prices and availability in one call, with filters (words, category, brand, claims,
 * allergens to avoid, pack size, delivery day, quantity). Words go through the same product search the kitchen's own
 * agent uses, and each product says whether it is the kind asked for (`match`). The same as the MCP tool find_products.
 */
export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    return Response.json(await lookupProducts(dock, session, await readJson(req)));
  });
}
