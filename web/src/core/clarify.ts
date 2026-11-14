import { nutritionFindings, ruleText, type NutritionRule } from "./nutrition";
import { allergenOf, forbiddenPresent, holdsLabel } from "./vocabulary";
import { z } from "zod";
import type { Product } from "./catalog";
import { memoryItemIdOf, type Evidence, type LearnedPreference, type StatedPreference } from "./kitchen";
import type { Mandate } from "./mandate";
import { NONE, SPEC_DIMENSIONS, dimensionLabel, dimensionValue, type OptimiseGoal, type SpecDimension, type StructuredNeed } from "./need";

/**
 * What must be true of every product Dock offers (hard constraints), and which questions are worth asking
 * about the rest. Hard constraints come from the mandate, the request itself and preferences a person
 * stated. Learned habits are not here: they only pre-select answers (see `clarify`).
 */

export type ConstraintSource = { text: string; source: "mandate" | "request" | "stated"; preferenceId?: string };

export type HardConstraints = {
  categories: string[];
  requiredAttributes: string[];
  excludedAttributes: string[];
  forbiddenAllergens: string[];
  requiredCertificates: string[];
  /** The mandate's nutrition rules (core/nutrition.ts): a product that breaks one, or does not declare the figure, is not offered. */
  nutritionRules: NutritionRule[];
  sources: ConstraintSource[];
  /** "declared": a forbidden allergen is ruled out only by the maker's data (the mandate's allergenEvidence). */
  allergenEvidence?: "declared" | "declared_or_nature";
};

const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function hardConstraints(mandate: Mandate, need: StructuredNeed, stated: StatedPreference[], suspended: string[] = []): HardConstraints {
  const c: HardConstraints = {
    categories: [...mandate.allowedCategories],
    requiredAttributes: [...mandate.requiredAttributes],
    excludedAttributes: [],
    forbiddenAllergens: [...mandate.forbiddenAllergens],
    requiredCertificates: [...mandate.requiredCertificates],
    nutritionRules: [...(mandate.nutritionRules ?? [])],
    sources: [],
    ...(mandate.allergenEvidence ? { allergenEvidence: mandate.allergenEvidence } : {}),
  };
  const add = (text: string, source: ConstraintSource["source"], preferenceId?: string) => c.sources.push({ text, source, preferenceId });
  add(`Mandate: categories ${mandate.allowedCategories.join(", ")}`, "mandate");
  if (mandate.requiredAttributes.length) add(`Mandate: must be ${mandate.requiredAttributes.join(", ")}`, "mandate");
  if (mandate.forbiddenAllergens.length) add(`Mandate: never ${mandate.forbiddenAllergens.join(", ")}`, "mandate");
  if (mandate.requiredCertificates.length) add(`Mandate: must carry ${mandate.requiredCertificates.join(", ")}`, "mandate");
  for (const r of c.nutritionRules) add(`Mandate: ${ruleText(r)}`, "mandate");

  const wanted = [...need.requiredClaims, ...need.item.attributes];
  if (wanted.length) add(`Request: must be ${wanted.join(", ")}`, "request");
  if (need.item.excludedAttributes.length) add(`Request: not ${need.item.excludedAttributes.join(", ")}`, "request");
  if (need.forbiddenAllergens.length) add(`Request: no ${need.forbiddenAllergens.join(", ")}`, "request");
  if (need.requiredLabels?.length) add(`Request: labelled ${need.requiredLabels.join(", ")}`, "request");
  c.requiredCertificates.push(...(need.requiredLabels ?? []));
  c.requiredAttributes.push(...wanted);
  c.excludedAttributes.push(...need.item.excludedAttributes);
  c.forbiddenAllergens.push(...need.forbiddenAllergens);

  for (const p of stated) {
    if (suspended.includes(p.id)) continue;
    if (p.kind === "require_claim") c.requiredAttributes.push(p.claim);
    else if (p.kind === "forbid_allergen") c.forbiddenAllergens.push(p.allergen);
    else if (p.kind === "dimension" && p.choice !== "no_preference") {
      const dim = SPEC_DIMENSIONS.find((d) => d.id === p.dimension);
      if (!dim) continue;
      if (p.choice === NONE) c.excludedAttributes.push(...dim.values.map((v) => v.attribute));
      else c.requiredAttributes.push(p.choice);
    } else continue;
    add(`Stated by ${p.statedBy}: ${p.text}`, "stated", p.id);
  }
  c.requiredAttributes = uniq(c.requiredAttributes);
  c.excludedAttributes = uniq(c.excludedAttributes);
  c.forbiddenAllergens = uniq(c.forbiddenAllergens);
  c.requiredCertificates = uniq(c.requiredCertificates);
  return c;
}

