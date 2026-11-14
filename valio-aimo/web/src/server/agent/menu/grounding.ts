import { addFacts, addWords, emptyFacts, type Facts } from "@/core/grounding";
import { groundFields } from "@/server/grounding";
import type { MenuKitchen } from "./kitchens";
import type { PlanLineView, PlanView } from "./plan";
import type { PlanRecord } from "./service";

/**
 * The menu planner's model-written text, checked against the data before a screen shows it (core/grounding.ts):
 * the dishes' names, portions and methods, the assumptions and warnings, each line's roles and amount reasons, the
 * name check's notes and the model's proposals for stuck lines. Evidence: the chef's own words, the products the
 * catalogue search found (names, brands, claims, allergens, packs), the plan's own figures (amounts with their
 * working, prices, dates) and the kitchen's mandate. A sentence that names a product, price, amount, date, claim
 * or allergen none of these backs is replaced by "The data does not say."
 */

/** Fields the model wrote: never evidence for themselves. */
const MODEL_KEYS = new Set(["roles", "role", "basis", "amountBasis", "fitNotes", "fixes", "method", "portion", "assumptions", "conflicts", "declineReason", "occasion", "searchTerms", "warnings"]);

function stripModelText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripModelText);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !MODEL_KEYS.has(k)).map(([k, v]) => [k, stripModelText(v)]));
  return value;
}

export function planFacts(record: PlanRecord, view: PlanView, kitchen: MenuKitchen): Facts {
  const f = emptyFacts();
  addWords(f, record.text);
  for (const set of Object.values(record.candidates ?? {})) {
    for (const c of set?.candidates ?? []) {
      const p = c.product;
      addFacts(f, { name: p.name, names: p.names, brand: p.brand, attributes: p.attributes, allergens: p.allergens, allergenInfo: p.allergenInfo, packSize: p.packSize, unit: p.unit, packContent: p.packContent, safety: c.safety });
    }
  }
  addFacts(f, stripModelText(view));
  // Plain code's verdicts on the model's proposals (product, packs, price, date) are data; the proposals' words are not.
  addFacts(f, view.lines.flatMap((l) => l.fixes.map((x) => ({ check: x.check, perCover: x.perCover, ingredient: x.ingredient ? { perCover: x.ingredient.perCover, yieldPct: x.ingredient.yieldPct } : undefined }))));
  addFacts(f, { settings: record.settings, covers: record.draft.covers, serviceDate: record.draft.serviceDate, dishDates: record.draft.dishes.map((d) => d.serviceDate) });
  const m = kitchen.mandate;
  addFacts(f, { forbiddenAllergens: m.forbiddenAllergens, requiredAttributes: m.requiredAttributes, perOrderLimitCents: m.perOrderLimitCents, weeklyBudgetCents: m.weeklyBudgetCents, kitchen: kitchen.info });
  return f;
}

export type GroundedPlanText = {
  draft: { assumptions: string[]; conflicts: string[]; occasion: string | null; declineReason: string | null; dishes: { name: string; nameFi: string | null; portion: string; method: string }[] };
  lines: PlanLineView[];
};

/** Checked once per version of a plan (planId + updatedAt), so polling a plan does not count the same fire again. */
const cache = new Map<string, GroundedPlanText>();
const MAX_CACHE = 200;

export function groundPlanText(record: PlanRecord, view: PlanView, kitchen: MenuKitchen, brands: string[] = []): GroundedPlanText {
  const key = `${record.planId}:${record.updatedAt}:${view.lines.length}:${view.totals.totalCents}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const facts = planFacts(record, view, kitchen);
  const opts = { brands, where: `menu plan ${record.planId}` };
  const d = record.draft;
  // The model's estimates (portion sizes, the working behind a per-cover amount, its assumptions) are shown as
  // estimates the chef edits: their amounts are its own, so only products, prices, dates, claims and allergens in
  // them are judged. Everything else it wrote is judged in full.
  const estimate = { ...opts, numbers: false };
  const [occasion, declineReason, ...conflicts] = groundFields("menu", [d.occasion ?? "", record.declineReason ?? d.declineReason ?? "", ...d.conflicts], facts, { ...opts, sentences: true });
  const assumptions = groundFields("menu", d.assumptions, facts, { ...estimate, sentences: true });
  const dishes = d.dishes.map((x) => {
    const [name, nameFi] = groundFields("menu", [x.name, x.nameFi ?? ""], facts, opts);
    const [portion] = groundFields("menu", [x.portion], facts, estimate);
    const [method] = groundFields("menu", [x.method], facts, { ...opts, sentences: true });
    return { name, nameFi: x.nameFi === null ? null : nameFi, portion, method };
  });
  const lines = view.lines.map((l) => {
    const roles = groundFields("menu", l.roles, facts, opts);
    const uses = l.uses.map((u) => {
      const [role] = groundFields("menu", [u.role], facts, opts);
      const [basis] = groundFields("menu", [u.basis], facts, estimate);
      return { ...u, role, basis };
    });
    const chosen = l.chosen ? { ...l.chosen, fitNotes: groundFields("menu", l.chosen.fitNotes, facts, { ...opts, sentences: true }) } : undefined;
    const fixes = l.fixes.map((x) => {
      if (x.source !== "model") return x;
      const [title, effect] = groundFields("menu", [x.title, x.effect], facts, { ...opts, sentences: true });
      return { ...x, title, effect };
    });
    return { ...l, roles, uses, ...(chosen ? { chosen } : {}), fixes };
  });
  const out: GroundedPlanText = { draft: { assumptions, conflicts, occasion: d.occasion === null ? null : occasion, declineReason: (record.declineReason ?? d.declineReason) ? declineReason : null, dishes }, lines };
  cache.set(key, out);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return out;
}
