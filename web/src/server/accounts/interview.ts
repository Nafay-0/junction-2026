import { z } from "zod";
import { DockError } from "@/core/errors";
import type { MemoryFact } from "@/core/kitchen";
import { DEFAULT_TERMS, FORBID_ALLERGENS, REQUIRE_CLAIMS, parseTerms, type MandateTerms } from "./terms";

/**
 * The set-up interview: a new account's second step, in plain code (docs/agent-thread.md "Set-up interview"). A few
 * questions, each one only if its answer changes the mandate or what the agent remembers, and never one the records
 * already answer: the kind of kitchen from the restaurant's own name ("Päiväkoti Satu" is a daycare kitchen), anything
 * answered before (a reload resumes). The order of the questions, their options and suggested amounts, the terms they
 * make and the memory they leave are all here; the browser only words them (en/fi/sv) and sends the taps back.
 *
 * Stateless: the browser sends the answers so far with every step; nothing is kept until the interview is signed.
 * Signing is the account's existing mechanism (accounts/service.ts signKitchen), so the result is the same signed
 * mandate, key and signer the form made, and the device step that follows is unchanged.
 */

export const KITCHEN_KINDS = ["restaurant", "lunch", "cafe", "catering", "daycare_school", "care_home", "hotel"] as const;
export type KitchenKind = (typeof KITCHEN_KINDS)[number];

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Every question about limits and preferences takes a real answer, "none" (no rule of the kitchen's own: an empty
 * list, or for an amount the safe default) or "later" (decide later: the safe default now, and the agent proposes a
 * rule from what the kitchen does, one at a time, never applying one itself; server/memory/decide.ts). `skipRest`
 * fills every rules question not answered yet with "later" (offered once the first rules question was "none").
 */
const NONE = z.literal("none");
const LATER = z.literal("later");
export const AnswersSchema = z
  .object({
    kind: z.enum(KITCHEN_KINDS).optional(),
    diet: z.union([z.array(z.enum(REQUIRE_CLAIMS)).max(REQUIRE_CLAIMS.length), LATER]).optional(),
    allergens: z.union([z.array(z.enum(FORBID_ALLERGENS)).max(FORBID_ALLERGENS.length), LATER]).optional(),
    days: z.union([z.array(z.number().int().min(1).max(7)).max(7), LATER]).optional(),
    usualEur: z.union([z.number().int().min(10).max(50000), NONE, LATER]).optional(),
    limitEur: z.union([z.number().int().min(0).max(50000), NONE, LATER]).optional(),
    budgetEur: z.union([z.number().int().min(10).max(200000), NONE, LATER]).optional(),
    signer: z.string().trim().min(2).max(60).optional(),
    skipRest: z.boolean().optional(),
  })
  .strict();
export type InterviewAnswers = z.infer<typeof AnswersSchema>;
export type QuestionId = Exclude<keyof InterviewAnswers, "skipRest">;

/** The questions about the kitchen's rules: each takes an answer, "none" or "decide later". */
export const RULE_QUESTIONS = ["diet", "allergens", "days", "usualEur", "limitEur", "budgetEur"] as const satisfies readonly QuestionId[];
export type RuleQuestion = (typeof RULE_QUESTIONS)[number];

/**
 * The safe defaults a kitchen starts with when it sets no limits of its own: every food product group (no
 * equipment, cleaning, disposables, gases, office goods or alcohol), a modest amount the agent may spend alone per
 * order (so going over it, and the sign-off on a phone, is easy to see), a weekly budget, no allergen, diet or
 * nutrition rules, substitutes within the kitchen's preferences, a week's lead time. Said plainly on the summary.
 */
export const SAFE_DEFAULTS = {
  groups: ["10", "11", "17", "18", "21", "22", "41", "52", "67", "85"],
  perOrderLimitEur: 250,
  weeklyBudgetEur: 6_000,
  signer: "Head chef",
} as const;

const isNoneOrLater = (v: unknown) => v === "none" || v === "later" || (Array.isArray(v) && v.length === 0);
/** Whether this question's answer is the kitchen's own rule (not "none", not "decide later"). */
export const ownAnswer = (a: InterviewAnswers, q: RuleQuestion) => a[q] !== undefined && !isNoneOrLater(a[q]);

/** What the records already answer, and from where (shown to the buyer as "from your name", never asked). */
export type Known = { kind?: { value: KitchenKind; from: "restaurant_name"; words: string } };

/**
 * A question as the browser shows it: `input` picks the answer widget (QuestionCard's kinds, docs/agent-thread.md):
 * chips (`choice`, `multi` for several), weekday chips (`weekdays`), a stepper (`amount`) or a short text (`text`).
 * Options carry ids the browser words; amounts are suggestions computed from the answers before.
 */
