import { z } from "zod";
import { DockError } from "@/core/errors";
import type { Mandate } from "@/core/mandate";
import { categorySlug } from "@/core/catalog/partner";
import { NutritionRuleSchema } from "@/core/nutrition";
import { KNOWN_LABELS } from "@/core/vocabulary";
import { addDays } from "@/core/util";
import generated from "../catalog-categories.json";

/**
 * What a kitchen signs when it opens an account, in the mandate's own vocabulary: how much its agent may spend
 * alone per order, a weekly budget nothing can exceed, the product groups it may buy, the claims every product
 * must carry and the allergens none may contain, and who signs off above the limit. `mandateFromTerms` turns the
 * terms into the signed mandate the gate checks. The same form edits them later, from Agent and rules.
 */

const DATA = generated as { departments: Record<string, string>; categories: Record<string, { label: string }> };

/** The shop's departments as product groups; the two household departments are one group. */
export const PRODUCT_GROUPS: { id: string; name: string; prefixes: string[] }[] = (() => {
  const byName = new Map<string, string[]>();
  for (const [prefix, name] of Object.entries(DATA.departments)) byName.set(name, [...(byName.get(name) ?? []), prefix]);
  return [...byName.entries()].map(([name, prefixes]) => ({ id: prefixes[0], name, prefixes }));
})();

/** Claims a kitchen can require of every product (core/vocabulary.ts slugs). */
export const REQUIRE_CLAIMS = ["lactose_free", "gluten_free", "organic", "vegan", "vegetarian"] as const;
/** Allergens a kitchen can rule out (the catalogue's slugs, core/catalog/partner.ts). */
export const FORBID_ALLERGENS = ["nuts", "peanuts", "gluten", "milk", "eggs", "fish", "crustaceans", "molluscs", "sesame", "soy", "celery", "mustard", "lupin", "sulphites"] as const;
export const SUBSTITUTION_RULES = ["within_preferences", "needs_approval", "none"] as const;
/** Labels a kitchen can require of every product or prefer (core/vocabulary.ts KNOWN_LABELS; origin_fi: Finland as the stated origin). */
export const LABEL_CHOICES = KNOWN_LABELS;

export const TermsSchema = z
  .object({
    perOrderLimitEur: z.number().int().min(0).max(50_000),
    weeklyBudgetEur: z.number().int().min(10).max(200_000),
    groups: z.array(z.enum(PRODUCT_GROUPS.map((g) => g.id) as [string, ...string[]])).min(1).max(PRODUCT_GROUPS.length),
    require: z.array(z.enum(REQUIRE_CLAIMS)).max(REQUIRE_CLAIMS.length),
    forbid: z.array(z.enum(FORBID_ALLERGENS)).max(FORBID_ALLERGENS.length),
    signer: z.string().trim().min(2).max(60),
    substitution: z.enum(SUBSTITUTION_RULES),
    maxLeadDays: z.number().int().min(1).max(30),
    /** Nutrition rules, checked by the gate beside the allergen rules (core/nutrition.ts). Absent: none. */
    nutrition: z.array(NutritionRuleSchema).max(20).optional(),
    /** Labels every product must carry, and labels the agent should prefer (ranked first, the price of them said). */
    labels: z.object({ require: z.array(z.enum(KNOWN_LABELS as [string, ...string[]])).max(KNOWN_LABELS.length).default([]), prefer: z.array(z.enum(KNOWN_LABELS as [string, ...string[]])).max(KNOWN_LABELS.length).default([]) }).optional(),
  })
  .refine((t) => t.weeklyBudgetEur >= t.perOrderLimitEur, { message: "The weekly budget must be at least the per-order limit.", path: ["weeklyBudgetEur"] });

export type MandateTerms = z.infer<typeof TermsSchema>;

/** What the form starts with: a mid-size kitchen buying dairy, bakery, produce, dry goods and frozen. */
export const DEFAULT_TERMS: MandateTerms = {
  perOrderLimitEur: 300,
  weeklyBudgetEur: 3_000,
  groups: ["10", "11", "17", "21", "22", "41"].filter((id) => PRODUCT_GROUPS.some((g) => g.id === id)),
  require: [],
  forbid: [],
  signer: "Head chef",
  substitution: "within_preferences",
  maxLeadDays: 7,
};

