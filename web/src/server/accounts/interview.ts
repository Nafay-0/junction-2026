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

export const AnswersSchema = z
  .object({
    kind: z.enum(KITCHEN_KINDS).optional(),
    diet: z.array(z.enum(REQUIRE_CLAIMS)).max(REQUIRE_CLAIMS.length).optional(),
    allergens: z.array(z.enum(FORBID_ALLERGENS)).max(FORBID_ALLERGENS.length).optional(),
    days: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    usualEur: z.number().int().min(10).max(50000).optional(),
    limitEur: z.number().int().min(0).max(50000).optional(),
    budgetEur: z.number().int().min(10).max(200000).optional(),
    signer: z.string().trim().min(2).max(60).optional(),
  })
  .strict();
export type InterviewAnswers = z.infer<typeof AnswersSchema>;
export type QuestionId = keyof InterviewAnswers;

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

function suggestedLimit(a: InterviewAnswers, kind: KitchenKind): number {
  // Spend alone up to a usual order and a half: a routine order goes through, an unusual one asks.
  return roundTo((a.usualEur ?? USUAL_BY_KIND[kind]) * 1.5, 50);
}
function suggestedBudget(a: InterviewAnswers, kind: KitchenKind): number {
  const perWeek = Math.max(1, a.days?.length ?? 2);
  return Math.max(roundTo((a.usualEur ?? USUAL_BY_KIND[kind]) * perWeek * 1.25, 250), a.limitEur ?? 0, 10);
}

/** The next question, or undefined when every question is answered (or known). */
export function nextQuestion(a: InterviewAnswers, k: Known): InterviewQuestion | undefined {
  const qs = plan(k);
  const id = qs.find((q) => a[q] === undefined);
  if (!id) return undefined;
  const n = qs.indexOf(id) + 1;
  const of = qs.length;
  const kind = kindOf(a, k) ?? "restaurant";
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
      return { id, n, of, input: { kind: "amount", unit: "EUR", min: 0, max: 50000, step: 50 }, options: [a.usualEur ?? s, s, roundTo(s * 2, 50)].filter((x, i, xs) => xs.indexOf(x) === i).map((x) => ({ id: String(x), amount: x })), suggested: s, because: "from_usual" };
    }
    case "budgetEur": {
      const s = suggestedBudget(a, kind);
      return { id, n, of, input: { kind: "amount", unit: "EUR", min: Math.max(10, a.limitEur ?? 0), max: 200000, step: 250 }, options: [s, roundTo(s * 1.5, 250)].map((x) => ({ id: String(x), amount: x })), suggested: s, because: "from_usual_and_days" };
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
  if (a.days) a.days = [...new Set(a.days)].sort();
  if (a.diet) a.diet = [...new Set(a.diet)];
  if (a.allergens) a.allergens = [...new Set(a.allergens)];
  return a;
}

// ---------- what the interview makes ----------

/** The terms the answers make (accounts/terms.ts), checked exactly as the account page checks them. */
export function termsFrom(a: InterviewAnswers, k: Known): MandateTerms {
  const missing = plan(k).filter((q) => a[q] === undefined);
  if (missing.length) throw new DockError(400, "interview_incomplete", `The set-up is not finished: ${missing.join(", ")} still open.`, "account");
  const kind = kindOf(a, k)!;
  return parseTerms({
    ...DEFAULT_TERMS,
    perOrderLimitEur: a.limitEur,
    weeklyBudgetEur: Math.max(a.budgetEur!, a.limitEur!),
    groups: GROUPS_BY_KIND[kind],
    require: a.diet ?? [],
    forbid: a.allergens ?? [],
    signer: a.signer,
  });
}

/** What the agent remembers from the interview, as memory facts with the person's own answer as the text. */
export function memoryFrom(a: InterviewAnswers, k: Known): { fact: MemoryFact; text: string }[] {
  const kind = kindOf(a, k);
  const out: { fact: MemoryFact; text: string }[] = [];
  for (const c of a.diet ?? []) out.push({ fact: { kind: "diet", claim: c }, text: `Always ${c.replaceAll("_", "-")}: said at set-up` });
  for (const x of a.allergens ?? []) out.push({ fact: { kind: "allergen", allergen: x }, text: `Never ${x}: said at set-up` });
  if (a.days?.length) out.push({ fact: { kind: "delivery_days", weekdays: a.days }, text: `Orders for ${a.days.map((d) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(" and ")}: said at set-up` });
  if (a.usualEur) out.push({ fact: { kind: "budget", perOrderCents: a.usualEur * 100, ...(a.budgetEur ? { weeklyCents: a.budgetEur * 100 } : {}) }, text: `A usual order is about €${a.usualEur}: said at set-up` });
  if (kind) out.push({ fact: { kind: "note", text: `Kind of kitchen: ${kind.replaceAll("_", " ")}${k.kind && !a.kind ? ` (from its name, "${k.kind.words}")` : ""}` }, text: `Kind of kitchen: ${kind.replaceAll("_", " ")}` });
  return out;
}
