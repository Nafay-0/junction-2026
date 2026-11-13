import { categoryIdOf, categoryLabel } from "@/server/kitchen-catalog";
import { getRuntime } from "@/server/runtime";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/**
 * GET /ui-api/kitchens/{kitchen}/catalog?q=&claim=&free=&category=&limit=
 * Product master data only (the partner's files, searched locally in English, Finnish or Swedish). Never a live call.
 *   claim     dietary claims every hit must carry (lactose_free, gluten_free, vegan, organic, ...), repeatable
 *   category  a category id from /catalog/categories (cat_17300) or a Dock slug (milk); combines with q
 *   free      allergens no hit may contain or "may contain"; products without allergen data are left out, repeatable
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/catalog">) {
  return portalRoute(ctx.params, async () => {
    const p = new URL(req.url).searchParams;
    const { catalog, catalogSource } = await getRuntime();
    const text = p.get("q")?.trim().slice(0, 200) || undefined;
    const claims = p.getAll("claim").filter(Boolean).slice(0, 8);
    const free = p.getAll("free").filter(Boolean).slice(0, 8);
    const category = p.get("category")?.trim() || undefined;
    const limit = Math.min(Math.max(Number(p.get("limit")) || 48, 1), 100);
    const t0 = performance.now();
    const products = await catalog.searchProducts({
      text,
      category,
      attributes: claims.length ? claims : undefined,
      forbiddenAllergens: free.length ? free : undefined,
      limit,
    });
    return Response.json(
      {
        products: products.map((p) => ({ ...p, shopCategory: { id: categoryIdOf(p), label: categoryLabel(p) } })),
        source: catalogSource.kind === "valio" ? { kind: "valio", products: catalogSource.products } : { kind: "seed", products: null },
        ms: Math.round(performance.now() - t0),
        liveCalls: 0,
      },
      noStore,
    );
  });
}
