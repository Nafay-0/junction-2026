import type { IndexedProduct } from "@/core/catalog/partner";
import categoryLabels from "@/server/catalog-categories.json";
import type { KnowledgeMap } from "@/server/knowledge/map";
import { USE_TEXT } from "@/server/knowledge/vocab";

/**
 * What a product is, in one short text, from the partner's names and category and the knowledge map's facts.
 * The same text is embedded once per product (vectors.ts) and is the line the relevance judge reads (judge.ts).
 * No claim, allergen or price is in it: those are decided from the data by code, never by a model.
 */

const CATS = (categoryLabels as { categories: Record<string, { label?: string }> }).categories;

export function categoryLabelOf(code: string): string | undefined {
  return CATS[code]?.label;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function productTitle(p: IndexedProduct): string {
  return p.names.en ?? p.names.fi ?? p.names.sv ?? p.id;
}

/** The facts the map knows about the product, as words: "barista oat drink (oat milk); plant drink; for coffee, drinking". */
export function knowledgeWords(p: IndexedProduct, map: KnowledgeMap | null | undefined, opts: { aliases?: boolean } = {}): string {
  const prof = map?.profile(p.id);
  if (!prof) return "";
  const kind = map!.kinds.get(prof.kind);
  const aliases = opts.aliases !== false && kind?.aliases.length ? ` (${kind.aliases.slice(0, 4).join(", ")})` : "";
  const uses = prof.uses.slice(0, 4).map((u) => USE_TEXT[u]).join(", ");
  return `${prof.kindLabel}${aliases}; ${prof.family.replace(/_/g, " ")}${uses ? `; for ${uses}` : ""}`;
}

/** The document text that is embedded for a product (gemini-embedding-2's document prompt). */
export function embeddingText(p: IndexedProduct, map: KnowledgeMap | null | undefined): string {
  const other = [p.names.fi, p.names.sv].filter((n): n is string => !!n && n !== p.names.en).map((n) => clip(n, 90));
  const parts = [...other, p.brand ? `brand ${p.brand}` : "", knowledgeWords(p, map), categoryLabelOf(p.categoryCode) ? `shelf: ${categoryLabelOf(p.categoryCode)}` : ""].filter(Boolean);
  return `title: ${clip(productTitle(p), 110)} | text: ${parts.join("; ")}`;
}

export const EMBEDDING_RECIPE = "title: English name | text: Finnish and Swedish names; brand; knowledge-map kind (aliases), family, uses; shelf label";

/** The line the judge reads for one candidate: names in the languages the product has, brand, what the map says it is. */
export function judgeLine(p: IndexedProduct, map: KnowledgeMap | null | undefined): string {
  const names = [p.names.en, p.names.fi !== p.names.en ? p.names.fi : undefined].filter((n): n is string => !!n).map((n) => clip(n, 80));
  const facts = knowledgeWords(p, map, { aliases: false });
  return `${names.join(" / ")}${facts ? ` [${facts}]` : ""}`;
}
