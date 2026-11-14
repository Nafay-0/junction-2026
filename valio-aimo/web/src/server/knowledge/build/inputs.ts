import type { IndexedProduct } from "@/core/catalog/partner";

/**
 * Compact model inputs, cut from the partner's raw product record by code. Only text a model needs to read (name,
 * ingredients, marketing and usage text) and a few figures that help it judge function (fat, sugar, protein per
 * 100 g). Dietary claims, allergens, origin and labels are deliberately left out: the model is never asked about
 * them, so nothing it says can become one.
 */

type LangText = { value?: unknown; language?: unknown };

const pick = (arr: unknown, max: number, langs = ["en", "fi", "sv"]): string | undefined => {
  if (!Array.isArray(arr)) return undefined;
  for (const lang of langs) {
    const hit = (arr as LangText[]).find((t) => t && t.language === lang && typeof t.value === "string" && t.value.trim());
    if (hit) return clean(hit.value as string, max);
  }
  return undefined;
};

/** Collapse whitespace, drop markup, cut to a length at a word boundary. */
export function clean(s: string, max: number): string {
  const t = s
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${sp > max * 0.6 ? cut.slice(0, sp) : cut}…`;
}

const nutrient = (raw: Record<string, unknown>, id: string): number | undefined => {
  const list = (raw.synkkaData as { nutritionalContent?: { id?: string; value?: unknown }[] } | undefined)?.nutritionalContent;
  const n = Array.isArray(list) ? list.find((x) => x?.id === id && typeof x.value === "number") : undefined;
  return n ? Math.round((n.value as number) * 10) / 10 : undefined;
};

export type ModelInput = {
  id: string;
  /** One line per product, the only thing the model sees about it. */
  line: string;
};

/** The line for one product: id | name | other-language name | brand | pack | storage | key ingredients | text | per-100 g figures. */
export function modelInput(raw: Record<string, unknown>, p: IndexedProduct): ModelInput {
  const s = (raw.synkkaData ?? {}) as Record<string, unknown>;
  const name = p.names.en ?? p.names.fi ?? p.names.sv ?? p.id;
  const alt = p.names.en && p.names.fi ? p.names.fi : undefined;
  const ingredients = pick(s.keyIngredients, 160);
  const marketing = pick(s.marketingTexts, 150);
  const usage = pick(s.usageInstructions, 90) ?? pick(s.preparationInstructions, 90);
  const per100 = [
    ["fat", nutrient(raw, "FAT")],
    ["sugar", nutrient(raw, "SUGAR-")],
    ["protein", nutrient(raw, "PRO-")],
  ]
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const parts = [
    p.id,
    clean(name, 110),
    alt ? `fi: ${clean(alt, 80)}` : undefined,
    p.brand ? `brand ${clean(p.brand, 30)}` : undefined,
    p.pack.label ? `pack ${clean(p.pack.label, 40)}` : undefined,
    p.temperature.class ? `stored ${p.temperature.class}` : undefined,
    ingredients ? `ingredients: ${ingredients}` : undefined,
    marketing ? `text: ${marketing}` : undefined,
    usage ? `use: ${usage}` : undefined,
    per100 ? `per 100: ${per100}` : undefined,
  ].filter(Boolean);
  return { id: p.id, line: parts.join(" | ") };
}

/** The short name line used for the category taxonomy pass. */
export function nameLine(p: IndexedProduct): string {
  return clean(p.names.en ?? p.names.fi ?? p.names.sv ?? p.id, 80);
}
