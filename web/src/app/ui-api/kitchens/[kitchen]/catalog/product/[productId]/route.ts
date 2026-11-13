import { errorBody } from "@/server/http";
import { productPage } from "@/server/kitchen-catalog";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/** GET /ui-api/kitchens/{kitchen}/catalog/product/{id}: the product page's master data. No live call. */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/catalog/product/[productId]">) {
  void req.url;
  return portalRoute(
    ctx.params.then((p) => ({ kitchen: p.kitchen })),
    async () => {
      const { productId } = await ctx.params;
      const page = await productPage(productId);
      if (!page) return Response.json(errorBody("product_not_found", `No product ${productId} in the catalogue.`), { status: 404 });
      return Response.json(page, noStore);
    },
  );
}
