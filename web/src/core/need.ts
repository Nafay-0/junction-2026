import { z } from "zod";
import { normaliseAllergen, normaliseWantedTag } from "./vocabulary";

/**
 * The structured need: what a buyer wants, in fields rather than words. An LLM (outside core/) turns free
 * text into this; everything after it is plain code. Units:
 *   L, kg, pcs   base units, as products are measured (litres of milk, kilos of yoghurt)
 *   pack         the product's sales pack (a case, a 10 L bag-in-box); needs a pack size to mean anything
 */
export const NEED_UNITS = ["L", "kg", "pcs", "pack"] as const;
export type NeedUnit = (typeof NEED_UNITS)[number];
export type BaseUnit = "L" | "kg" | "pcs";

export const OPTIMISE_GOALS = ["price", "co2", "reliability"] as const;
export type OptimiseGoal = (typeof OPTIMISE_GOALS)[number];

const tag = z.string().min(1).max(60);

export const NeedSchema = z
  .object({
    /** The buyer's own words, kept for the audit trail. */
    text: z.string().min(1).max(2000).optional(),
    item: z.object({
      text: z.string().min(1).max(200), // "lactose-free milk"
      category: tag.optional(), // "milk"
      attributes: z.array(tag).max(10).default([]), // wanted: "fat_1_5"
      excludedAttributes: z.array(tag).max(10).default([]), // explicitly not wanted: "lactose_free" for "ordinary milk"
      productId: tag.optional(), // a specific product the buyer named
    }),
    quantity: z.object({ amount: z.number().positive().max(1_000_000), unit: z.enum(NEED_UNITS) }).optional(),
    deliverBy: z.iso.date().optional(), // latest acceptable delivery date
    requiredClaims: z.array(tag).max(10).default([]), // "lactose_free", "organic"
    requiredLabels: z.array(tag).max(10).default([]), // certificates and labels: "hyvaa_suomesta", "msc"
    forbiddenAllergens: z.array(tag).max(10).default([]),
    /** unstated: the buyer said nothing; no_preference: asked, and said it does not matter. */
    optimise: z.enum([...OPTIMISE_GOALS, "no_preference", "unstated"]).default("unstated"),
    /** "Same as last time": repeat the kitchen's last order of this product family. */
    sameAsLastTime: z.boolean().default(false),
  })
  .refine((n) => n.quantity || n.sameAsLastTime, { message: "quantity is required unless sameAsLastTime is true", path: ["quantity"] })
  .refine((n) => !n.item.attributes.some((a) => n.item.excludedAttributes.includes(a)), {
    message: "an attribute cannot be both wanted and excluded",
    path: ["item", "excludedAttributes"],
  });

export type StructuredNeed = z.infer<typeof NeedSchema>;
export type NeedInput = z.input<typeof NeedSchema>;

/**
 * Put a need in the catalogue's words: "lactose-free" and "FREE_FROM_LACTOSE" become lactose_free, "nut free"
 * becomes a forbidden allergen, "Hyvää Suomesta" a required label. Returns the need and one line per change,
 * for the ledger. Idempotent.
 */
export function normaliseNeed(need: StructuredNeed): { need: StructuredNeed; changes: string[] } {
  const n = structuredClone(need);
  const changes: string[] = [];
  const claims = new Set<string>();
  const labels = new Set(n.requiredLabels.map((l) => normaliseWantedTag(l).value));
  const forbidden = new Set(n.forbiddenAllergens.map(normaliseAllergen));
  const route = (tag: string, into: Set<string>) => {
    const t = normaliseWantedTag(tag);
    const target = t.kind === "label" ? labels : t.kind === "forbid_allergen" ? forbidden : into;
    target.add(t.value);
    if (t.value !== tag || t.kind !== "claim") changes.push(`"${tag}" read as ${t.kind === "label" ? "label" : t.kind === "forbid_allergen" ? "no" : "claim"} ${t.value}`);
  };
  for (const c of n.requiredClaims) route(c, claims);
  const attrs = new Set<string>();
  for (const a of n.item.attributes) route(a, attrs);
  n.item.excludedAttributes = [...new Set(n.item.excludedAttributes.map((a) => normaliseWantedTag(a).value))];
  for (const a of n.forbiddenAllergens) if (normaliseAllergen(a) !== a) changes.push(`allergen "${a}" read as ${normaliseAllergen(a)}`);
  n.requiredClaims = [...claims];
  n.item.attributes = [...attrs].filter((a) => !n.item.excludedAttributes.includes(a) && !claims.has(a));
  n.requiredLabels = [...labels];
  n.forbiddenAllergens = [...forbidden];
  return { need: NeedSchema.parse(n), changes };
}