export type InterviewQuestion = {
  id: QuestionId;
  n: number;
  of: number;
  input: { kind: "choice"; multi?: boolean } | { kind: "weekdays" } | { kind: "amount"; unit: "EUR"; min: number; max: number; step: number } | { kind: "text"; max: number };
  options: { id: string; amount?: number }[];
  /** The preselected answer (the widget starts here; one tap accepts it). */
  suggested?: string[] | number | string;
  /** Why the suggestion is what it is, as a code the browser words (e.g. "from_usual"). */
  because?: string;
  /** The question is about the kitchen's rules: "none" and "decide later" are answers too, each said in one line first. */
  alternatives?: ("none" | "later")[];
  /** The first rules question was "none" or "decide later": offer "skip the rest and start" with the safe defaults. */
  offerSkip?: boolean;
  /** For the limit and the budget: the safe default "none" or "decide later" starts with (said in its one line). */
  defaultAmount?: number;
};

// ---------- what the records answer ----------

const KIND_WORDS: [KitchenKind, RegExp][] = [
  ["daycare_school", /\b(päiväkoti|päiväkodi\w*|koulu\w*|school|skola|daghem|förskola|kindergarten|daycare|esikoulu)\b/i],
  ["care_home", /\b(hoivakoti|palvelutalo|vanhainkoti|care home|nursing|äldreboende|servicehus|hoiva\w*)\b/i],
  ["catering", /\b(catering|pitopalvelu|ateriapalvelu\w*|cateringfirma)\b/i],
  ["cafe", /\b(kahvila|café|cafe|kafé|kaffe\w*|coffee|bakery|leipomo|konditori\w*)\b/i],
  ["hotel", /\b(hotel\w*|hotelli\w*|hostel\w*)\b/i],
  ["lunch", /\b(lounas\w*|lunch\w*|henkilöstöravintola|staff restaurant|personalrestaurang)\b/i],
  ["restaurant", /\b(ravintola|restaurant|restaurang|bistro|brasserie|trattoria|pizzeria|grill|krog)\b/i],
];

/** The kind of kitchen from its name, if the name says it; nothing is guessed from a name that does not. */
export function knownFrom(restaurant: string): Known {
  for (const [kind, re] of KIND_WORDS) {
    const m = restaurant.match(re);
    if (m) return { kind: { value: kind, from: "restaurant_name", words: m[0] } };
  }
  return {};
}

// ---------- the plan of questions ----------

/** Product groups each kind of kitchen buys (the shop's departments, accounts/terms.ts PRODUCT_GROUPS). */
export const GROUPS_BY_KIND: Record<KitchenKind, string[]> = {
  restaurant: ["10", "11", "17", "18", "21", "22", "41", "85"],
  lunch: ["10", "11", "17", "18", "21", "22", "41"],
  cafe: ["10", "11", "21", "22", "52", "64", "85"],
  catering: ["10", "11", "17", "18", "21", "22", "41", "64"],
  daycare_school: ["10", "11", "17", "18", "21", "22", "41"],
  care_home: ["10", "11", "17", "18", "21", "22", "41"],
  hotel: ["10", "11", "17", "18", "21", "22", "41", "84", "85"],
};
/** A usual order in euros, the stepper's start before the kitchen says its own. */
const USUAL_BY_KIND: Record<KitchenKind, number> = { restaurant: 300, lunch: 400, cafe: 150, catering: 800, daycare_school: 400, care_home: 400, hotel: 500 };
/** Allergens a kitchen of this kind most often rules out: the chips shown first (nothing is preselected). */
const ALLERGENS_FIRST: Record<KitchenKind, string[]> = {
  daycare_school: ["nuts", "peanuts", "sesame", "fish"],
  care_home: ["nuts", "peanuts"],
  restaurant: ["nuts", "peanuts", "sesame"],
  lunch: ["nuts", "peanuts"],
  cafe: ["nuts", "peanuts"],
  catering: ["nuts", "peanuts", "sesame"],
  hotel: ["nuts", "peanuts"],
};

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);
const ORDER: QuestionId[] = ["kind", "diet", "allergens", "days", "usualEur", "limitEur", "budgetEur", "signer"];

function kindOf(a: InterviewAnswers, k: Known): KitchenKind | undefined {
  return a.kind ?? k.kind?.value;
}

