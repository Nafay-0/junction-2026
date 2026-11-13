import type { Product } from "@/core/catalog";
import { CATEGORY_SLUGS } from "@/core/catalog/partner";
import generated from "./catalog-categories.json";
import { getRuntime } from "./runtime";

/**
 * The storefront's view of the assortment: departments and categories with short labels (generated once from
 * the partner's data by `pnpm categories:build`, see scripts/category-labels.ts), and a product with its
 * substitutes and neighbours. Master data only: nothing here calls the partner's live API.
 */

export type ShopCategory = { id: string; code: string | null; slug?: string; label: string; count: number; temperature: string | null };
export type ShopDepartment = { id: string; name: string; count: number; categories: ShopCategory[] };

const DATA = generated as { departments: Record<string, string>; categories: Record<string, { label: string; count: number; temperature: string | null }> };

export function categoryLabel(p: Pick<Product, "categoryCode" | "category">): string {
  if (p.categoryCode && DATA.categories[p.categoryCode]) return DATA.categories[p.categoryCode].label;
  return p.category.replaceAll("_", " ").replace(/^cat /, "Group ");
}

export function categoryIdOf(p: Pick<Product, "categoryCode" | "category">): string {
  return p.categoryCode ? `cat_${p.categoryCode}` : p.category;
}

export async function departments(): Promise<ShopDepartment[]> {
  const { catalogSource, catalog } = await getRuntime();
  if (catalogSource.kind !== "valio") {
    const products = await catalog.searchProducts({ limit: 100 });
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    const categories = [...counts.entries()].map(([c, n]) => ({ id: c, code: null, label: c.replaceAll("_", " "), count: n, temperature: null }));
    return [{ id: "all", name: "Demo assortment", count: products.length, categories }];
  }
  const byDept = new Map<string, ShopDepartment>();
  for (const [code, c] of Object.entries(DATA.categories)) {
    const prefix = code.slice(0, 2);
    const name = DATA.departments[prefix] ?? "Other";
    const d = byDept.get(name) ?? { id: `d${prefix}`, name, count: 0, categories: [] };
    d.count += c.count;
    d.categories.push({ id: `cat_${code}`, code, ...(CATEGORY_SLUGS[code] ? { slug: CATEGORY_SLUGS[code] } : {}), label: c.label, count: c.count, temperature: c.temperature });
    byDept.set(name, d);
  }
  const out = [...byDept.values()].sort((a, b) => b.count - a.count);
  for (const d of out) {
    d.categories.sort((a, b) => b.count - a.count);
    // Two groups can derive the same label: tell them apart by storage, then by size.
    const seen = new Map<string, number>();
    for (const c of d.categories) {
      const n = (seen.get(c.label) ?? 0) + 1;
      seen.set(c.label, n);
      if (n > 1) c.label = `${c.label} (${c.temperature ?? `group ${n}`})`;
    }
  }
  return out;
}

export type ProductPage = { product: Product; category: { id: string; label: string }; substitutes: Product[]; similar: Product[] };

/** One product, the substitutes the partner lists for it, and others from its category carrying the same claims. */
export async function productPage(id: string): Promise<ProductPage | undefined> {
  const { catalog } = await getRuntime();
  const [product] = await catalog.searchProducts({ ids: [id], limit: 1 });
  if (!product) return undefined;
  const subIds = (product.substitutes ?? []).slice(0, 8);
  const substitutes = subIds.length ? await catalog.searchProducts({ ids: subIds, limit: 8 }) : [];
  const neighbours = await catalog.searchProducts({ category: categoryIdOf(product), limit: 13 });
  const similar = neighbours.filter((p) => p.id !== product.id && !subIds.includes(p.id)).slice(0, 8);
  return { product, category: { id: categoryIdOf(product), label: categoryLabel(product) }, substitutes, similar };
}