/** One-tap edit to a need. `null` removes an optional field. */
export type NeedPatch = {
  quantity?: { amount: number; unit: NeedUnit };
  deliverBy?: string | null;
  item?: { productId?: string | null; attributes?: string[]; excludedAttributes?: string[] };
  requiredClaims?: string[];
  sameAsLastTime?: boolean;
};

export function applyNeedPatch(need: StructuredNeed, patch: NeedPatch): StructuredNeed {
  const next = structuredClone(need);
  if (patch.quantity) next.quantity = { ...patch.quantity };
  if (patch.deliverBy === null) delete next.deliverBy;
  else if (patch.deliverBy) next.deliverBy = patch.deliverBy;
  if (patch.item) {
    if (patch.item.productId === null) delete next.item.productId;
    else if (patch.item.productId) next.item.productId = patch.item.productId;
    if (patch.item.attributes) next.item.attributes = [...patch.item.attributes];
    if (patch.item.excludedAttributes) next.item.excludedAttributes = [...patch.item.excludedAttributes];
  }
  if (patch.requiredClaims) next.requiredClaims = [...patch.requiredClaims];
  if (patch.sameAsLastTime !== undefined) next.sameAsLastTime = patch.sameAsLastTime;
  return NeedSchema.parse(next);
}

/**
 * Specification dimensions: the choices that change which product is right, and that a buyer may not
 * have said. The product data has no notion of these, so they are derived here from attribute tags.
 * `none` is the value for a product carrying none of the listed attributes (regular milk, not organic).
 */
/** `optIn`: a buyer who wants it says so (organic); a request that says nothing accepts either, so Dock does not ask. */
/** `mustAsk`: guessing it would make every option wrong or unsafe, so it is asked before any lookup (none today). */
export type SpecDimension = { id: string; question: string; values: { attribute: string; label: string }[]; noneLabel?: string; optIn?: boolean; mustAsk?: boolean };

export const SPEC_DIMENSIONS: SpecDimension[] = [
  { id: "lactose", question: "Lactose-free or regular?", values: [{ attribute: "lactose_free", label: "Lactose-free" }], noneLabel: "Regular (contains lactose)" },
  {
    id: "fat",
    question: "Which fat content?",
    values: [
      { attribute: "fat_free", label: "Fat-free (0.1 %)" },
      { attribute: "fat_1_5", label: "Semi-skimmed (1.5 %)" },
      { attribute: "fat_3_5", label: "Whole (3.5 %)" },
    ],
  },
  { id: "organic", question: "Organic?", values: [{ attribute: "organic", label: "Organic" }], noneLabel: "Not organic", optIn: true },
];

export const NONE = "none";

/** Which value of a dimension a set of attributes has: an attribute, "none", or undefined if the dimension has no "none". */
export function dimensionValue(dim: SpecDimension, attributes: readonly string[]): string | undefined {
  const hit = dim.values.find((v) => attributes.includes(v.attribute));
  if (hit) return hit.attribute;
  return dim.noneLabel ? NONE : undefined;
}

export function dimensionLabel(dim: SpecDimension, value: string): string {
  if (value === NONE) return dim.noneLabel ?? "None";
  return dim.values.find((v) => v.attribute === value)?.label ?? value;
}

export function formatAmount(amount: number, unit: NeedUnit | BaseUnit): string {
  const n = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit === "pack") return `${n} pack${amount === 1 ? "" : "s"}`;
  if (unit === "pcs") return `${n} pcs`;
  return `${n} ${unit}`;
}

/** One plain-language line for the ledger and the UI. */
export function describeNeed(n: StructuredNeed): string {
  const parts = [n.quantity ? `${formatAmount(n.quantity.amount, n.quantity.unit)} of ${n.item.text}` : `${n.item.text} (same amount as last time)`];
  const claims = [...n.requiredClaims, ...n.item.attributes];
  if (claims.length) parts.push(`must be ${claims.join(", ")}`);
  if (n.requiredLabels.length) parts.push(`labelled ${n.requiredLabels.join(", ")}`);
  if (n.item.excludedAttributes.length) parts.push(`not ${n.item.excludedAttributes.join(", ")}`);
  if (n.item.productId) parts.push(`product ${n.item.productId}`);
  if (n.forbiddenAllergens.length) parts.push(`no ${n.forbiddenAllergens.join(", ")}`);
  if (n.deliverBy) parts.push(`deliver by ${n.deliverBy}`);
  if (n.sameAsLastTime) parts.push("same as last time");
  parts.push(n.optimise === "unstated" ? "nothing said about price or CO2" : `optimise: ${n.optimise.replace("_", " ")}`);
  return parts.join("; ");
}