/** Every question this kitchen will be asked, in order: the kind only when its name does not say it. */
export function plan(k: Known): QuestionId[] {
  return ORDER.filter((q) => !(q === "kind" && k.kind));
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const list = <T>(v: T[] | "later" | undefined): T[] => (Array.isArray(v) ? v : []);

function suggestedLimit(a: InterviewAnswers, kind: KitchenKind): number {
  // Spend alone up to a usual order and a half: a routine order goes through, an unusual one asks.
  return roundTo((num(a.usualEur) ?? USUAL_BY_KIND[kind]) * 1.5, 50);
}
function suggestedBudget(a: InterviewAnswers, kind: KitchenKind): number {
  const perWeek = Math.max(1, list(a.days).length || 2);
  return Math.max(roundTo((num(a.usualEur) ?? USUAL_BY_KIND[kind]) * perWeek * 1.25, 250), num(a.limitEur) ?? 0, 10);
}

/** The next question, or undefined when every question is answered (or known). */
export function nextQuestion(a: InterviewAnswers, k: Known): InterviewQuestion | undefined {
  const qs = plan(k);
  const id = qs.find((q) => a[q] === undefined);
  if (!id) return undefined;
  const n = qs.indexOf(id) + 1;
  const of = qs.length;
  const kind = kindOf(a, k) ?? "restaurant";
  const q = ask(id, n, of, a, kind);
  if ((RULE_QUESTIONS as readonly string[]).includes(id)) {
    q.alternatives = ["none", "later"];
    if (id === "limitEur") q.defaultAmount = SAFE_DEFAULTS.perOrderLimitEur;
    if (id === "budgetEur") q.defaultAmount = Math.max(SAFE_DEFAULTS.weeklyBudgetEur, num(a.limitEur) ?? SAFE_DEFAULTS.perOrderLimitEur);
    // "None" to the first question about rules: the rest can be skipped straight away.
    if (a.diet !== undefined && isNoneOrLater(a.diet) && !RULE_QUESTIONS.some((r) => ownAnswer(a, r))) q.offerSkip = true;
  }
  return q;
}

function ask(id: QuestionId, n: number, of: number, a: InterviewAnswers, kind: KitchenKind): InterviewQuestion {
  switch (id) {
    case "kind":
      return { id, n, of, input: { kind: "choice" }, options: KITCHEN_KINDS.map((x) => ({ id: x })) };
    case "diet":
      return { id, n, of, input: { kind: "choice", multi: true }, options: REQUIRE_CLAIMS.map((x) => ({ id: x })), suggested: [] };
    case "allergens": {
      const first = ALLERGENS_FIRST[kind];
      return { id, n, of, input: { kind: "choice", multi: true }, options: [...first, ...FORBID_ALLERGENS.filter((x) => !first.includes(x))].map((x) => ({ id: x })), suggested: [] };
    }
    case "days":
      return { id, n, of, input: { kind: "weekdays" }, options: WEEKDAYS.map((d) => ({ id: String(d) })), suggested: kind === "cafe" || kind === "restaurant" || kind === "hotel" ? ["2", "5"] : ["1", "4"] };
    case "usualEur": {
      const u = USUAL_BY_KIND[kind];
      return { id, n, of, input: { kind: "amount", unit: "EUR", min: 10, max: 50000, step: u >= 400 ? 50 : 25 }, options: [roundTo(u / 2, 25), u, u * 2].map((x) => ({ id: String(x), amount: x })), suggested: u, because: "kind" };
    }
    case "limitEur": {
      const s = suggestedLimit(a, kind);
      return { id, n, of, input: { kind: "amount", unit: "EUR", min: 0, max: 50000, step: 50 }, options: [num(a.usualEur) ?? s, s, roundTo(s * 2, 50)].filter((x, i, xs) => xs.indexOf(x) === i).map((x) => ({ id: String(x), amount: x })), suggested: s, because: "from_usual" };
    }
    case "budgetEur": {
      const s = suggestedBudget(a, kind);
      return { id, n, of, input: { kind: "amount", unit: "EUR", min: Math.max(10, num(a.limitEur) ?? 0), max: 200000, step: 250 }, options: [s, roundTo(s * 1.5, 250)].map((x) => ({ id: String(x), amount: x })), suggested: s, because: "from_usual_and_days" };
    }
    case "signer":
      return { id, n, of, input: { kind: "text", max: 60 }, options: [] };
  }
}

/** Answers checked: the schema, then what depends on what (a weekly budget at least the per-order limit). */
export function parseAnswers(raw: unknown): InterviewAnswers {
  const r = AnswersSchema.safeParse(raw ?? {});
  if (!r.success) throw new DockError(400, "interview_answer_invalid", `That answer is not one the interview can take: ${r.error.issues[0]?.path.join(".") || "answers"} ${r.error.issues[0]?.message ?? ""}`.trim(), "account");
  const a = r.data;
  if (Array.isArray(a.days)) a.days = [...new Set(a.days)].sort();
  if (Array.isArray(a.diet)) a.diet = [...new Set(a.diet)];
  if (Array.isArray(a.allergens)) a.allergens = [...new Set(a.allergens)];
  if (a.skipRest) {
    // "Skip the rest and start": every rules question not answered yet is "decide later", and the default signer.
    for (const q of RULE_QUESTIONS) if (a[q] === undefined) (a as Record<string, unknown>)[q] = "later";
    a.signer ??= SAFE_DEFAULTS.signer;
  }
  // A weekly budget below the limit said on the step before is taken as the limit (termsFrom); a number "none" is not.
  return a;
}

/** Which rows of the summary are safe defaults (not the kitchen's own answer), and which it chose to decide later. */
export function defaultsOf(a: InterviewAnswers): { defaults: ("groups" | "limitEur" | "budgetEur" | "diet" | "allergens" | "days")[]; later: RuleQuestion[]; none: boolean } {
  const amountsDefault = !ownAnswer(a, "limitEur");
  const defaults: ("groups" | "limitEur" | "budgetEur" | "diet" | "allergens" | "days")[] = [];
  if (amountsDefault) defaults.push("groups", "limitEur");
  if (!ownAnswer(a, "budgetEur")) defaults.push("budgetEur");
  for (const q of ["diet", "allergens", "days"] as const) if (!ownAnswer(a, q)) defaults.push(q);
  const later = RULE_QUESTIONS.filter((q) => a[q] === "later");
  return { defaults, later, none: !RULE_QUESTIONS.some((q) => ownAnswer(a, q)) };
}

// ---------- what the interview makes ----------

/** The terms the answers make (accounts/terms.ts), checked exactly as the account page checks them. */
export function termsFrom(a: InterviewAnswers, k: Known): MandateTerms {
  const missing = plan(k).filter((q) => a[q] === undefined);
  if (missing.length) throw new DockError(400, "interview_incomplete", `The set-up is not finished: ${missing.join(", ")} still open.`, "account");
  const kind = kindOf(a, k)!;
  // No limit of the kitchen's own ("none" or "decide later"): the safe defaults, which let everything be tried.
  const own = ownAnswer(a, "limitEur");
  const limit = num(a.limitEur) ?? SAFE_DEFAULTS.perOrderLimitEur;
  const budget = num(a.budgetEur) ?? Math.max(SAFE_DEFAULTS.weeklyBudgetEur, limit);
  return parseTerms({
    ...DEFAULT_TERMS,
    perOrderLimitEur: limit,
    weeklyBudgetEur: Math.max(budget, limit),
    groups: own ? GROUPS_BY_KIND[kind] : [...new Set([...SAFE_DEFAULTS.groups, ...GROUPS_BY_KIND[kind].filter((g) => !["84"].includes(g))])].sort(),
    require: list(a.diet),
    forbid: list(a.allergens),
    signer: a.signer,
  });
}

/** What the agent remembers from the interview, as memory facts with the person's own answer as the text. */
export function memoryFrom(a: InterviewAnswers, k: Known): { fact: MemoryFact; text: string }[] {
  const kind = kindOf(a, k);
  const out: { fact: MemoryFact; text: string }[] = [];
  for (const c of list(a.diet)) out.push({ fact: { kind: "diet", claim: c }, text: `Always ${c.replaceAll("_", "-")}: said at set-up` });
  for (const x of list(a.allergens)) out.push({ fact: { kind: "allergen", allergen: x }, text: `Never ${x}: said at set-up` });
  const days = list(a.days);
  if (days.length) out.push({ fact: { kind: "delivery_days", weekdays: days }, text: `Orders for ${days.map((d) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(" and ")}: said at set-up` });
  const usual = num(a.usualEur);
  const week = num(a.budgetEur);
  if (usual) out.push({ fact: { kind: "budget", perOrderCents: usual * 100, ...(week ? { weeklyCents: week * 100 } : {}) }, text: `A usual order is about €${usual}: said at set-up` });
  if (kind) out.push({ fact: { kind: "note", text: `Kind of kitchen: ${kind.replaceAll("_", " ")}${k.kind && !a.kind ? ` (from its name, "${k.kind.words}")` : ""}` }, text: `Kind of kitchen: ${kind.replaceAll("_", " ")}` });
  const later = RULE_QUESTIONS.filter((q) => a[q] === "later");
  if (later.length) out.push({ fact: { kind: "note", text: `Rules to learn as we go (decided later at set-up): ${later.map((q) => LATER_WORDS[q]).join(", ")}. Propose one at a time from what the kitchen orders; never apply one alone.` }, text: `Learn as we go: ${later.map((q) => LATER_WORDS[q]).join(", ")}` });
  return out;
}

const LATER_WORDS: Record<RuleQuestion, string> = { diet: "diets", allergens: "allergens", days: "delivery days", usualEur: "a usual order", limitEur: "the spend-alone limit", budgetEur: "the weekly budget" };