/** Why a product may not be offered, or undefined if it may. */
export function violation(p: Product, c: HardConstraints): string | undefined {
  if (!c.categories.includes(p.category)) return `category ${p.category} is not in the mandate`;
  const missing = c.requiredAttributes.filter((a) => !p.attributes.includes(a));
  if (missing.length) return `not ${missing.join(", ")}`;
  const excluded = c.excludedAttributes.filter((a) => p.attributes.includes(a));
  if (excluded.length) return `is ${excluded.join(", ")}`;
  const unmapped = c.forbiddenAllergens.filter((a) => !allergenOf(a));
  if (unmapped.length) return `cannot be checked for ${unmapped.join(", ")}: no product data speaks of it`;
  const allergens = forbiddenPresent({ present: p.allergens, claims: p.attributes }, c.forbiddenAllergens);
  if (allergens.length) return `contains ${allergens.join(", ")}`;
  if (c.forbiddenAllergens.length && p.allergenInfo?.declared === false) {
    // Fresh, whole produce contains what it is itself (catalog/nature.ts), unless declared data only is asked for.
    const nature = c.allergenEvidence === "declared" ? undefined : p.allergenInfo.byNature;
    if (!nature) return `no allergen data from its maker, so it cannot be shown free of ${c.forbiddenAllergens.join(", ")}`;
    const found = forbiddenPresent({ present: nature.allergens, claims: p.attributes }, c.forbiddenAllergens);
    if (found.length) return `contains ${found.join(", ")} by its nature`;
  }
  // Nutrition has no "by nature" shortcut: a figure the maker did not declare is unknown, never compliant.
  const nutrition = nutritionFindings(c.nutritionRules ?? [], { productId: p.id, category: p.category, nutrition: p.nutrition });
  if (nutrition.length) return nutrition[0].reason.replace(new RegExp(`^${p.id} `), "");
  const certs = c.requiredCertificates.filter((x) => !holdsLabel(p, x));
  if (certs.length) return `lacks ${certs.join(", ")}`;
  return undefined;
}

// ---------- clarification ----------

/**
 * Products of another kind than asked: coffee milk, sour milk and portion cups share the word "milk" and the
 * category with plain milk, but a kitchen asking for milk does not want them. Kinds come from the product names
 * (see catalog/search.ts); a product without kinds (the seed) is never excluded here.
 */
export function kindMismatch(p: Product, wantedKinds: readonly string[]): string | undefined {
  const extra = (p.kinds ?? []).filter((k) => !wantedKinds.includes(k));
  return extra.length ? `a different kind of product (${extra.join(", ").replace("fermented", "sour or fermented milk")}) than asked` : undefined;
}

/** At most two questions for the common case: more and people stop answering and start guessing. */
export const MAX_QUESTIONS = 2;
export const OPTIMISE_QUESTION_ID = "optimise";
export const NO_PREFERENCE = "no_preference";

export type QuestionOption = { id: string; label: string };
export type Question = { id: string; kind: "dimension" | "optimise"; text: string; options: QuestionOption[]; dimension?: string };
export const answerSchema = z.object({ questionId: z.string().min(1), optionId: z.string().min(1), remember: z.boolean().optional() });
export type Answer = z.infer<typeof answerSchema>;

