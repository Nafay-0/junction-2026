import { beforeEach, describe, expect, it } from "vitest";
import { getMemoryService, resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { knownFrom, nextQuestion, parseAnswers, plan, termsFrom, type InterviewAnswers } from "./interview";
import { finishInterview, interviewStep } from "./interview-run";

/**
 * The set-up interview (docs/agent-thread.md "Set-up interview"): plain-code questions in a fixed order, never one
 * the records answer, ending in the account's own signed mandate with the answers in it and in memory.
 */

const ADDR = "198.51.100.11";

/** A buyer who accepts each suggestion and answers the rest as given: what the browser sends, tap by tap. */
function drive(known: ReturnType<typeof knownFrom>, given: InterviewAnswers) {
  const a: InterviewAnswers = {};
  const asked: string[] = [];
  for (let q = nextQuestion(a, known); q; q = nextQuestion(a, known)) {
    asked.push(q.id);
    const v = given[q.id] ?? (q.input.kind === "weekdays" ? (q.suggested as string[]).map(Number) : q.suggested);
    (a as Record<string, unknown>)[q.id] = v;
  }
  return { answers: parseAnswers(a), asked };
}

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_CATALOG = "seed";
  process.env.DOCK_MEMORY_LLM = "off";
});

describe("what the records answer is never asked", () => {
  it("the kind of kitchen from its name, in Finnish, Swedish or English; a name that says nothing is asked", () => {
    expect(knownFrom("Päiväkoti Satu").kind).toMatchObject({ value: "daycare_school", from: "restaurant_name", words: "Päiväkoti" });
    expect(knownFrom("Kahvila Kulma").kind?.value).toBe("cafe");
    expect(knownFrom("Laakso Catering").kind?.value).toBe("catering");
    expect(knownFrom("Restaurang Hav").kind?.value).toBe("restaurant");
    expect(knownFrom("Aalto & Sons").kind).toBeUndefined();
    expect(plan(knownFrom("Päiväkoti Satu"))).not.toContain("kind");
    expect(plan(knownFrom("Aalto & Sons"))[0]).toBe("kind");
  });

  it("a question already answered is not asked again (a reload resumes at the next one)", () => {
    const known = knownFrom("Aalto & Sons");
    expect(nextQuestion({ kind: "lunch", diet: [] }, known)?.id).toBe("allergens");
  });

  it("suggestions follow from the answers before: the limit from the usual order, the budget from it and the days", () => {
    const known = knownFrom("Ravintola Aalto");
    expect(nextQuestion({ diet: [], allergens: [], days: [2, 5], usualEur: 400 }, known)).toMatchObject({ id: "limitEur", suggested: 600 });
    expect(nextQuestion({ diet: [], allergens: [], days: [2, 5], usualEur: 400, limitEur: 600 }, known)).toMatchObject({ id: "budgetEur", suggested: 1000 });
  });
});

describe("the interview ends in a valid signed mandate with the answers", () => {
  it("a daycare kitchen: seven questions, the answers in the signed mandate and in memory, every step in the ledger", async () => {
    const rt = await getRuntime();
    await rt.accounts.signUp({ restaurant: "Päiväkoti Satu", username: "satu", password: "a-long-password-1" }, ADDR);
    const account = (await rt.accounts.get("satu"))!;
    const first = interviewStep(account, {});
    expect(first.question?.id).toBe("diet");
    expect(first.known.kind?.value).toBe("daycare_school");

    const { answers, asked } = drive(first.known, { diet: ["lactose_free"], allergens: ["nuts", "peanuts", "fish"], usualEur: 350, signer: "Maija Laine" });
    expect(asked).toEqual(["diet", "allergens", "days", "usualEur", "limitEur", "budgetEur", "signer"]);
    expect(asked).not.toContain("kind");
    const done = interviewStep(account, answers);
    expect(done.question).toBeUndefined();
    expect(done.terms).toMatchObject({ require: ["lactose_free"], forbid: ["nuts", "peanuts", "fish"], signer: "Maija Laine" });

    const r = await finishInterview(rt, account, answers, 42_000);
    expect(r.first).toBe(true);
    const k = (await rt.accounts.kitchenOf("satu"))!.kitchen;
    expect(k.mandate.mandateId).toBe(r.mandateId);
    expect(k.mandate.requiredAttributes).toEqual(["lactose_free"]);
    expect(k.mandate.forbiddenAllergens).toEqual(["nuts", "peanuts", "fish"]);
    expect(k.mandate.perOrderLimitCents).toBe((answers.limitEur as number) * 100);
    expect(k.mandate.weeklyBudgetCents).toBe((answers.budgetEur as number) * 100);
    expect(k.mandate.approvers[0]?.name).toBe("Maija Laine");
    // A valid signature: the gate accepts the kitchen's own mandate token with the key it registered.
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId);
    expect(session.mandate.mandateId).toBe(r.mandateId);

    const memory = await getMemoryService();
    const items = (await memory.view(k.orgId)).items.map((i) => i.fact.kind);
    expect(items).toEqual(expect.arrayContaining(["diet", "allergen", "delivery_days", "budget", "note"]));

    const entry = rt.dock.ledger.entries().find((e) => (e.data as { step?: string }).step === "setup_interview")!;
    expect(entry.data).toMatchObject({ mandateId: r.mandateId, asked, skipped: [{ question: "kind", because: "restaurant_name" }], ms: 42_000 });
    expect(rt.dock.ledger.entries().some((e) => (e.data as { step?: string }).step === "mandate_signed")).toBe(true);
    expect(rt.dock.ledger.verify().ok).toBe(true);

    // Signed once: the interview does not run again for this kitchen.
    const after = (await rt.accounts.get("satu"))!;
    expect(interviewStep(after, {}).done).toEqual({ next: "/k/satu" });
    await expect(finishInterview(rt, after, answers)).rejects.toMatchObject({ code: "interview_done" });
  });

  it("refuses to sign an unfinished interview or answers the terms would refuse", async () => {
    const rt = await getRuntime();
    await rt.accounts.signUp({ restaurant: "Aalto & Sons", username: "aaltos", password: "a-long-password-1" }, ADDR);
    const account = (await rt.accounts.get("aaltos"))!;
    await expect(finishInterview(rt, account, { kind: "lunch" })).rejects.toMatchObject({ code: "interview_incomplete" });
    expect(() => parseAnswers({ allergens: ["shellfish"] })).toThrow();
    expect(() => parseAnswers({ limitEur: -5 })).toThrow();
    expect(() => termsFrom({ kind: "lunch", diet: [], allergens: [], days: [1], usualEur: 100, limitEur: 300, budgetEur: 300, signer: "X" }, {})).toThrow();
    expect((await rt.accounts.kitchenOf("aaltos"))).toBeUndefined();
  });
});
