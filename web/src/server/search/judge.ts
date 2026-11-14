import type { MatchLabel } from "@/core/catalog/finder";
import { DECISION_USD_PER_M, decide, type DecisionQuestion } from "./gemini";

/**
 * The relevance judge: one request per search over the candidates that survived the hard rules, one rubric
 * question per candidate. It judges only what kind of product each one is relative to the buyer's words; claims,
 * allergens, the mandate and the kitchen's rules were already decided by code and are never asked.
 */

export type JudgeInput = {
  text: string;
  /** What the request reader made the item, when there was one ("lactose-free milk"). */
  itemText?: string;
  /** Requirements already enforced by code, stated so the judge does not count them against a product. */
  enforced?: string[];
  candidates: { id: string; line: string }[];
};

export type Verdict = { label: MatchLabel; confidence: number; score: number };

export type JudgeOutput = { verdicts: Map<string, Verdict>; tokens: number; costUsd: number; ms: number; model: string; hedged?: number };

export interface RelevanceJudge {
  readonly name: string;
  judge(input: JudgeInput, timeoutMs: number, signal?: AbortSignal): Promise<JudgeOutput>;
}

export const LEVELS: MatchLabel[] = ["other", "standin", "variant", "exact"];

export const RUBRIC = [
  "Not what was asked for: another kind of product that would not do the job",
  "Another product (another animal, plant, cheese, drink or kind of thing) that could stand in and do the same job, but is not what was asked for",
  "The same product as asked for, differing only in a detail the words specify (fat level, flavour, cut, form)",
  "Exactly what was asked for",
];

/** The levels as each question carries them, lowest first; their meaning is stated once in the shared input (judgeContext). */
export const LEVEL_NAMES = ["no", "stand-in", "variant", "exact"];

export function judgeContext(input: JudgeInput): string {
  return [
    "A professional kitchen is ordering from a food-service wholesaler. The buyer's words:",
    `"${input.text.slice(0, 600)}"`,
    input.itemText && input.itemText !== input.text ? `The order reader took the item to be: "${input.itemText.slice(0, 200)}".` : "",
    input.enforced?.length ? `Already checked from the product data, do not judge: ${input.enforced.join(", ")}.` : "",
    "Each question is one product from the wholesaler's assortment. Judge only what kind of product it is against what the buyer asked for.",
    "When the words ask for a dish or a recipe as a whole (ingredients for carbonara), a product the dish is usually made with counts as exactly what was asked; a ready-made version of the dish, or an unrelated product, does not.",
    "When the words name one ingredient for a dish (cream for carbonara, ricotta for the lasagne), only that ingredient is what was asked; the dish's other ingredients are not.",
    "When the words describe a job (for the dishwasher, for whipping, for coffee), a product made for that job counts as exactly what was asked.",
    "A product asked for by its own name is what was asked, plant-based ones too (oat milk is an oat drink); a product of another kind that replaces the one named (a margarine for butter, cow's milk for goat milk, hen's eggs for duck eggs) is a stand-in.",
    "Words the buyer did not say (a flavour, a brand, a size) do not make a product a different variant; words the buyer did say and the product contradicts do.",
    `Answer each question with one level. exact: ${RUBRIC[3]}. variant: ${RUBRIC[2]}. stand-in: ${RUBRIC[1]}. no: ${RUBRIC[0]}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const key = (id: string) => `p_${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export type DecisionsJudgeOptions = {
  /** Candidates per request: more than this are split into parallel requests (default 60: one request; splitting made the tail worse, gemini.ts). */
  perRequest?: number;
  /** A request still unanswered after this long is sent again, and the first answer wins (default 450 ms; 0 = never). */
  hedgeMs?: number;
};

/**
 * gemini-decision-1 through the Decisions API: one request for all candidates (each question is answered on its own),
 * and a request still unanswered at 450 ms is sent a second time (hedged): the first answer wins, the other is
 * abandoned (its tokens are billed but not reported back, so the cost shown can be under the bill for hedged calls).
 */
export class DecisionsJudge implements RelevanceJudge {
  readonly name = "gemini-decision-1";
  constructor(private readonly opts: DecisionsJudgeOptions = {}) {}

  async judge(input: JudgeInput, timeoutMs: number, signal?: AbortSignal): Promise<JudgeOutput> {
    const t0 = performance.now();
    const ctx = judgeContext(input);
    const per = Math.max(5, this.opts.perRequest ?? 60);
    const n = Math.max(1, Math.round(input.candidates.length / per));
    const parts: JudgeInput["candidates"][] = Array.from({ length: n }, (_, i) => input.candidates.slice(Math.floor((i * input.candidates.length) / n), Math.floor(((i + 1) * input.candidates.length) / n)));
    const hedge = this.opts.hedgeMs ?? 450;
    let tokens = 0;
    let hedges = 0;
    const ask = (part: JudgeInput["candidates"]) => {
      const questions: Record<string, DecisionQuestion> = {};
      for (const c of part) questions[key(c.id)] = { type: "score", instructions: `Product: ${c.line}`, criteria: LEVEL_NAMES };
      const left = () => Math.max(50, timeoutMs - (performance.now() - t0));
      const ctl = new AbortController();
      const onAbort = () => ctl.abort(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      const one = () => decide(ctx, questions, left(), ctl.signal).then((r) => ((tokens += r.tokens), r));
      const first = one();
      let hedged = false;
      const raced = hedge > 0 && hedge < timeoutMs ? Promise.any([first, new Promise<void>((res) => setTimeout(res, hedge)).then(() => (ctl.signal.aborted ? first : ((hedged = true), one())))]) : first;
      return raced.then(
        // A hedged duplicate is billed too: counted at the winner's size.
        (r) => (ctl.abort(), signal?.removeEventListener("abort", onAbort), hedged && (tokens += r.tokens), (hedges += hedged ? 1 : 0), r),
        (e: unknown) => {
          ctl.abort();
          signal?.removeEventListener("abort", onAbort);
          throw e instanceof AggregateError ? e.errors[0] : e;
        },
      );
    };
    const answers = Object.assign({}, ...(await Promise.all(parts.map(ask))).map((r) => r.answers)) as Awaited<ReturnType<typeof decide>>["answers"];
    const verdicts = new Map<string, Verdict>();
    for (const c of input.candidates) {
      const a = answers[key(c.id)];
      if (!a) continue;
      const probs = a.probabilities ?? {};
      let best = 0;
      for (let i = 1; i < LEVELS.length; i++) if ((probs[String(i)] ?? 0) > (probs[String(best)] ?? 0)) best = i;
      verdicts.set(c.id, { label: LEVELS[best], confidence: Math.round((a.confidence ?? probs[String(best)] ?? 0) * 1000) / 1000, score: Math.round((a.score ?? best) * 1000) / 1000 });
    }
    return { verdicts, tokens, costUsd: (tokens * DECISION_USD_PER_M) / 1e6, ms: Math.round(performance.now() - t0), model: this.name, hedged: hedges };
  }
}

/** A judge that answers from a function, for tests and the crash world: deterministic, free, instant. */
export class ScriptedJudge implements RelevanceJudge {
  readonly name = "scripted";
  constructor(private readonly rule: (text: string, line: string, id: string) => MatchLabel = () => "exact") {}

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    const verdicts = new Map<string, Verdict>();
    for (const c of input.candidates) {
      const label = this.rule(input.text, c.line, c.id);
      verdicts.set(c.id, { label, confidence: 0.9, score: LEVELS.indexOf(label) });
    }
    return { verdicts, tokens: 0, costUsd: 0, ms: 0, model: this.name };
  }
}
