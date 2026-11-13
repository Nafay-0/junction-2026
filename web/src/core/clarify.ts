import { z } from "zod";
import type { Product } from "./catalog";
import type { Evidence, LearnedPreference, StatedPreference } from "./kitchen";
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
  sources: ConstraintSource[];
};

const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function hardConstraints(mandate: Mandate, need: StructuredNeed, stated: StatedPreference[], suspended: string[] = []): HardConstraints {
  const c: HardConstraints = {
    categories: [...mandate.allowedCategories],
    requiredAttributes: [...mandate.requiredAttributes],
    excludedAttributes: [],
    forbiddenAllergens: [...mandate.forbiddenAllergens],
    requiredCertificates: [...mandate.requiredCertificates],
    sources: [],
  };
  const add = (text: string, source: ConstraintSource["source"], preferenceId?: string) => c.sources.push({ text, source, preferenceId });
  add(`Mandate: categories ${mandate.allowedCategories.join(", ")}`, "mandate");
  if (mandate.requiredAttributes.length) add(`Mandate: must be ${mandate.requiredAttributes.join(", ")}`, "mandate");
  if (mandate.forbiddenAllergens.length) add(`Mandate: never ${mandate.forbiddenAllergens.join(", ")}`, "mandate");
  if (mandate.requiredCertificates.length) add(`Mandate: must carry ${mandate.requiredCertificates.join(", ")}`, "mandate");

  const wanted = [...need.requiredClaims, ...need.item.attributes];
  if (wanted.length) add(`Request: must be ${wanted.join(", ")}`, "request");
  if (need.item.excludedAttributes.length) add(`Request: not ${need.item.excludedAttributes.join(", ")}`, "request");
  if (need.forbiddenAllergens.length) add(`Request: no ${need.forbiddenAllergens.join(", ")}`, "request");
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
  return c;
}

/** Why a product may not be offered, or undefined if it may. */
export function violation(p: Product, c: HardConstraints): string | undefined {
  if (!c.categories.includes(p.category)) return `category ${p.category} is not in the mandate`;
  const missing = c.requiredAttributes.filter((a) => !p.attributes.includes(a));
  if (missing.length) return `not ${missing.join(", ")}`;
  const excluded = c.excludedAttributes.filter((a) => p.attributes.includes(a));
  if (excluded.length) return `is ${excluded.join(", ")}`;
  const allergens = p.allergens.filter((a) => c.forbiddenAllergens.includes(a));
  if (allergens.length) return `contains ${allergens.join(", ")}`;
  const certs = c.requiredCertificates.filter((x) => !p.certificates.includes(x));
  if (certs.length) return `lacks ${certs.join(", ")}`;
  return undefined;
}

// ---------- clarification ----------

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
};

export type Settled = {
  attributes: string[]; // add to the required attributes
  excludedAttributes: string[];
  optimise?: OptimiseGoal | typeof NO_PREFERENCE;
  optimiseWithinPctOfCheapest?: number;
  optimiseSource?: "request" | "answer" | "stated" | "learned";
};

export type Clarification = { questions: Question[]; fromMemory: MemoryNote[]; notAsked: string[]; settled: Settled };

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
 * Decide what to ask. A dimension is asked only when the products still allowed differ on it and neither
 * the request, an earlier answer, nor the kitchen's memory settles it. What the profile answers is never
 * asked; it is reported in `fromMemory` instead.
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
  const open: { q: Question; spread: number }[] = [];
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
      fromMemory.push({ question: q, optionId: s.choice, label: optionLabel(q, s.choice), source: "stated", text: `${s.text} (set by ${s.statedBy})`, preferenceId: s.id });
      continue;
    }
    const l = input.learned.find((p) => p.kind === "dimension" && p.dimension === dim.id && values.includes(p.choice));
    if (l && l.kind === "dimension") {
      applyDimension(dim, l.choice);
      fromMemory.push({ question: q, optionId: l.choice, label: optionLabel(q, l.choice), source: "learned", text: `Pre-selected from history: ${l.text}`, evidence: l.evidence });
      continue;
    }
    open.push({ q, spread: values.length });
  }

  const oq = optimiseQuestion();
  const oa = answerFor(oq.id);
  const so = stated.find((p) => p.kind === "optimise");
  const lo = input.learned.find((p) => p.kind === "optimise");
  let askOptimise = false;
  if (need.optimise !== "unstated") Object.assign(settled, { optimise: need.optimise, optimiseSource: "request" });
  else if (oa) Object.assign(settled, { optimise: oa.optionId as Settled["optimise"], optimiseSource: "answer" });
  else if (so && so.kind === "optimise") {
    Object.assign(settled, { optimise: so.goal, optimiseWithinPctOfCheapest: so.withinPctOfCheapest, optimiseSource: "stated" });
    fromMemory.push({ question: oq, optionId: so.goal, label: optionLabel(oq, so.goal), source: "stated", text: `${so.text} (set by ${so.statedBy})`, preferenceId: so.id });
  } else if (lo && lo.kind === "optimise") {
    Object.assign(settled, { optimise: lo.goal, optimiseSource: "learned" });
    fromMemory.push({ question: oq, optionId: lo.goal, label: optionLabel(oq, lo.goal), source: "learned", text: `Pre-selected from history: ${lo.text}`, evidence: lo.evidence });
  } else askOptimise = candidates.length > 0;

  open.sort((a, b) => b.spread - a.spread);
  const all = [...open.map((o) => o.q), ...(askOptimise ? [oq] : [])];
  const questions = all.slice(0, MAX_QUESTIONS);
  const notAsked = all.slice(MAX_QUESTIONS).map((q) => `${q.text} Not asked, to keep it short: the options show each kind.`);
  return { questions, fromMemory, notAsked, settled };
}

function order(dim: SpecDimension, value: string): number {
  const i = dim.values.findIndex((v) => v.attribute === value);
  return i === -1 ? dim.values.length : i;
}
