import { FAMILIES, FORMS, STATES, USES } from "../vocab";

/**
 * Prompts and JSON schemas for the two model passes of the knowledge build. Strict structured output: every
 * answer is an enum or a short string, and the build validates it again in code.
 *
 *   1. taxonomy  one call per partner category: the names in it -> a short list of kinds (what a cook would call them)
 *   2. profile   batches of ~25 products of one category -> kind (from that category's list), form, state, a few
 *                functional properties, and the uses each product suits
 *
 * Neither pass is asked about dietary claims, allergens, origin, labels or nutrition: those are read from the data.
 */

export type JsonSchema = Record<string, unknown>;

const str = { type: "string" } as const;
const nullableBool = { anyOf: [{ type: "boolean" }, { type: "null" }] } as const;
const obj = (properties: Record<string, unknown>): JsonSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown): JsonSchema => ({ type: "array", items });
const enumOf = (values: readonly string[]) => ({ type: "string", enum: [...values] });

// ---------- pass 1: taxonomy ----------

export const TAXONOMY_SYSTEM = `You organise a food-service wholesaler's assortment for professional kitchens.
You get the product names of ONE assortment category. Propose the kinds of product in it, in the terms a professional cook uses when deciding whether one product can replace another.

Rules:
- A kind groups products that a cook would accept as interchangeable for most uses, ignoring brand, pack size, and dietary claims (lactose-free, gluten-free, organic, vegan are handled separately, never put them in a kind).
- Split where it matters in the kitchen: fat level of milk (skimmed, semi-skimmed, whole), cream by function (whipping cream, cooking cream, coffee cream, sour cream), cheese by use (hard grating cheese, sliceable semi-hard cheese, melting cheese, fresh soft cheese, blue cheese), flour by grain and grade, fresh versus frozen versus canned where products differ that way, sweetened or flavoured versus plain.
- Do not split by brand, pack size or minor flavour variety unless the flavour changes how it can be used (vanilla yoghurt vs plain yoghurt: split; strawberry vs raspberry jam: one kind).
- Usually 3 to 25 kinds. Every product name must fit one kind. Add one catch-all kind only if needed.
- slug: lowercase english with underscores (semi_skimmed_milk). label: short english kitchen term (semi-skimmed milk). family: the closest broad family. aliases: up to 4 search words a cook might type, english and finnish, lowercase.`;

export function taxonomyUser(categoryCode: string, names: string[]): string {
  return `Category ${categoryCode}, ${names.length} products:\n${names.map((n) => `- ${n}`).join("\n")}`;
}

export const TAXONOMY_SCHEMA: JsonSchema = obj({
  kinds: arr(obj({ slug: str, label: str, family: enumOf(FAMILIES), aliases: arr(str) })),
});

export type TaxonomyAnswer = { kinds: { slug: string; label: string; family: string; aliases: string[] }[] };

// ---------- pass 2: product profiles ----------

export const PROFILE_SYSTEM = `You describe food-service products for professional kitchens, so a purchasing agent can suggest good alternatives.
Each input line is one product: id | name | other names | brand | pack | storage | ingredients | text | use | nutrition per 100 g or ml.
For EVERY product return:
- kind: the best matching kind from the list given (by slug).
- form: the physical form or cut.
- state: fresh (raw/unprocessed perishable), chilled_processed (chilled, processed, e.g. dairy, cold cuts), frozen, shelf_stable (ambient, canned, UHT), dried.
- whips: true if it can be whipped to peaks (whipping cream, some plant whipping products, aquafaba), false if it cannot, null if whipping is irrelevant for this kind.
- heat_stable: true if it can be boiled or baked without splitting or curdling, false if it splits or curdles when boiled, null if irrelevant.
- melts: true if it melts smoothly in hot dishes (pizza, gratin), false if it does not, null if irrelevant.
- sweetened: true if sugar or sweetener is added, false if plain, null if irrelevant.
- flavoured: true if flavoured (vanilla, fruit, spices, smoked), false if plain or natural, null if irrelevant.
- uses: 1 to 6 uses this product suits in a professional kitchen, most typical first. Only uses a cook would really use it for.
Judge only from the line given and general culinary knowledge. Never infer dietary or allergen properties; they are not asked.`;

export function profileUser(categoryCode: string, kinds: { slug: string; label: string }[], lines: string[]): string {
  return `Category ${categoryCode}. Kinds: ${kinds.map((k) => `${k.slug} (${k.label})`).join("; ")}.\nProducts:\n${lines.join("\n")}`;
}

export function profileSchema(kindSlugs: string[]): JsonSchema {
  return obj({
    products: arr(
      obj({
        id: str,
        kind: enumOf(kindSlugs),
        form: enumOf(FORMS),
        state: enumOf(STATES),
        whips: nullableBool,
        heat_stable: nullableBool,
        melts: nullableBool,
        sweetened: nullableBool,
        flavoured: nullableBool,
        uses: arr(enumOf(USES)),
      }),
    ),
  });
}

export type ProfileAnswer = {
  products: {
    id: string;
    kind: string;
    form: string;
    state: string;
    whips: boolean | null;
    heat_stable: boolean | null;
    melts: boolean | null;
    sweetened: boolean | null;
    flavoured: boolean | null;
    uses: string[];
  }[];
};