/** Parse terms from a request body; 400 with the first problem in words. */
export function parseTerms(raw: unknown): MandateTerms {
  const r = TermsSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new DockError(400, "terms_invalid", `${first?.path.join(".") || "terms"}: ${first?.message ?? "not valid"}`);
  }
  const t = r.data;
  const labels = t.labels ? { require: [...new Set(t.labels.require)], prefer: [...new Set(t.labels.prefer)].filter((l) => !t.labels!.require.includes(l)) } : undefined;
  return { ...t, groups: [...new Set(t.groups)], require: [...new Set(t.require)], forbid: [...new Set(t.forbid)], ...(labels ? { labels } : {}) };
}

/** The catalogue categories (product.category slugs) a set of product groups covers. */
export function categoriesOf(groups: string[]): string[] {
  const prefixes = new Set(PRODUCT_GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) => g.prefixes));
  const out = new Set<string>();
  for (const code of Object.keys(DATA.categories)) if (prefixes.has(code.slice(0, 2))) out.add(categorySlug(code));
  return [...out].sort();
}

/** The role every account kitchen's signer fills in its mandate. */
export const SIGNER_ROLE = "kitchen_signer";
/** How long an account kitchen's mandate is valid; it is re-signed on use before it runs out. */
export const MANDATE_DAYS = 30;

export function mandateFromTerms(t: MandateTerms, o: { orgId: string; orgName: string; agentId: string; now: Date; seq: number }): Mandate {
  const stamp = o.now.toISOString().replace(/\D/g, "").slice(0, 14);
  return {
    mandateId: `mnd_${o.orgId.replace(/^org_/, "")}_${stamp}_${o.seq}`,
    issuer: { orgId: o.orgId, name: o.orgName },
    agentId: o.agentId,
    validFrom: new Date(o.now.getTime() - 60_000).toISOString(),
    validUntil: addDays(o.now, MANDATE_DAYS).toISOString(),
    currency: "EUR",
    perOrderLimitCents: t.perOrderLimitEur * 100,
    weeklyBudgetCents: t.weeklyBudgetEur * 100,
    allowedCategories: categoriesOf(t.groups),
    requiredAttributes: [...t.require],
    forbiddenAllergens: [...t.forbid],
    requiredCertificates: [...(t.labels?.require ?? [])],
    ...(t.nutrition?.length ? { nutritionRules: t.nutrition.map((r) => ({ ...r })) } : {}),
    ...(t.labels?.prefer.length ? { preferredLabels: [...t.labels.prefer] } : {}),
    delivery: { maxLeadDays: t.maxLeadDays },
    substitution: { rule: t.substitution, maxPriceIncreasePct: 10 },
    approvers: [{ role: SIGNER_ROLE, name: t.signer, maxApprovalCents: t.weeklyBudgetEur * 100 }],
  };
}

/** The terms a mandate says, for a visitor's kitchen being kept (its groups become the departments its categories sit in). */
export function termsFromMandate(m: Mandate): MandateTerms {
  const groups = PRODUCT_GROUPS.filter((g) => categoriesOf([g.id]).some((c) => m.allowedCategories.includes(c))).map((g) => g.id);
  return {
    perOrderLimitEur: Math.round(m.perOrderLimitCents / 100),
    weeklyBudgetEur: Math.max(Math.round(m.weeklyBudgetCents / 100), Math.round(m.perOrderLimitCents / 100), 10),
    groups: groups.length ? groups : ["10"],
    require: m.requiredAttributes.filter((a): a is (typeof REQUIRE_CLAIMS)[number] => (REQUIRE_CLAIMS as readonly string[]).includes(a)),
    forbid: m.forbiddenAllergens.filter((a): a is (typeof FORBID_ALLERGENS)[number] => (FORBID_ALLERGENS as readonly string[]).includes(a)),
    signer: m.approvers[0]?.name ?? DEFAULT_TERMS.signer,
    substitution: (SUBSTITUTION_RULES as readonly string[]).includes(m.substitution.rule) ? (m.substitution.rule as MandateTerms["substitution"]) : "within_preferences",
    maxLeadDays: Math.min(30, m.delivery.maxLeadDays),
    ...(m.nutritionRules?.length ? { nutrition: m.nutritionRules.map((r) => ({ ...r })) } : {}),
    ...(m.requiredCertificates.length || m.preferredLabels?.length
      ? { labels: { require: m.requiredCertificates.filter((l) => (KNOWN_LABELS as readonly string[]).includes(l)), prefer: (m.preferredLabels ?? []).filter((l) => (KNOWN_LABELS as readonly string[]).includes(l)) } }
      : {}),
  };
}