/** An answer Dock did not ask for because the kitchen's memory gave it. Learned ones can be changed by answering the question. */
export type MemoryNote = {
  question: Question;
  optionId: string;
  label: string;
  source: "stated" | "learned";
  text: string;
  preferenceId?: string;
  evidence?: Evidence;
  /** The typed memory item that gave the answer (a rule projected to a stated preference, or a remembered habit). */
  memoryItemId?: string;
};

export type Settled = {
  attributes: string[]; // add to the required attributes
  excludedAttributes: string[];
  optimise?: OptimiseGoal | typeof NO_PREFERENCE;
  optimiseWithinPctOfCheapest?: number;
  optimiseSource?: "request" | "answer" | "stated" | "learned";
};

/**
 * questions  asked before any lookup: only dimensions marked `mustAsk` (a fact that would make every option wrong
 *            or unsafe if guessed). None of today's dimensions is one.
 * spanned    dimensions the products differ on and nothing settles (fat content, lactose when unsaid): not asked;
 *            the option cards cover each value instead, and the buyer may still answer them to narrow.
 */
export type Clarification = { questions: Question[]; spanned: Question[]; fromMemory: MemoryNote[]; notAsked: string[]; settled: Settled };

const OPTIMISE_LABELS: Record<OptimiseGoal | typeof NO_PREFERENCE, string> = {
  price: "Lowest price",
  co2: "Lowest CO2 (product-group average)",
  reliability: "Most reliable delivery",
  no_preference: "No preference: show me the options",
};

export function optimiseQuestion(): Question {
  return {
    id: OPTIMISE_QUESTION_ID,
    kind: "optimise",
    text: "What matters most for this order?",
    options: (["price", "co2", "reliability", NO_PREFERENCE] as const).map((id) => ({ id, label: OPTIMISE_LABELS[id] })),
  };
}

export function dimensionQuestion(dim: SpecDimension, values: string[]): Question {
  return {
    id: `dim:${dim.id}`,
    kind: "dimension",
    dimension: dim.id,
    text: dim.question,
    options: [...values.map((v) => ({ id: v, label: dimensionLabel(dim, v) })), { id: NO_PREFERENCE, label: "No preference" }],
  };
}

export function optionLabel(q: Question, optionId: string): string {
  return q.options.find((o) => o.id === optionId)?.label ?? optionId;
}

/**
 * Decide what to ask, which is almost nothing. A dimension the products differ on and that neither the request,
 * an answer nor the kitchen's memory settles is not asked up front: the buyer did not mention it, and it does not
 * change safety (allergens and the mandate's rules are hard constraints, applied before this). The option cards
 * span its values instead, and memory pre-selects. Only a dimension marked `mustAsk` is asked first. What the
 * profile answers is never asked; it is reported in `fromMemory`.
 */
