import { generateText, Output } from "ai";
import { z } from "zod";
import { recordLlmSpend, reserveLlmCall } from "@/server/limits";
import { createModel } from "../models";
import { costOf, tokensFromUsage, type Tokens } from "../pricing";
import { withRetry } from "../retry";
import type { FixModel } from "./fixes";
import { PICK_SYSTEM, pickUser } from "./prompts";

/**
 * Between master-data search and the live price check: which found products ARE the ingredient (onions, not onion
 * crackers; frozen berries, not frozen fish). The model judges names only (Haiku 5.5 was as fast but threw out
 * good rye breads; the project floor is Opus 5.5, at low effort); plain code has already removed
 * everything unsafe or outside the mandate, and only reorders and narrows by this answer. On any failure the
 * code's own ranking stands.
 */
export const PICK_MODEL_DEFAULT = "anthropic:claude-opus-5-5";

export const LlmPick = z.object({ lines: z.array(z.object({ lineId: z.string(), fits: z.array(z.string()), note: z.string().nullable() })) });
export type LlmPick = z.infer<typeof LlmPick>;

export type PickLine = { lineId: string; ingredient: string; role: string; form: string; candidates: { id: string; name: string }[] };
export type PickResult = { pick: LlmPick; model: string; ms: number; tokens: Tokens; costUsd: number | null };

export async function pickProducts(lines: PickLine[], model?: string | FixModel, timeoutMs = 15_000): Promise<PickResult> {
  const m = model && typeof model !== "string" ? model : (() => {
    const c = createModel(model ?? process.env.DOCK_MENU_PICK_MODEL ?? PICK_MODEL_DEFAULT);
    return { model: c.model, id: c.spec.id, price: c.price };
  })();
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  reserveLlmCall(); // public-demo caps: daily calls and spend, DOCK_LLM=off (server/limits.ts)
  const res = await withRetry(
    () =>
      generateText({
        model: m.model,
        instructions: PICK_SYSTEM,
        prompt: pickUser(lines),
        output: Output.object({ schema: LlmPick, name: "product_fit" }),
        maxOutputTokens: 4000,
        maxRetries: 0,
        providerOptions: m.id.startsWith("anthropic:") ? { anthropic: { effort: "low" } } : undefined,
        abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      }),
    { deadline, policy: { maxRetries: 1, baseMs: 300, maxMs: 1500 } },
  );
  const tokens = tokensFromUsage(res.usage);
  recordLlmSpend(costOf(tokens, m.price));
  return { pick: res.output as LlmPick, model: m.id, ms: Date.now() - t0, tokens, costUsd: costOf(tokens, m.price) };
}
