import { DockError } from "@/core/errors";
import { getMemoryService } from "@/server/memory/runtime";
import type { Runtime } from "@/server/runtime";
import { defaultsOf, knownFrom, memoryFrom, nextQuestion, parseAnswers, plan, termsFrom, type InterviewAnswers, type InterviewQuestion, type Known } from "./interview";
import type { Account } from "./store";
import type { MandateTerms } from "./terms";

/**
 * The set-up interview against the account: what the records answer (the restaurant's name; an account that already
 * has a kitchen is done), the next question, and signing. Plain code throughout (interview.ts); no model.
 */

export type InterviewStep = {
  restaurant: string;
  known: Known;
  answers: InterviewAnswers;
  /** The questions this kitchen is asked, in order (the kind is left out when its name says it). */
  plan: string[];
  question?: InterviewQuestion;
  /** Once every question is answered: the terms that will be signed, for the last card before signing. */
  terms?: MandateTerms;
  /** With the terms: which rows are safe defaults (the kitchen set no rule of its own), which it decides later. */
  defaults?: ReturnType<typeof defaultsOf>;
  /** A demo account (server/demo): after signing it chooses a starting point (sample history or empty). */
  demo?: boolean;
  /** Already signed (a reload after signing, or a kitchen kept from a visit): nothing to ask. */
  done?: { next: string };
};

export function interviewStep(a: Account, raw: unknown): InterviewStep {
  const known = knownFrom(a.restaurant);
  if (a.kind === "demo") throw new DockError(409, "demo_mandate_fixed", `${a.restaurant} is a built-in demo kitchen: its mandate is fixed for the stage.`, "account");
  if (a.kitchen) return { restaurant: a.restaurant, known, answers: {}, plan: [], done: { next: `/k/${a.username}` } };
  const answers = parseAnswers(raw);
  const question = nextQuestion(answers, known);
  return { restaurant: a.restaurant, known, answers, plan: plan(known), ...(a.demo ? { demo: true } : {}), ...(question ? { question } : { terms: termsFrom(answers, known), defaults: defaultsOf(answers) }) };
}

/** The set-up's answers into the kitchen's memory (also after a demo account starts over). Returns how many were written. */
export async function writeSetupMemory(rt: Runtime, x: { orgId: string; restaurant: string; username: string; by: string; facts: { fact: import("@/core/kitchen").MemoryFact; text: string }[] }): Promise<number> {
  try {
    const memory = await getMemoryService();
    const r = await memory.write(
      x.orgId,
      { door: "memory_page", by: x.by, segments: [], events: x.facts.map((f) => ({ type: "rule_stated" as const, fact: f.fact, text: f.text, strength: f.fact.kind === "diet" || f.fact.kind === "allergen" ? ("rule" as const) : ("habit" as const) })) },
      x.restaurant,
    );
    return r.outcomes.length;
  } catch (err) {
    // The mandate is signed and carries the safety rules; memory is what the agent recalls. Say it in the ledger.
    rt.dock.ledger.append({ type: "intake", actor: `account:${x.username}`, summary: `The set-up's answers could not be written to ${x.restaurant}'s memory (${err instanceof Error ? err.message : "error"}); the signed mandate carries its rules.`, data: { step: "setup_memory_failed", orgId: x.orgId } });
    return 0;
  }
}

export async function finishInterview(rt: Runtime, a: Account, raw: unknown, ms?: number, opts: { lang?: "en" | "fi" | "sv"; clientAddress?: string } = {}): Promise<{ next: string; first: boolean; mandateId: string; remembered: number; mail: import("./email").SignupMail }> {
  if (a.kind === "demo") throw new DockError(409, "demo_mandate_fixed", `${a.restaurant} is a built-in demo kitchen: its mandate is fixed for the stage.`, "account");
  if (a.kitchen) throw new DockError(409, "interview_done", "This kitchen's mandate is already signed; change its rules from the agent or Agent and rules.", "account");
  const known = knownFrom(a.restaurant);
  const answers = parseAnswers(raw);
  const terms = termsFrom(answers, known);
  const signed = await rt.accounts.signKitchen(a.username, terms);
  const k = signed.kitchen!;
  // A demo account keeps what it signed at onboarding: "start over" puts the kitchen back to it (server/demo).
  const d = defaultsOf(answers);
  const facts = memoryFrom(answers, known);
  if (signed.demo) await rt.accounts.store.put({ ...signed, demo: { ...signed.demo, onboarded: terms, remembered: facts } });
  // What the agent remembers: the person's answers, each a memory item with where it came from (the set-up).
  const by = `${terms.signer} (set-up of ${a.restaurant})`;
  const remembered = await writeSetupMemory(rt, { orgId: k.orgId, restaurant: a.restaurant, username: a.username, by, facts });
  const asked = plan(known);
  rt.dock.ledger.append({
    type: "intake",
    actor: `account:${a.username}`,
    summary: `${a.restaurant} finished the set-up interview: ${asked.length} questions${known.kind ? `, the kind of kitchen taken from its name ("${known.kind.words}") instead of asked` : ""}${answers.skipRest ? ", the rest skipped" : ""}. Signed as ${k.mandate.mandateId}: ${terms.perOrderLimitEur} € per order alone, ${terms.weeklyBudgetEur} € a week, ${terms.signer} signs above.${d.none ? " It set no limits of its own: the safe defaults." : d.defaults.length ? ` Safe defaults for: ${d.defaults.join(", ")}.` : ""}${d.later.length ? ` To learn as it goes: ${d.later.join(", ")}.` : ""}`,
    data: {
      step: "setup_interview",
      orgId: k.orgId,
      mandateId: k.mandate.mandateId,
      asked,
      skipped: known.kind ? [{ question: "kind", because: "restaurant_name", words: known.kind.words, value: known.kind.value }] : [],
      answers,
      groups: terms.groups,
      defaults: d.defaults,
      later: d.later,
      ...(answers.skipRest ? { skippedRest: true } : {}),
      remembered: facts.map((f) => f.text),
      ...(ms !== undefined ? { ms } : {}),
    },
  });
  // The business email from sign-up: now the kitchen's pending contact, and its one confirmation mail is sent.
  const { contactFromSignup } = await import("./email");
  const mail = await contactFromSignup(rt, (await rt.accounts.store.get(a.username)) ?? signed, { lang: opts.lang ?? "en", ...(opts.clientAddress ? { clientAddress: opts.clientAddress } : {}) });
  return { next: `/k/${a.username}`, first: true, mandateId: k.mandate.mandateId, remembered, mail };
}
