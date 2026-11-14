import { CATEGORY_SLUGS } from "@/core/catalog/partner";
import type { Lang } from "../../_i18n/lang";
import generated from "@/server/catalog-categories.json";
import { DEPARTMENT_NAME } from "./catalogue.text";

const DEPARTMENTS = (generated as { departments: Record<string, string> }).departments;
const SLUG_CODE = new Map(Object.entries(CATEGORY_SLUGS).map(([code, slug]) => [slug, code]));

/** A category (slug or "cat_10418") as its product group in the buyer's language: "dairy and cheese", "maito- ja juustotuotteet". */
export function groupL(category: string, lang: Lang): string | undefined {
  const code = category.startsWith("cat_") ? category.slice(4) : /^\d+$/.test(category) ? category : SLUG_CODE.get(category);
  const dept = code?.slice(0, 2);
  const name = dept ? (lang === "en" ? DEPARTMENTS[dept] : (DEPARTMENT_NAME[lang][dept] ?? DEPARTMENTS[dept])) : undefined;
  return name ? name.charAt(0).toLowerCase() + name.slice(1) : undefined;
}

/** A mandate's categories as its product groups in words, most categories first; never a code. */
export function groupsL(categories: string[], lang: Lang, max = 6): string[] {
  const n = new Map<string, number>();
  for (const c of categories) {
    const g = groupL(c, lang);
    if (g) n.set(g, (n.get(g) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, max);
}
