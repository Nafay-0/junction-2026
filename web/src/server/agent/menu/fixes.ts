import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { DockError } from "@/core/errors";
import { createModel, ModelConfigError } from "../models";
import { costOf, tokensFromUsage, type Price, type Tokens } from "../pricing";
import { describeError, isRetryable, withRetry } from "../retry";
import { DRAFT_UNITS, FORMS, menuModelSpec, type DraftIngredient } from "./draft";
import { fixSystem, fixUser, type MenuPromptContext } from "./prompts";

/**
 * Step 3 of the model's part, for a line that cannot be bought as planned: ways out by the dish's logic. Asked only
 * for such lines, all of them in parallel. Plain code then checks every proposal (service.ts) and offers only what
 * passes; the model never decides that a substitute is safe.
 */

const FixIngredient = z.object({
  key: z.string(),
  name: z.string(),
  searchTerms: z.array(z.string()),
  role: z.string(),
  perCover: z.object({ amount: z.number(), unit: z.enum(DRAFT_UNITS) }),
  yieldPct: z.number(),
  amountBasis: z.string(),
  form: z.enum(FORMS),
  avoid: z.array(z.string()),
});

export const LlmFixes = z.object({
  options: z.array(
    z.object({
      kind: z.enum(["substitute", "change_amount", "change_dish"]),
      title: z.string(),
      effect: z.string(),
      changesDish: z.boolean(),
      ingredient: FixIngredient.nullable(),
      perCover: z.number().nullable(),
    }),
  ),
});
export type LlmFixes = z.infer<typeof LlmFixes>;

export type FixRequest = { lineKey: string; dish: string; method: string; ingredient: DraftIngredient; problem: string; rules: string[] };
export type FixResult = { fixes: LlmFixes; ms: number; tokens: Tokens; costUsd: number | null };

export type FixModel = { model: LanguageModel; id: string; price?: Price };

export function resolveFixModel(model?: string | FixModel): FixModel {
  if (model && typeof model !== "string") return model;
  const spec = model ?? menuModelSpec();
  if (!spec) throw new DockError(503, "model_unavailable", "No model is configured for menu planning.");
  try {
    const m = createModel(spec);
    return { model: m.model, id: m.spec.id, price: m.price };
  } catch (err) {
    if (err instanceof ModelConfigError) throw new DockError(503, "model_unavailable", err.message);
    throw err;
  }
}

export async function proposeFixes(req: FixRequest, ctx: MenuPromptContext, model?: string | FixModel, timeoutMs = 20_000): Promise<FixResult> {
  const m = resolveFixModel(model);
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  try {
    const res = await withRetry(
      () =>
        generateText({
          model: m.model,
          instructions: fixSystem(ctx),
          prompt: fixUser({
            dish: req.dish,
            method: req.method,
            ingredient: req.ingredient.name,
            role: req.ingredient.role,
            perCover: `${req.ingredient.perCover.amount} ${req.ingredient.perCover.unit}`,
            problem: req.problem,
            rules: req.rules,
          }),
          output: Output.object({ schema: LlmFixes, name: "fixes" }),
          maxOutputTokens: 6000,
          maxRetries: 0,
          providerOptions: m.id.startsWith("anthropic:") ? { anthropic: { effort: "low" } } : undefined,
          abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }),
      { deadline, policy: { maxRetries: 1, baseMs: 500, maxMs: 2000 } },
    );
    const tokens = tokensFromUsage(res.usage);
    return { fixes: res.output as LlmFixes, ms: Date.now() - t0, tokens, costUsd: costOf(tokens, m.price) };
  } catch (err) {
    if (Date.now() >= deadline || (err as Error)?.name === "TimeoutError") throw new DockError(504, "menu_timeout", `The model did not propose fixes within ${timeoutMs} ms.`);
    throw new DockError(isRetryable(err) ? 503 : 502, "menu_model_failed", `The fix proposal failed: ${describeError(err)}`);
  }
}

/** The model's proposals in the planner's terms, with the same sanity limits as the draft. */
export type ProposedFix = { kind: "substitute" | "change_amount" | "change_dish"; title: string; effect: string; changesDish: boolean; ingredient?: DraftIngredient; perCover?: number };

export function toFixOptions(raw: LlmFixes, base: DraftIngredient): ProposedFix[] {
  const clean = (s: string, n = 200) => s.replace(/\s+/g, " ").trim().slice(0, n);
  return raw.options.slice(0, 3).flatMap((o): ProposedFix[] => {
    const title = clean(o.title, 80);
    const effect = clean(o.effect);
    if (o.kind === "change_amount") {
      if (o.perCover === null || !Number.isFinite(o.perCover) || o.perCover <= 0) return [];
      return [{ kind: o.kind, title, effect, changesDish: o.changesDish, perCover: o.perCover }];
    }
    if (!o.ingredient) return o.kind === "change_dish" ? [{ kind: o.kind, title, effect, changesDish: true }] : [];
    const i = o.ingredient;
    if (!Number.isFinite(i.perCover.amount) || i.perCover.amount <= 0) return [];
    const ingredient: DraftIngredient = {
      key: clean(i.key, 60).toLowerCase().replace(/[^a-z0-9]+/g, "_") || base.key,
      name: clean(i.name, 80),
      searchTerms: [...new Set([...i.searchTerms, i.name].map((t) => clean(t, 60)).filter(Boolean))].slice(0, 5),
      role: clean(i.role),
      perCover: i.perCover,
      yieldPct: Number.isFinite(i.yieldPct) && i.yieldPct >= 20 && i.yieldPct <= 100 ? i.yieldPct : 100,
      amountBasis: clean(i.amountBasis),
      pantry: false,
      form: i.form,
      avoid: i.avoid.map((a) => clean(a, 40).toLowerCase()).filter(Boolean).slice(0, 8),
    };
    return [{ kind: o.kind, title, effect, changesDish: o.changesDish, ingredient }];
  });
}