export function clarify(input: {
  need: StructuredNeed;
  candidates: Product[]; // already filtered by the hard constraints
  stated: StatedPreference[];
  learned: LearnedPreference[];
  answers: Answer[];
  suspended?: string[];
}): Clarification {
  const { need, candidates, answers } = input;
  const stated = input.stated.filter((p) => !input.suspended?.includes(p.id));
  const settled: Settled = { attributes: [], excludedAttributes: [] };
  const fromMemory: MemoryNote[] = [];
  const open: { q: Question; spread: number; mustAsk: boolean }[] = [];
  const answerFor = (id: string) => answers.findLast((a) => a.questionId === id);

  const applyDimension = (dim: SpecDimension, choice: string) => {
    if (choice === NO_PREFERENCE) return;
    if (choice === NONE) settled.excludedAttributes.push(...dim.values.map((v) => v.attribute));
    else settled.attributes.push(choice);
  };

  for (const dim of SPEC_DIMENSIONS) {
    const values = [...new Set(candidates.map((p) => dimensionValue(dim, p.attributes)).filter((v): v is string => v !== undefined))];
    values.sort((a, b) => order(dim, a) - order(dim, b));
    if (values.length < 2) continue;
    const valueAttrs = dim.values.map((v) => v.attribute);
    if (dim.optIn && !answerFor(`dim:${dim.id}`) && !stated.some((p) => p.kind === "dimension" && p.dimension === dim.id)) continue; // asked for when wanted
    if (need.item.attributes.some((a) => valueAttrs.includes(a))) continue; // the request says
    if (dim.noneLabel && valueAttrs.every((a) => need.item.excludedAttributes.includes(a))) continue;
    const q = dimensionQuestion(dim, values);
    const answer = answerFor(q.id);
    if (answer) {
      applyDimension(dim, answer.optionId);
      continue;
    }
    const s = stated.find((p) => p.kind === "dimension" && p.dimension === dim.id);
    if (s && s.kind === "dimension") {
      applyDimension(dim, s.choice);
      fromMemory.push({ question: q, optionId: s.choice, label: optionLabel(q, s.choice), source: "stated", text: `${s.text} (set by ${s.statedBy})`, preferenceId: s.id, ...memoryRef(memoryItemIdOf(s.id)) });
      continue;
    }
    const l = input.learned.find((p) => p.kind === "dimension" && p.dimension === dim.id && values.includes(p.choice));
    if (l && l.kind === "dimension") {
      applyDimension(dim, l.choice);
      fromMemory.push({ question: q, optionId: l.choice, label: optionLabel(q, l.choice), source: "learned", text: `Pre-selected from ${l.memoryItemId ? "memory" : "history"}: ${l.text}`, evidence: l.evidence, ...memoryRef(l.memoryItemId) });
      continue;
    }
    open.push({ q, spread: values.length, mustAsk: dim.mustAsk === true });
  }

  const oq = optimiseQuestion();
  const oa = answerFor(oq.id);
  const so = stated.find((p) => p.kind === "optimise");
  const lo = input.learned.find((p) => p.kind === "optimise");
  // The goal is never asked up front: the option cards are labelled best price, lowest carbon and most reliable,
  // so choosing a card answers it. Asking first would cost the buyer a second step for the same answer.
  if (need.optimise !== "unstated") Object.assign(settled, { optimise: need.optimise, optimiseSource: "request" });
  else if (oa) Object.assign(settled, { optimise: oa.optionId as Settled["optimise"], optimiseSource: "answer" });
  else if (so && so.kind === "optimise") {
    Object.assign(settled, { optimise: so.goal, optimiseWithinPctOfCheapest: so.withinPctOfCheapest, optimiseSource: "stated" });
    fromMemory.push({ question: oq, optionId: so.goal, label: optionLabel(oq, so.goal), source: "stated", text: `${so.text} (set by ${so.statedBy})`, preferenceId: so.id, ...memoryRef(memoryItemIdOf(so.id)) });
  } else if (lo && lo.kind === "optimise") {
    Object.assign(settled, { optimise: lo.goal, optimiseSource: "learned" });
    fromMemory.push({ question: oq, optionId: lo.goal, label: optionLabel(oq, lo.goal), source: "learned", text: `Pre-selected from ${lo.memoryItemId ? "memory" : "history"}: ${lo.text}`, evidence: lo.evidence, ...memoryRef(lo.memoryItemId) });
  }

  open.sort((a, b) => b.spread - a.spread);
  const ask = open.filter((o) => o.mustAsk).map((o) => o.q);
  const questions = ask.slice(0, MAX_QUESTIONS);
  const spanned = [...open.filter((o) => !o.mustAsk).map((o) => o.q), ...ask.slice(MAX_QUESTIONS)];
  const notAsked = spanned.map((q) => `${q.text} Not asked: you did not say, so the options show ${q.options.length > 3 ? "each kind" : "both"}.`);
  return { questions, spanned, fromMemory, notAsked, settled };
}

const memoryRef = (id: string | undefined) => (id ? { memoryItemId: id } : {});

function order(dim: SpecDimension, value: string): number {
  const i = dim.values.findIndex((v) => v.attribute === value);
  return i === -1 ? dim.values.length : i;
}
